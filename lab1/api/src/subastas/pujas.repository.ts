import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import type { Puja } from './subasta.model.js';

// Se ejecuta entero y sin interrupciones en Redis (Redis procesa los scripts
// Lua de forma atómica), por eso lee y escribe el monto en un solo paso: no
// hay ventana donde otra puja se pueda colar entre el GET y el SET.
const PUJAR_ATOMICO_SCRIPT = `
local actual = tonumber(redis.call('GET', KEYS[1]))
local nuevo = tonumber(ARGV[1])
if nuevo > actual then
  redis.call('SET', KEYS[1], nuevo)
  return {1, nuevo}
end
return {0, actual}
`;

interface RedisConPujarAtomico extends Redis {
  pujarAtomico(key: string, monto: number): Promise<[number, number]>;
}

@Injectable()
export class PujasRepository {
  private readonly redis: RedisConPujarAtomico;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.redis = redis as RedisConPujarAtomico;
    this.redis.defineCommand('pujarAtomico', {
      numberOfKeys: 1,
      lua: PUJAR_ATOMICO_SCRIPT,
    });
  }

  async setMontoActualSiSupera(
    id: string,
    monto: number,
  ): Promise<{ gano: boolean; montoActual: number }> {
    const [gano, montoActual] = await this.redis.pujarAtomico(`subasta:${id}:puja`, monto);
    return { gano: gano === 1, montoActual };
  }

  // Sin verificación: usada solo por la versión ingenua para reproducir el
  // bug de la demo. No usar fuera de ese contexto.
  async setMontoActualSinVerificar(id: string, monto: number): Promise<void> {
    await this.redis.set(`subasta:${id}:puja`, monto);
  }

  async appendHistorial(id: string, puja: Puja): Promise<void> {
    await this.redis.rpush(`subasta:${id}:historial`, JSON.stringify(puja));
  }
}
