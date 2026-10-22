import pino from "pino";
import { Consumer, EachMessagePayload, Producer } from "kafkajs";
import { OrderStockConsumer } from "./order-stock.consumer";
import { ReserveStockPort } from "../../core/stock/port/in/reserve-stock.port";
import { ReleaseStockPort } from "../../core/stock/port/in/release-stock.port";
import { InvalidProductError } from "../../core/product/model/product.errors";
import { ConcurrentModificationError } from "../persistence/concurrent-modification.error";

const PLACED_TOPIC = "order.order.placed.v1";
const CANCELLED_TOPIC = "order.order.cancelled.v1";
const DEAD_LETTER_TOPIC = "catalog.order-stock.dlq";
const ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";

const messageOn = (topic: string, value: string | null): EachMessagePayload =>
  ({
    topic,
    partition: 1,
    message: { key: Buffer.from(ORDER_ID), value: value === null ? null : Buffer.from(value), offset: "3", headers: {} },
  }) as unknown as EachMessagePayload;

const placed = (body: unknown) => messageOn(PLACED_TOPIC, JSON.stringify(body));

describe("OrderStockConsumer", () => {
  const reserveStockPort: jest.Mocked<ReserveStockPort> = { reserve: jest.fn() };
  const releaseStockPort: jest.Mocked<ReleaseStockPort> = { release: jest.fn() };
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };

  const orderStockConsumer = new OrderStockConsumer(
    reserveStockPort,
    releaseStockPort,
    consumer as unknown as Consumer,
    producer as unknown as Producer,
    { placedTopic: PLACED_TOPIC, cancelledTopic: CANCELLED_TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
    pino({ level: "silent" }),
  );

  const receive = async (payload: EachMessagePayload): Promise<void> => {
    await orderStockConsumer.start();
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage(payload);
  };

  const expectDeadLetter = (reason: string): void => {
    expect(producer.send).toHaveBeenCalledTimes(1);
    const { topic, messages } = producer.send.mock.calls[0][0];
    expect(topic).toBe(DEAD_LETTER_TOPIC);
    expect(messages[0].headers).toEqual(
      expect.objectContaining({ "dlq-original-topic": expect.any(String), "dlq-reason": expect.stringContaining(reason) }),
    );
  };

  beforeEach(() => jest.resetAllMocks());

  it("subscribes to the placed and cancelled topics from the beginning", async () => {
    await orderStockConsumer.start();

    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: [PLACED_TOPIC, CANCELLED_TOPIC], fromBeginning: true });
  });

  describe("on a placed order", () => {
    it("reserves its items, ignoring fields that are not part of the contract", async () => {
      await receive(placed({ orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 2, price: 10 }], channel: "x" }));

      expect(reserveStockPort.reserve).toHaveBeenCalledWith({ orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 2 }] });
      expect(producer.send).not.toHaveBeenCalled();
    });

    it("passes a malformed SKU on, so the order is answered as insufficient", async () => {
      await receive(placed({ orderId: ORDER_ID, items: [{ sku: "sku 1!", quantity: 1 }] }));

      expect(reserveStockPort.reserve).toHaveBeenCalledWith({ orderId: ORDER_ID, items: [{ sku: "sku 1!", quantity: 1 }] });
    });

    it.each([
      ["an empty message", null, "no value"],
      ["malformed JSON", "{not json", "JSON"],
      ["an order id that is not a UUID", JSON.stringify({ orderId: "42", items: [{ sku: "NB-001", quantity: 1 }] }), "orderId"],
      ["no items", JSON.stringify({ orderId: ORDER_ID, items: [] }), "items"],
      ["a zero quantity", JSON.stringify({ orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 0 }] }), "quantity"],
    ])("sends %s to the dead letter topic", async (_case, value, reason) => {
      await receive(messageOn(PLACED_TOPIC, value));

      expect(reserveStockPort.reserve).not.toHaveBeenCalled();
      expectDeadLetter(reason);
    });

    it("sends an order the domain refuses to the dead letter topic", async () => {
      reserveStockPort.reserve.mockRejectedValue(new InvalidProductError("refused"));

      await receive(placed({ orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 1 }] }));

      expectDeadLetter("refused");
    });

    it("rethrows a concurrent modification so Kafka redelivers the order", async () => {
      reserveStockPort.reserve.mockRejectedValue(new ConcurrentModificationError("modified"));

      await expect(receive(placed({ orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 1 }] }))).rejects.toThrow(
        "modified",
      );
      expect(producer.send).not.toHaveBeenCalled();
    });
  });

  describe("on a cancelled order", () => {
    it("releases its stock", async () => {
      await receive(messageOn(CANCELLED_TOPIC, JSON.stringify({ orderId: ORDER_ID, reason: "PAYMENT_FAILED" })));

      expect(releaseStockPort.release).toHaveBeenCalledWith({ orderId: ORDER_ID });
      expect(reserveStockPort.reserve).not.toHaveBeenCalled();
    });

    it("sends a cancellation without a valid order id to the dead letter topic", async () => {
      await receive(messageOn(CANCELLED_TOPIC, JSON.stringify({ reason: "PAYMENT_FAILED" })));

      expect(releaseStockPort.release).not.toHaveBeenCalled();
      expectDeadLetter("orderId");
    });
  });
});
