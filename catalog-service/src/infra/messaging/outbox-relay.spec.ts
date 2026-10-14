import knex, { Knex } from "knex";
import { Producer, TopicMessages } from "kafkajs";
import { context, propagation, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { OutboxRelay } from "./outbox-relay";
import { KnexOutboxRepository } from "../persistence/knex-outbox.repository";
import { createMigrationSource } from "../persistence/migration-source";
import { DomainEvent } from "../../core/shared/domain/domain.event";

// Same image as catalog-db in ../compose.yaml: the relay relies on SKIP LOCKED and jsonb.
const POSTGRES_IMAGE = "postgres:18-alpine";
const CONTAINER_STARTUP_MS = 60_000;
const PRODUCT_ID = "0b9f4c2e-6a1d-4f3b-9c8e-2d7a5e1f4b6c";

class SomethingHappened extends DomainEvent {
  readonly eventName = "SomethingHappened";

  constructor(aggregateId: string, readonly value: number) {
    super(aggregateId);
  }
}

class OtherThingHappened extends DomainEvent {
  readonly eventName = "OtherThingHappened";

  constructor(aggregateId: string) {
    super(aggregateId);
  }
}

describe("OutboxRelay", () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  let outbox: KnexOutboxRepository;
  const sendBatch = jest.fn();
  const producer = { sendBatch } as unknown as Producer;

  const appendEvents = (aggregateType: string, ...events: DomainEvent[]) =>
    db.transaction((tx) => outbox.append(tx, aggregateType, events));

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: "pg", connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    outbox = new KnexOutboxRepository((event) => ({
      type: `test.${event.eventName}.v1`,
      data: event instanceof SomethingHappened ? { value: event.value } : {},
    }));
  }, CONTAINER_STARTUP_MS);

  beforeEach(() => sendBatch.mockReset());

  afterEach(async () => {
    await db("outbox").truncate();
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  const relay = () => new OutboxRelay(db, producer).relay();

  it("publishes each pending event to the topic named after its type, keyed by aggregate id", async () => {
    await appendEvents(
      "Product",
      new SomethingHappened(PRODUCT_ID, 42),
      new OtherThingHappened(PRODUCT_ID),
      new SomethingHappened(PRODUCT_ID, 43),
    );

    await relay();

    expect(sendBatch).toHaveBeenCalledWith({
      topicMessages: [
        {
          topic: "test.SomethingHappened.v1",
          messages: [
            expect.objectContaining({ key: PRODUCT_ID, value: JSON.stringify({ value: 42 }) }),
            expect.objectContaining({ key: PRODUCT_ID, value: JSON.stringify({ value: 43 }) }),
          ],
        },
        {
          topic: "test.OtherThingHappened.v1",
          messages: [expect.objectContaining({ key: PRODUCT_ID, value: JSON.stringify({}) })],
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
      ce_type: "test.SomethingHappened.v1",
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

  it("does not call Kafka when nothing is pending", async () => {
    await relay();

    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("lets concurrent relays split the pending events without publishing any twice", async () => {
    const MORE_THAN_ONE_BATCH = 150;
    await appendEvents(
      "Product",
      ...Array.from({ length: MORE_THAN_ONE_BATCH }, (_, i) => new SomethingHappened(PRODUCT_ID, i)),
    );
    // The first batch is held until the second relay also reaches Kafka. Without
    // SKIP LOCKED the second relay waits on the first one's rows, so they never overlap.
    const HOLD_LIMIT_MS = 1000;
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseBatches: () => void = () => {};
    const bothRelaysInFlight = new Promise<void>((resolve) => (releaseBatches = resolve));
    sendBatch.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === 2) releaseBatches();
      await Promise.race([bothRelaysInFlight, new Promise((resolve) => setTimeout(resolve, HOLD_LIMIT_MS))]);
      inFlight--;
    });

    await Promise.all([new OutboxRelay(db, producer).relay(), new OutboxRelay(db, producer).relay()]);

    const publishedIds = sendBatch.mock.calls.flatMap(([batch]) =>
      batch.topicMessages.flatMap((topic: TopicMessages) => topic.messages.map((message) => message.headers?.ce_id)),
    );
    expect(maxInFlight).toBe(2);
    expect(publishedIds).toHaveLength(MORE_THAN_ONE_BATCH);
    expect(new Set(publishedIds).size).toBe(MORE_THAN_ONE_BATCH);
  });

  describe("trace context", () => {
    const FIRST_TRACE = "0af7651916cd43dd8448eb211c80319c";
    const SECOND_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

    const inTrace = <T>(traceId: string, fn: () => Promise<T>) =>
      context.with(
        trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId: "b7ad6b7169203331", traceFlags: TraceFlags.SAMPLED }),
        fn,
      );

    beforeAll(() => {
      context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    });

    afterAll(() => {
      context.disable();
      propagation.disable();
    });

    it("sends each event inside the trace that recorded it, batching consecutive events of one trace", async () => {
      const activeTraces: (string | undefined)[] = [];
      sendBatch.mockImplementation(async () => {
        activeTraces.push(trace.getSpanContext(context.active())?.traceId);
      });
      await inTrace(FIRST_TRACE, () =>
        appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1), new SomethingHappened(PRODUCT_ID, 2)),
      );
      await inTrace(SECOND_TRACE, () => appendEvents("Product", new SomethingHappened(PRODUCT_ID, 3)));

      await relay();

      expect(activeTraces).toEqual([FIRST_TRACE, SECOND_TRACE]);
      expect(sendBatch.mock.calls[0][0].topicMessages[0].messages).toHaveLength(2);
    });

    it("starts a new trace for events recorded outside of one", async () => {
      let activeTrace: string | undefined = "not called";
      sendBatch.mockImplementation(async () => {
        activeTrace = trace.getSpanContext(context.active())?.traceId;
      });
      await appendEvents("Product", new SomethingHappened(PRODUCT_ID, 1));

      await inTrace(FIRST_TRACE, relay);

      expect(activeTrace).toBeUndefined();
    });
  });

  describe("start", () => {
    const INTERVAL_MS = 5;
    let running: OutboxRelay | undefined;

    const startRelay = (onError: (err: unknown) => void = () => {}) => {
      running = new OutboxRelay(db, producer);
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
