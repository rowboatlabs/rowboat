import '../lib/loadenv';
import { qdrantClient } from '../lib/qdrant';

const EMBEDDING_VECTOR_SIZE = Number(process.env.EMBEDDING_VECTOR_SIZE) || 1536;

(async () => {
    try {
        const result = await qdrantClient.createCollection('embeddings', {
            vectors: {
                size: EMBEDDING_VECTOR_SIZE,
                distance: 'Dot',
            },
        });
        console.log(`Create qdrant collection 'embeddings' completed with result: ${result}`);
    } catch (error) {
        console.error(`Unable to create qdrant collection 'embeddings': ${error}`);
    }
})();