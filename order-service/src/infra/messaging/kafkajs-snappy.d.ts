declare module 'kafkajs-snappy' {
    import { Codec } from 'kafkajs';

    const SnappyCodec: Codec;
    export = SnappyCodec;
}
