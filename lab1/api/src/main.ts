import { NestFactory } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { AppModule } from './app.module.js';
import { REDIS_CLIENT } from './redis/redis.constants.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const redisClient = app.get<Redis>(REDIS_CLIENT);
  const redisIoAdapter = new RedisIoAdapter(app, redisClient.duplicate(), redisClient.duplicate());
  redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
