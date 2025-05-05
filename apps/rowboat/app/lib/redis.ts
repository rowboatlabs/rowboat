import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType> {
  // Проверяем, выполняется ли код в браузере или во время сборки (где нет REDIS_URL)
  // process.env.REDIS_URL может быть недоступен во время сборки или на клиенте
  if (typeof window !== 'undefined' || !process.env.REDIS_URL) {
    // Возвращаем заглушку или выбрасываем ошибку, если Redis недоступен/не нужен
    // В данном случае выбрасываем ошибку, так как попытка использовать Redis там, где он не должен быть, это проблема
    throw new Error('Redis client is not available in this environment.');
  }

  if (!redisClient) {
    console.log('Initializing Redis client...'); // Лог для отладки
    const client = createClient({
      url: process.env.REDIS_URL,
      // Дополнительные настройки, если нужны (например, обработка ошибок)
      // socket: {
      //   connectTimeout: 10000, // Таймаут подключения 10 секунд
      // }
    });

    client.on('error', (err) => console.error('Redis Client Error', err));
    
    // Важно: Не подключаемся здесь сразу! Подключение будет при первом использовании.
    // Или можно добавить client.connect() и обработать ошибки подключения
    redisClient = client as unknown as RedisClientType; // Приведение типа может быть необходимо в зависимости от версии redis
    
    // Попытка подключиться при инициализации, если это необходимо
    try {
      await redisClient.connect();
      console.log('Redis client connected.');
    } catch (err) {
       console.error('Failed to connect to Redis:', err);
       redisClient = null; // Сбрасываем клиент, если подключение не удалось
       throw new Error('Failed to connect to Redis'); // Перебрасываем ошибку
    }
  } else if (!redisClient.isOpen) {
     // Если клиент создан, но не подключен (например, после ошибки)
     try {
       await redisClient.connect();
       console.log('Redis client reconnected.');
     } catch (err) {
       console.error('Failed to reconnect to Redis:', err);
       redisClient = null; 
       throw new Error('Failed to reconnect to Redis');
     }
  }

  return redisClient;
}

export { getRedisClient };

// Пример использования (в других файлах):
// import { getRedisClient } from './lib/redis';
//
// async function someFunction() {
//   try {
//     const client = await getRedisClient();
//     const value = await client.get('mykey');
//     // ...
//   } catch (error) {
//      console.error("Redis operation failed:", error);
//      // Обработка ошибки - например, возврат значения по умолчанию
//   }
// }
