import knex, { Knex } from "knex";
import { Producer } from "kafkajs";
import { OutboxRelay } from "./outbox-relay";
import { KnexOutboxRepository } from "../persistence/knex-outbox.repository";
import { createMigrationSource } from "../persistence/migration-source";
import { DomainEvent } from "../../core/shared/domain/domain.event";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://catalog:catalog@localhost:5432/catalog";
const SCHEMA = "outbox_relay_spec";
const PRODUCT_TOPIC = "catalog.product.events.v1";
const PRODUCT_ID = "0b9f4c2e-6a1d-4f3b-9c8e-2d7a5e1f4b6c";

class SomethingHappened extends DomainEvent {
  readonly eventName = "SomethingHappened";

  constructor(aggregateId: string, readonly value: number) {
    super(aggregateId);
  }
}

describe("OutboxRelay", () => {
  let db: Knex;
  let outbox: KnexOutboxRepository;
  const sendBatch = jest.fn();
  const producer = { sendBatch } as unknown as Producer;

  const appendEvents = (aggregateType: string, ...events: DomainEvent[]) =>
    db.transaction((tx) => outbox.append(tx, aggregateType, events));

  beforeAll(async () => {
    db = knex({ client: "pg", connection: DATABASE_URL, searchPath: [SCHEMA] });
    await db.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [SCHEMA]);
    await db.raw("CREATE SCHEMA ??", [SCHEMA]);
    await db.migrate.latest({ migrationSource: createMigrationSource(), schemaName: SCHEMA });
    outbox = new KnexOutboxRepository((event) => ({
      type: "test.something.happened.v1",
      data: { value: (event as SomethingHappened).value },
    }));
  });

  beforeEach(() => sendBatch.mockReset());

  afterEach(async () => {
    await db("outbox").truncate();
  });

  afterAll(async () => {
    await db.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [SCHEMA]);
    await db.destroy();
  });

  const relay = () => new OutboxRelay(db, producer, { Product: PRODUCT_TOPIC }).relay();

  it("publishes pending events to the topic of their aggregate, keyed by aggregate id", async () => {
    await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 42));

    await relay();

    expect(sendBatch).toHaveBeenCalledWith({
      topicMessages: [
        {
          topic: PRODUCT_TOPIC,
          messages: [expect.objectContaining({ key: PRODUCT_ID, value: JSON.stringify({ value: 42 }) })],
        },
      ],
    });
  });

  it("describes each message with CloudEvents headers", async () => {
    const event = new SomethingHappened(PRODUCT_ID, 42);
    await appendEvents("Product", event);

    await relay();

    const [message] = sendBatch.mock.calls[0][0].topicMessages[0].messages;
    expect(message.headers).toEqual({
      ce_specversion: "1.0",
      ce_id: event.eventId,
      ce_source: "/catalog-service",
      ce_type: "test.something.happened.v1",
      ce_subject: PRODUCT_ID,
      ce_time: event.occurredOn.toISOString(),
      "content-type": "application/json",
    });
  });

  it("does not publish an event twice", async () => {
    await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));

    await relay();
    await relay();

    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  it("keeps events pending when Kafka rejects them", async () => {
    await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));
    sendBatch.mockRejectedValueOnce(new Error("broker down"));

    await expect(relay()).rejects.toThrow("broker down");
    await relay();

    expect(sendBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps events pending when their aggregate has no topic", async () => {
    await appendEvents("Category", new SomethingHappened(PRODUCT_ID, 1));

    await expect(relay()).rejects.toThrow("No topic for aggregate Category.");

    expect(sendBatch).not.toHaveBeenCalled();
    expect(await db("outbox").whereNull("published_at").count({ total: "*" }).first()).toEqual({ total: "1" });
  });

  it("does not call Kafka when nothing is pending", async () => {
    await relay();

    expect(sendBatch).not.toHaveBeenCalled();
  });

  describe("start", () => {
    const INTERVAL_MS = 5;
    let running: OutboxRelay | undefined;

    const startRelay = (onError: (err: unknown) => void = () => {}) => {
      running = new OutboxRelay(db, producer, { Product: PRODUCT_TOPIC });
      running.start({ intervalMs: INTERVAL_MS, onError });
      return running;
    };

    const waitUntil = async (condition: () => boolean | Promise<boolean>): Promise<void> => {
      const deadline = Date.now() + 2000;
      while (!(await condition())) {
        if (Date.now() > deadline) throw new Error("condition not met in time");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    const pendingCount = async () =>
      Number((await db("outbox").whereNull("published_at").count({ total: "*" }).first())?.total);

    afterEach(async () => {
      await running?.stop();
      running = undefined;
    });

    it("keeps publishing events appended while it runs", async () => {
      startRelay();

      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));
      await waitUntil(() => sendBatch.mock.calls.length === 1);
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 2));
      await waitUntil(() => sendBatch.mock.calls.length === 2);
    });

    it("never runs two rounds at the same time", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      sendBatch.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 4));
        inFlight--;
      });
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));
      startRelay();

      await waitUntil(() => sendBatch.mock.calls.length === 1);
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 2));
      await waitUntil(() => sendBatch.mock.calls.length === 2);

      expect(maxInFlight).toBe(1);
    });

    it("reports a failed round and keeps going", async () => {
      const onError = jest.fn();
      sendBatch.mockRejectedValueOnce(new Error("broker down"));
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));

      startRelay(onError);

      await waitUntil(async () => (await pendingCount()) === 0);
      expect(onError).toHaveBeenCalledWith(new Error("broker down"));
    });

    it("lets the round in progress finish when stopped", async () => {
      let finishSend: () => void = () => {};
      sendBatch.mockImplementation(() => new Promise<void>((resolve) => (finishSend = resolve)));
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));
      const relayInstance = startRelay();
      await waitUntil(() => sendBatch.mock.calls.length === 1);

      const stopped = relayInstance.stop();
      finishSend();
      await stopped;

      expect(await pendingCount()).toBe(0);
    });

    it("runs no round after it is stopped", async () => {
      await startRelay().stop();

      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 4));

      expect(sendBatch).not.toHaveBeenCalled();
    });
  });
});
