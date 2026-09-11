export interface Subasta {
  id: string;
  nombre: string;
  montoInicial: number;
  duracionSegundos: number;
  creadaEn: number;
  cerrada: boolean;
  ganador: string | null;
}

export interface Puja {
  monto: number;
  usuario: string;
  timestamp: number;
}

export interface CrearSubastaDto {
  nombre: string;
  montoInicial: number;
  duracionSegundos: number;
}
