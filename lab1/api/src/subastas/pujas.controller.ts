import { Body, Controller, HttpCode, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import { PujasService } from './pujas.service.js';
import type { PujarDto } from './subasta.model.js';

@Controller('subastas/:id/pujas')
export class PujasController {
  constructor(private readonly pujasService: PujasService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async pujar(@Param('id') id: string, @Body() dto: PujarDto) {
    const resultado = await this.pujasService.pujarAtomica(id, dto?.monto, dto?.usuario);
    if (!resultado.ok) {
      throw new HttpException(resultado, HttpStatus.CONFLICT);
    }
    return resultado;
  }

  // Demo-only: reproduce el bug de la puja sin atomicidad. No forma parte
  // del contrato de la API, se usa exclusivamente para la demo de
  // "antes/después" del coloquio.
  @Post('ingenua')
  @HttpCode(HttpStatus.OK)
  async pujarIngenua(@Param('id') id: string, @Body() dto: PujarDto) {
    const resultado = await this.pujasService.pujarIngenua(id, dto?.monto, dto?.usuario);
    if (!resultado.ok) {
      throw new HttpException(resultado, HttpStatus.CONFLICT);
    }
    return resultado;
  }
}
