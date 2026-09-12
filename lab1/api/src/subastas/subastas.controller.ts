import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { SubastasService } from './subastas.service.js';
import type { CrearSubastaDto } from './subasta.model.js';

@Controller('subastas')
export class SubastasController {
  constructor(private readonly subastasService: SubastasService) {}

  @Post()
  crear(@Body() dto: CrearSubastaDto) {
    return this.subastasService.crear(dto);
  }

  @Get()
  listar() {
    return this.subastasService.listar();
  }

  @Get(':id')
  async detalle(@Param('id') id: string) {
    const detalle = await this.subastasService.obtenerDetalle(id);
    if (!detalle) {
      throw new NotFoundException('Subasta no encontrada');
    }
    return detalle;
  }
}
