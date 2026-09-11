import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

@Injectable()
export class CierreRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Esta clave no se lee nunca: existe solo para que Redis la expire sola y
  // dispare el evento `expired` que escucha CierreListener.
  async setCierreConTTL(id: string, segundos: number): Promise<void> {
    await this.redis.set(`subasta:${id}:cierre`, '1', 'EX', segundos);
  }
}
