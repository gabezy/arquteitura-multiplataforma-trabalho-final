import pino from "pino";
import { Consumer, EachMessagePayload, Producer } from "kafkajs";
import { ProductAnalysisConsumer } from "./product-analysis.consumer";
import { CompleteProductAnalysisPort } from "../../core/product/port/in/complete-product-analysis.port";
import { ProductNotFoundError } from "../../core/product/model/product.errors";

const TOPIC = "produto.analisado.v1";
const DEAD_LETTER_TOPIC = "catalog.product-analysis.dlq";

const messageWith = (value: string | null): EachMessagePayload =>
  ({
    topic: TOPIC,
    partition: 2,
    message: { key: Buffer.from("NB-001"), value: value === null ? null : Buffer.from(value), offset: "7", headers: { ce_id: "abc" } },
  }) as unknown as EachMessagePayload;

describe("ProductAnalysisConsumer", () => {
  const completeProductAnalysisPort: jest.Mocked<CompleteProductAnalysisPort> = { completeAnalysis: jest.fn() };
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };

  const productAnalysisConsumer = new ProductAnalysisConsumer(
    completeProductAnalysisPort,
    consumer as unknown as Consumer,
    producer as unknown as Producer,
    { topic: TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
    pino({ level: "silent" }),
  );

  const receive = async (payload: EachMessagePayload): Promise<void> => {
    await productAnalysisConsumer.start();
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage(payload);
  };

  beforeEach(() => jest.resetAllMocks());

  describe("start", () => {
    it("fails when it cannot connect to Kafka", async () => {
      consumer.connect.mockRejectedValue(new Error("broker down"));

      await expect(productAnalysisConsumer.start()).rejects.toThrow("broker down");
    });

    it("subscribes to the analysis topic from the beginning, so a new group misses no message", async () => {
      await productAnalysisConsumer.start();

      expect(consumer.subscribe).toHaveBeenCalledWith({ topics: [TOPIC], fromBeginning: true });
    });
  });

  describe("on a message", () => {
    it.each(["APPROVED", "REJECTED"] as const)("completes a %s analysis", async (status) => {
      await receive(messageWith(JSON.stringify({ sku: "NB-001", status })));

      expect(completeProductAnalysisPort.completeAnalysis).toHaveBeenCalledWith({ sku: "NB-001", status });
      expect(producer.send).not.toHaveBeenCalled();
    });

    it("ignores fields that are not part of the contract", async () => {
      await receive(messageWith(JSON.stringify({ sku: "NB-001", status: "APPROVED", reviewer: "ana" })));

      expect(completeProductAnalysisPort.completeAnalysis).toHaveBeenCalledWith({ sku: "NB-001", status: "APPROVED" });
    });

    it.each([
      ["an empty message", null],
      ["malformed JSON", "{not json"],
      ["an unknown status", JSON.stringify({ sku: "NB-001", status: "MAYBE" })],
      ["a missing SKU", JSON.stringify({ status: "APPROVED" })],
    ])("sends %s to the dead letter topic", async (_case, value) => {
      await receive(messageWith(value));

      expect(completeProductAnalysisPort.completeAnalysis).not.toHaveBeenCalled();
      expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({ topic: DEAD_LETTER_TOPIC }));
    });

    it("sends a message the domain refuses to the dead letter topic", async () => {
      completeProductAnalysisPort.completeAnalysis.mockRejectedValue(new ProductNotFoundError("NB-001"));

      await receive(messageWith(JSON.stringify({ sku: "NB-001", status: "APPROVED" })));

      expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({ topic: DEAD_LETTER_TOPIC }));
    });

    it("keeps the original message and the reason in the dead letter", async () => {
      const value = JSON.stringify({ sku: "NB-001", status: "MAYBE" });

      await receive(messageWith(value));

      const [deadLetter] = producer.send.mock.calls[0][0].messages;
      expect(deadLetter.key).toEqual(Buffer.from("NB-001"));
      expect(deadLetter.value).toEqual(Buffer.from(value));
      expect(deadLetter.headers).toEqual(
        expect.objectContaining({
          ce_id: "abc",
          "dlq-original-topic": TOPIC,
          "dlq-original-partition": "2",
          "dlq-original-offset": "7",
          "dlq-reason": expect.stringContaining("status"),
        }),
      );
    });

    it("rethrows an infrastructure failure so Kafka redelivers the message", async () => {
      completeProductAnalysisPort.completeAnalysis.mockRejectedValue(new Error("database down"));

      await expect(receive(messageWith(JSON.stringify({ sku: "NB-001", status: "APPROVED" })))).rejects.toThrow(
        "database down",
      );
      expect(producer.send).not.toHaveBeenCalled();
    });
  });
});
