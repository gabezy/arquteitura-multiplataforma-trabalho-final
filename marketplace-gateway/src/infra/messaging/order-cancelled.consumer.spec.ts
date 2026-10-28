import pino from 'pino';
import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { OrderCancelledConsumer } from './order-cancelled.consumer';
import { CancelMarketplaceOrderPort } from '../../core/order/port/in/cancel-marketplace-order.port';
import { UnsupportedMarketplaceError } from '../../core/marketplace/marketplace.registry';
import {
    CircuitOpenError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import { Inbox } from './inbox';

const TOPIC = 'order.order.cancelled.v1';
const DEAD_LETTER_TOPIC = 'marketplace.order-cancelled.dlq';
const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';

const messageWith = (value: string | null, headers: IHeaders = {}): EachMessagePayload =>
  ({
    topic: TOPIC,
    partition: 1,
    message: { key: Buffer.from(ORDER_ID), value: value === null ? null : Buffer.from(value), offset: '3', headers },
  }) as unknown as EachMessagePayload;

const cancelled = (body: unknown, headers: IHeaders = {}) => messageWith(JSON.stringify(body), headers);

const VALID = { orderId: ORDER_ID, reason: 'OUT_OF_STOCK', marketplace: 'SHOPEE', externalOrderId: 'SHP261028A1B2C3' };

describe('OrderCancelledConsumer', () => {
  const cancelPort: jest.Mocked<CancelMarketplaceOrderPort> = { cancel: jest.fn() };
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };
  const inbox: jest.Mocked<Inbox> = { hasProcessed: jest.fn(), markProcessed: jest.fn() };

  const orderCancelledConsumer = new OrderCancelledConsumer(
    cancelPort,
    consumer as unknown as Consumer,
    producer as unknown as Producer,
    inbox,
    { topic: TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
    pino({ level: 'silent' }),
  );

  const receive = async (payload: EachMessagePayload): Promise<void> => {
    await orderCancelledConsumer.start();
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage(payload);
  };

  const expectDeadLetter = (reason: string): void => {
    expect(producer.send).toHaveBeenCalledTimes(1);
    const { topic, messages } = producer.send.mock.calls[0][0];
    expect(topic).toBe(DEAD_LETTER_TOPIC);
    expect(messages[0].headers).toEqual(
      expect.objectContaining({ 'dlq-original-topic': TOPIC, 'dlq-original-offset': '3', 'dlq-reason': expect.stringContaining(reason) }),
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    inbox.hasProcessed.mockResolvedValue(false);
  });

  it('subscribes to the cancelled orders topic from the beginning', async () => {
    await orderCancelledConsumer.start();

    expect(consumer.connect).toHaveBeenCalled();
    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: [TOPIC], fromBeginning: true });
  });

  describe('a cancelled order', () => {
    it('is cancelled at the marketplace the event names, ignoring fields that are not part of the contract', async () => {
      await receive(cancelled({ ...VALID, channel: 'web' }));

      expect(cancelPort.cancel).toHaveBeenCalledWith({ marketplace: 'SHOPEE', externalOrderId: 'SHP261028A1B2C3', reason: 'OUT_OF_STOCK' });
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('is cancelled without a reason when the event has none', async () => {
      await receive(cancelled({ orderId: ORDER_ID, marketplace: 'AMAZON', externalOrderId: '701-1' }));

      expect(cancelPort.cancel).toHaveBeenCalledWith({ marketplace: 'AMAZON', externalOrderId: '701-1', reason: undefined });
    });
  });

  describe('a message that can never be handled', () => {
    it.each([
      ['an empty message', null, 'no value'],
      ['malformed JSON', '{not json', 'JSON'],
      ['an order id that is not a UUID', JSON.stringify({ ...VALID, orderId: '42' }), 'orderId'],
      ['no marketplace', JSON.stringify({ ...VALID, marketplace: undefined }), 'marketplace'],
      ['a marketplace that does not exist', JSON.stringify({ ...VALID, marketplace: 'EBAY' }), 'marketplace'],
      ['no external order id', JSON.stringify({ ...VALID, externalOrderId: undefined }), 'externalOrderId'],
      ['an empty external order id', JSON.stringify({ ...VALID, externalOrderId: '' }), 'externalOrderId'],
    ])('goes to the dead letter topic: %s', async (_case, value, reason) => {
      await receive(messageWith(value));

      expect(cancelPort.cancel).not.toHaveBeenCalled();
      expectDeadLetter(reason);
    });

    it('goes to the dead letter topic when the marketplace refuses the cancellation, with the reason it gave', async () => {
      cancelPort.cancel.mockRejectedValue(new MarketplaceRejectedError('HTTP 409: Order already shipped', 'SHOPEE', 1));

      await receive(cancelled(VALID));

      expectDeadLetter('HTTP 409: Order already shipped');
    });

    it('goes to the dead letter topic when the domain refuses it', async () => {
      cancelPort.cancel.mockRejectedValue(new UnsupportedMarketplaceError('MERCADO_LIVRE'));

      await receive(cancelled({ ...VALID, marketplace: 'MERCADO_LIVRE' }));

      expectDeadLetter('No adapter configured for MERCADO_LIVRE.');
    });
  });

  describe('a marketplace that is down', () => {
    it.each([
      ['after the attempts', new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3)],
      ['with the circuit open', new CircuitOpenError('SHOPEE')],
    ])('rethrows the error, %s, so Kafka redelivers the message', async (_case, error) => {
      cancelPort.cancel.mockRejectedValue(error);

      await expect(receive(cancelled(VALID, { ce_id: Buffer.from('evt-1') }))).rejects.toBe(error);

      expect(producer.send).not.toHaveBeenCalled();
      expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('rethrows an error nobody expected', async () => {
      cancelPort.cancel.mockRejectedValue(new Error('database down'));

      await expect(receive(cancelled(VALID))).rejects.toThrow('database down');

      expect(producer.send).not.toHaveBeenCalled();
    });
  });

  describe('a message that arrives again', () => {
    const HEADERS = { ce_id: Buffer.from('evt-1') };

    it('is skipped when its ce_id was already handled', async () => {
      inbox.hasProcessed.mockResolvedValue(true);

      await receive(cancelled(VALID, HEADERS));

      expect(inbox.hasProcessed).toHaveBeenCalledWith('evt-1');
      expect(cancelPort.cancel).not.toHaveBeenCalled();
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('is recorded as handled after the order is cancelled', async () => {
      await receive(cancelled(VALID, HEADERS));

      expect(inbox.markProcessed).toHaveBeenCalledWith('evt-1', TOPIC);
    });

    it('is recorded as handled after it goes to the dead letter topic, so it does not go there twice', async () => {
      await receive(cancelled({ ...VALID, orderId: '42' }, HEADERS));

      expectDeadLetter('orderId');
      expect(inbox.markProcessed).toHaveBeenCalledWith('evt-1', TOPIC);
    });

    it('reads the ce_id from a header that is text, too', async () => {
      await receive(cancelled(VALID, { ce_id: 'evt-2' }));

      expect(inbox.hasProcessed).toHaveBeenCalledWith('evt-2');
    });

    it('is handled without the inbox when it carries no ce_id', async () => {
      await receive(cancelled(VALID));

      expect(cancelPort.cancel).toHaveBeenCalled();
      expect(inbox.hasProcessed).not.toHaveBeenCalled();
      expect(inbox.markProcessed).not.toHaveBeenCalled();
    });
  });
});
