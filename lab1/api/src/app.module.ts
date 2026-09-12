import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health/health.controller.js';
import { RedisModule } from './redis/redis.module.js';
import { SubastasModule } from './subastas/subastas.module.js';

@Module({
  imports: [RedisModule, SubastasModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
