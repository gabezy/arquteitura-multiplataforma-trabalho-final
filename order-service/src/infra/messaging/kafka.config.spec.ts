import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import './kafka.config';

describe('configureKafka', () => {
    it('registers a Snappy codec that reads what it compresses, so batches of the billing-service can be consumed', async () => {
        const payload = Buffer.from(JSON.stringify({ invoiceId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d', amount: 15000 }));
        const codec = CompressionCodecs[CompressionTypes.Snappy]();

        const compressed = await codec.compress({ buffer: payload } as never);

        expect(Buffer.from(await codec.decompress(compressed)).equals(payload)).toBe(true);
    });
});
