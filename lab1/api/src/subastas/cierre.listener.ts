import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { SubastasRepository } from './subastas.repository.js';

const CANAL_EXPIRADOS = '__keyevent@0__:expired';
const PREFIJO = 'subasta:';
const SUFIJO = ':cierre';

@Injectable()
export class CierreListener implements OnModuleInit {
  private readonly logger = new Logger(CierreListener.name);
  private readonly subscriber: Redis;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly subastasRepository: SubastasRepository,
  ) {
    // Una conexión de Redis en modo `subscribe` queda dedicada a eso, así
    // que no se puede compartir con el cliente que usan los repositorios
    // para leer/escribir. `duplicate()` abre una segunda conexión con la
    // misma config, solo para escuchar este canal.
    this.subscriber = redis.duplicate();
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(CANAL_EXPIRADOS);
    this.subscriber.on('message', (canal: string, key: string) => {
      if (canal !== CANAL_EXPIRADOS || !key.startsWith(PREFIJO) || !key.endsWith(SUFIJO)) {
        return;
      }
      const id = key.slice(PREFIJO.length, -SUFIJO.length);
      this.onSubastaExpirada(id).catch((error: unknown) => {
        this.logger.error(`Error cerrando la subasta ${id}`, error as Error);
      });
    });
  }

  async onSubastaExpirada(id: string): Promise<void> {
    const ganador = await this.subastasRepository.determinarGanador(id);
    await this.subastasRepository.marcarComoCerrada(id, ganador);
    this.logger.log(`Subasta ${id} cerrada. Ganador: ${ganador ?? 'sin pujas'}`);
  }
}
