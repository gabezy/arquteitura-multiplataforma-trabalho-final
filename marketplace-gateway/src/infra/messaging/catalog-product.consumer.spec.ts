import pino from 'pino';
import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { CatalogProductConsumer } from './catalog-product.consumer';
import { PublishApprovedProductPort } from '../../core/listing/port/in/publish-approved-product.port';
import { RecordProductStockPort } from '../../core/listing/port/in/record-product-stock.port';
import { InvalidListingError, ProductNotApprovedError, ProductNotFoundError } from '../../core/listing/model/listing.errors';
import { CatalogUnavailableError } from '../catalog/http-product-catalog';
import { Inbox } from './inbox';

const APPROVED_TOPIC = 'catalog.product.approved.v1';
const STOCK_CHANGED_TOPIC = 'catalog.product.stock-changed.v1';
const DEAD_LETTER_TOPIC = 'marketplace.catalog-product.dlq';
const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';

const messageWith = (value: string | null, headers: IHeaders = {}, topic = APPROVED_TOPIC): EachMessagePayload =>
  ({
    topic,
    partition: 2,
    message: { key: Buffer.from(PRODUCT_ID), value: value === null ? null : Buffer.from(value), offset: '7', headers },
  }) as unknown as EachMessagePayload;

const approved = (body: unknown, headers: IHeaders = {}) => messageWith(JSON.stringify(body), headers);

const stockChanged = (body: unknown, headers: IHeaders = {}) => messageWith(JSON.stringify(body), headers, STOCK_CHANGED_TOPIC);

describe('CatalogProductConsumer', () => {
  const publishPort: jest.Mocked<PublishApprovedProductPort> = { publish: jest.fn() };
  const stockPort: jest.Mocked<RecordProductStockPort> = { record: jest.fn() };
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };
  const inbox: jest.Mocked<Inbox> = { hasProcessed: jest.fn(), markProcessed: jest.fn() };

  const catalogProductConsumer = new CatalogProductConsumer(
    publishPort,
    stockPort,
    consumer as unknown as Consumer,
    producer as unknown as Producer,
    inbox,
    { approvedTopic: APPROVED_TOPIC, stockChangedTopic: STOCK_CHANGED_TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
    pino({ level: 'silent' }),
  );

  const receive = async (payload: EachMessagePayload): Promise<void> => {
    await catalogProductConsumer.start();
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage(payload);
  };

  const expectDeadLetter = (reason: string, originalTopic = APPROVED_TOPIC): void => {
    expect(producer.send).toHaveBeenCalledTimes(1);
    const { topic, messages } = producer.send.mock.calls[0][0];
    expect(topic).toBe(DEAD_LETTER_TOPIC);
    expect(messages[0].headers).toEqual(
      expect.objectContaining({ 'dlq-original-topic': originalTopic, 'dlq-original-offset': '7', 'dlq-reason': expect.stringContaining(reason) }),
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    inbox.hasProcessed.mockResolvedValue(false);
  });

  it('subscribes to the approved products and the stock changes from the beginning', async () => {
    await catalogProductConsumer.start();

    expect(consumer.connect).toHaveBeenCalled();
    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: [APPROVED_TOPIC, STOCK_CHANGED_TOPIC], fromBeginning: true });
  });

  describe('an approved product', () => {
    it('has its listings published, ignoring fields that are not part of the contract', async () => {
      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001', name: 'Notebook' }));

      expect(publishPort.publish).toHaveBeenCalledWith({ productId: PRODUCT_ID, sku: 'NB-001' });
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('has the SKU trimmed', async () => {
      await receive(approved({ productId: PRODUCT_ID, sku: ' NB-001 ' }));

      expect(publishPort.publish).toHaveBeenCalledWith({ productId: PRODUCT_ID, sku: 'NB-001' });
    });
  });

  describe('a stock change', () => {
    it('is recorded with the SKU and the absolute stock, ignoring fields that are not part of the contract', async () => {
      stockPort.record.mockResolvedValue(3);

      await receive(stockChanged({ productId: PRODUCT_ID, sku: 'NB-001', stock: 4, reason: 'reserved' }));

      expect(stockPort.record).toHaveBeenCalledWith({ sku: 'NB-001', stock: 4 });
      expect(publishPort.publish).not.toHaveBeenCalled();
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('is recorded with a stock of zero, which makes the listings unavailable', async () => {
      await receive(stockChanged({ productId: PRODUCT_ID, sku: 'NB-001', stock: 0 }));

      expect(stockPort.record).toHaveBeenCalledWith({ sku: 'NB-001', stock: 0 });
    });

    it('has the SKU trimmed', async () => {
      await receive(stockChanged({ productId: PRODUCT_ID, sku: ' NB-001 ', stock: 4 }));

      expect(stockPort.record).toHaveBeenCalledWith({ sku: 'NB-001', stock: 4 });
    });

    it('does not publish listings, and an approved product does not record any stock', async () => {
      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }));

      expect(stockPort.record).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty message', null, 'no value'],
      ['malformed JSON', '{not json', 'JSON'],
      ['a product id that is not a UUID', JSON.stringify({ productId: '42', sku: 'NB-001', stock: 1 }), 'productId'],
      ['no SKU', JSON.stringify({ productId: PRODUCT_ID, stock: 1 }), 'sku'],
      ['an empty SKU', JSON.stringify({ productId: PRODUCT_ID, sku: ' ', stock: 1 }), 'sku'],
      ['no stock', JSON.stringify({ productId: PRODUCT_ID, sku: 'NB-001' }), 'stock'],
      ['a negative stock', JSON.stringify({ productId: PRODUCT_ID, sku: 'NB-001', stock: -1 }), 'stock'],
      ['a stock that is not a whole number', JSON.stringify({ productId: PRODUCT_ID, sku: 'NB-001', stock: 1.5 }), 'stock'],
      ['a stock written as text', JSON.stringify({ productId: PRODUCT_ID, sku: 'NB-001', stock: '3' }), 'stock'],
    ])('goes to the dead letter topic: %s', async (_case, value, reason) => {
      await receive(messageWith(value, {}, STOCK_CHANGED_TOPIC));

      expect(stockPort.record).not.toHaveBeenCalled();
      expectDeadLetter(reason, STOCK_CHANGED_TOPIC);
    });

    it('goes to the dead letter topic when the gateway refuses the stock', async () => {
      stockPort.record.mockRejectedValue(new InvalidListingError('The stock of a listing must be an integer that is not negative.'));

      await receive(stockChanged({ productId: PRODUCT_ID, sku: 'NB-001', stock: 4 }));

      expectDeadLetter('must be an integer', STOCK_CHANGED_TOPIC);
    });

    it('rethrows an error nobody expected, so Kafka delivers the message again', async () => {
      stockPort.record.mockRejectedValue(new Error('database down'));

      await expect(receive(stockChanged({ productId: PRODUCT_ID, sku: 'NB-001', stock: 4 }, { ce_id: 'evt-1' }))).rejects.toThrow('database down');

      expect(producer.send).not.toHaveBeenCalled();
      expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('is skipped when its ce_id was already handled, and recorded as handled after the stock is recorded', async () => {
      inbox.hasProcessed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const message = stockChanged({ productId: PRODUCT_ID, sku: 'NB-001', stock: 4 }, { ce_id: Buffer.from('evt-1') });

      await receive(message);
      expect(stockPort.record).not.toHaveBeenCalled();

      await receive(message);
      expect(stockPort.record).toHaveBeenCalledTimes(1);
      expect(inbox.markProcessed).toHaveBeenCalledWith('evt-1', STOCK_CHANGED_TOPIC);
    });
  });

  describe('a message that can never be handled', () => {
    it.each([
      ['an empty message', null, 'no value'],
      ['malformed JSON', '{not json', 'JSON'],
      ['a product id that is not a UUID', JSON.stringify({ productId: '42', sku: 'NB-001' }), 'productId'],
      ['no product id', JSON.stringify({ sku: 'NB-001' }), 'productId'],
      ['no SKU', JSON.stringify({ productId: PRODUCT_ID }), 'sku'],
      ['an empty SKU', JSON.stringify({ productId: PRODUCT_ID, sku: '  ' }), 'sku'],
    ])('goes to the dead letter topic: %s', async (_case, value, reason) => {
      await receive(messageWith(value));

      expect(publishPort.publish).not.toHaveBeenCalled();
      expectDeadLetter(reason);
    });

    it.each([
      ['a product the catalog does not have', new ProductNotFoundError('NB-001'), 'Product NB-001 not found in the catalog.'],
      ['a product the catalog did not approve', new ProductNotApprovedError('NB-001', 'REJECTED'), 'is not approved'],
    ])('goes to the dead letter topic: %s', async (_case, error, reason) => {
      publishPort.publish.mockRejectedValue(error);

      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }));

      expectDeadLetter(reason);
    });
  });

  describe('a catalog that does not answer', () => {
    it('rethrows the error, so Kafka delivers the message again, and records nothing', async () => {
      const error = new CatalogUnavailableError('The catalog did not answer within 3000 ms');
      publishPort.publish.mockRejectedValue(error);

      await expect(receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }, { ce_id: 'evt-1' }))).rejects.toBe(error);

      expect(producer.send).not.toHaveBeenCalled();
      expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('rethrows an error nobody expected', async () => {
      publishPort.publish.mockRejectedValue(new Error('database down'));

      await expect(receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }))).rejects.toThrow('database down');

      expect(producer.send).not.toHaveBeenCalled();
    });
  });

  describe('a message that arrives again', () => {
    const HEADERS = { ce_id: Buffer.from('evt-1') };

    it('is skipped when its ce_id was already handled', async () => {
      inbox.hasProcessed.mockResolvedValue(true);

      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }, HEADERS));

      expect(inbox.hasProcessed).toHaveBeenCalledWith('evt-1');
      expect(publishPort.publish).not.toHaveBeenCalled();
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('is recorded as handled after the listings are published', async () => {
      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }, HEADERS));

      expect(inbox.markProcessed).toHaveBeenCalledWith('evt-1', APPROVED_TOPIC);
    });

    it('is recorded as handled after it goes to the dead letter topic, so it does not go there twice', async () => {
      await receive(approved({ productId: '42', sku: 'NB-001' }, HEADERS));

      expectDeadLetter('productId');
      expect(inbox.markProcessed).toHaveBeenCalledWith('evt-1', APPROVED_TOPIC);
    });

    it('is handled without the inbox when it carries no ce_id', async () => {
      await receive(approved({ productId: PRODUCT_ID, sku: 'NB-001' }));

      expect(publishPort.publish).toHaveBeenCalled();
      expect(inbox.hasProcessed).not.toHaveBeenCalled();
      expect(inbox.markProcessed).not.toHaveBeenCalled();
    });
  });
});
