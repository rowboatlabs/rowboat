import '../lib/loadenv';
import { qdrantClient } from '../lib/qdrant';

(async () => {
    try {
        const result = await qdrantClient.deleteCollection('embeddings');
        console.log(`Delete qdrant collection 'embeddings' completed with result: ${result}`);
    } catch (error) {
        console.error(`Unable to delete qdrant collection 'embeddings': ${error}`);
    }
})();