import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import type { Puja, Subasta } from './subasta.model.js';

const INDEX_KEY = 'subastas:index';

@Injectable()
export class SubastasRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async saveSubasta(subasta: Subasta): Promise<void> {
    await this.redis
      .multi()
      .set(`subasta:${subasta.id}`, JSON.stringify(subasta))
      .set(`subasta:${subasta.id}:puja`, subasta.montoInicial)
      .sadd(INDEX_KEY, subasta.id)
      .exec();
  }

  async getSubasta(id: string): Promise<Subasta | null> {
    const raw = await this.redis.get(`subasta:${id}`);
    return raw ? (JSON.parse(raw) as Subasta) : null;
  }

  async listSubastas(): Promise<Subasta[]> {
    const ids = await this.redis.smembers(INDEX_KEY);
    if (ids.length === 0) return [];

    const raws = await this.redis.mget(ids.map((id: string) => `subasta:${id}`));
    return raws
      .filter((raw: string | null): raw is string => raw !== null)
      .map((raw: string) => JSON.parse(raw) as Subasta);
  }

  async getMontoActual(id: string): Promise<number | null> {
    const monto = await this.redis.get(`subasta:${id}:puja`);
    return monto === null ? null : Number(monto);
  }

  async getHistorial(id: string): Promise<Puja[]> {
    const items = await this.redis.lrange(`subasta:${id}:historial`, 0, -1);
    return items.map((item: string) => JSON.parse(item) as Puja);
  }

  async actualizarSubasta(subasta: Subasta): Promise<void> {
    // A propósito no toca `:puja` ni el índice: solo reescribe los datos
    // del ítem (usado para marcar cierre/ganador sin resetear el monto).
    await this.redis.set(`subasta:${subasta.id}`, JSON.stringify(subasta));
  }

  async determinarGanador(id: string): Promise<string | null> {
    const ultima = await this.redis.lindex(`subasta:${id}:historial`, -1);
    if (!ultima) return null;
    return (JSON.parse(ultima) as Puja).usuario;
  }

  async marcarComoCerrada(id: string, ganador: string | null): Promise<void> {
    const subasta = await this.getSubasta(id);
    if (!subasta) return;
    await this.actualizarSubasta({ ...subasta, cerrada: true, ganador });
  }
}
