import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SubastasRepository } from './subastas.repository.js';
import { PujasRepository } from './pujas.repository.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import type { ResultadoPuja, Subasta } from './subasta.model.js';

@Injectable()
export class PujasService {
  constructor(
    private readonly subastasRepository: SubastasRepository,
    private readonly pujasRepository: PujasRepository,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private async validar(id: string, monto: number, usuario: string): Promise<Subasta> {
    const subasta = await this.subastasRepository.getSubasta(id);
    if (!subasta) {
      throw new NotFoundException('Subasta no encontrada');
    }
    if (!usuario || typeof usuario !== 'string') {
      throw new BadRequestException('usuario es requerido');
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new BadRequestException('monto debe ser un número mayor a 0');
    }
    return subasta;
  }

  async pujarAtomica(id: string, monto: number, usuario: string): Promise<ResultadoPuja> {
    const subasta = await this.validar(id, monto, usuario);
    if (subasta.cerrada) {
      return { ok: false, motivo: 'cerrada', montoActual: await this.montoActual(id, subasta) };
    }

    const { gano, montoActual } = await this.pujasRepository.setMontoActualSiSupera(id, monto);
    if (!gano) {
      return { ok: false, motivo: 'superada', montoActual };
    }

    await this.pujasRepository.appendHistorial(id, { monto, usuario, timestamp: Date.now() });
    this.realtimeGateway.emitNuevaPuja(id, { montoActual, usuario });
    return { ok: true, montoActual };
  }

  // Versión rota a propósito, solo para la demo de "antes/después": lee el
  // monto, espera un instante (simula la ventana donde dos pujas se pisan
  // en un sistema real bajo carga) y recién ahí escribe sin volver a
  // comprobar si alguien más ya pujó mientras tanto. Nunca usar fuera de la
  // demo.
  async pujarIngenua(id: string, monto: number, usuario: string): Promise<ResultadoPuja> {
    const subasta = await this.validar(id, monto, usuario);
    if (subasta.cerrada) {
      return { ok: false, motivo: 'cerrada', montoActual: await this.montoActual(id, subasta) };
    }

    const montoActual = await this.subastasRepository.getMontoActual(id);
    if (montoActual !== null && monto <= montoActual) {
      return { ok: false, motivo: 'superada', montoActual };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.pujasRepository.setMontoActualSinVerificar(id, monto);
    await this.pujasRepository.appendHistorial(id, { monto, usuario, timestamp: Date.now() });
    this.realtimeGateway.emitNuevaPuja(id, { montoActual: monto, usuario });
    return { ok: true, montoActual: monto };
  }

  private async montoActual(id: string, subasta: Subasta): Promise<number> {
    const monto = await this.subastasRepository.getMontoActual(id);
    return monto ?? subasta.montoInicial;
  }
}
