import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SubastasRepository } from './subastas.repository.js';
import { PujasRepository } from './pujas.repository.js';
import type { ResultadoPuja } from './subasta.model.js';

@Injectable()
export class PujasService {
  constructor(
    private readonly subastasRepository: SubastasRepository,
    private readonly pujasRepository: PujasRepository,
  ) {}

  private async validar(id: string, monto: number, usuario: string) {
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
  }

  async pujarAtomica(id: string, monto: number, usuario: string): Promise<ResultadoPuja> {
    await this.validar(id, monto, usuario);

    const { gano, montoActual } = await this.pujasRepository.setMontoActualSiSupera(id, monto);
    if (!gano) {
      return { ok: false, motivo: 'superada', montoActual };
    }

    await this.pujasRepository.appendHistorial(id, { monto, usuario, timestamp: Date.now() });
    return { ok: true, montoActual };
  }

  // Versión rota a propósito, solo para la demo de "antes/después": lee el
  // monto, espera un instante (simula la ventana donde dos pujas se pisan
  // en un sistema real bajo carga) y recién ahí escribe sin volver a
  // comprobar si alguien más ya pujó mientras tanto. Nunca usar fuera de la
  // demo.
  async pujarIngenua(id: string, monto: number, usuario: string): Promise<ResultadoPuja> {
    await this.validar(id, monto, usuario);

    const montoActual = await this.subastasRepository.getMontoActual(id);
    if (montoActual !== null && monto <= montoActual) {
      return { ok: false, motivo: 'superada', montoActual };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.pujasRepository.setMontoActualSinVerificar(id, monto);
    await this.pujasRepository.appendHistorial(id, { monto, usuario, timestamp: Date.now() });
    return { ok: true, montoActual: monto };
  }
}
