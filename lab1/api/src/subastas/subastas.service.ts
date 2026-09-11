import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SubastasRepository } from './subastas.repository.js';
import { CierreRepository } from './cierre.repository.js';
import type { CrearSubastaDto } from './subasta.model.js';

@Injectable()
export class SubastasService {
  constructor(
    private readonly repository: SubastasRepository,
    private readonly cierreRepository: CierreRepository,
  ) {}

  async crear(dto: CrearSubastaDto) {
    if (!dto?.nombre || typeof dto.nombre !== 'string') {
      throw new BadRequestException('nombre es requerido');
    }
    if (!Number.isFinite(dto.montoInicial) || dto.montoInicial <= 0) {
      throw new BadRequestException('montoInicial debe ser un número mayor a 0');
    }
    if (!Number.isFinite(dto.duracionSegundos) || dto.duracionSegundos <= 0) {
      throw new BadRequestException('duracionSegundos debe ser un número mayor a 0');
    }

    const subasta = {
      id: randomUUID(),
      nombre: dto.nombre,
      montoInicial: dto.montoInicial,
      duracionSegundos: dto.duracionSegundos,
      creadaEn: Date.now(),
      cerrada: false,
      ganador: null,
    };

    await this.repository.saveSubasta(subasta);
    await this.cierreRepository.setCierreConTTL(subasta.id, subasta.duracionSegundos);
    return subasta;
  }

  listar() {
    return this.repository.listSubastas();
  }

  async obtenerDetalle(id: string) {
    const subasta = await this.repository.getSubasta(id);
    if (!subasta) return null;

    const [montoActual, historial] = await Promise.all([
      this.repository.getMontoActual(id),
      this.repository.getHistorial(id),
    ]);

    return {
      ...subasta,
      montoActual: montoActual ?? subasta.montoInicial,
      historial,
    };
  }
}
