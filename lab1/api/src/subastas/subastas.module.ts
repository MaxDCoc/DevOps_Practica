import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { SubastasController } from './subastas.controller.js';
import { SubastasRepository } from './subastas.repository.js';
import { SubastasService } from './subastas.service.js';

@Module({
  imports: [RedisModule],
  controllers: [SubastasController],
  providers: [SubastasRepository, SubastasService],
  exports: [SubastasRepository, SubastasService],
})
export class SubastasModule {}
