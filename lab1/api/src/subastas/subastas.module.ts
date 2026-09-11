import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { SubastasController } from './subastas.controller.js';
import { SubastasRepository } from './subastas.repository.js';
import { SubastasService } from './subastas.service.js';
import { PujasController } from './pujas.controller.js';
import { PujasRepository } from './pujas.repository.js';
import { PujasService } from './pujas.service.js';
import { CierreRepository } from './cierre.repository.js';
import { CierreListener } from './cierre.listener.js';

@Module({
  imports: [RedisModule],
  controllers: [SubastasController, PujasController],
  providers: [
    SubastasRepository,
    SubastasService,
    PujasRepository,
    PujasService,
    CierreRepository,
    CierreListener,
  ],
  exports: [SubastasRepository, SubastasService],
})
export class SubastasModule {}
