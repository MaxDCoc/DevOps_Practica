export interface Subasta {
  id: string;
  nombre: string;
  montoInicial: number;
  duracionSegundos: number;
  creadaEn: number;
  cerrada: boolean;
  ganador: string | null;
  montoActual?: number;
}

export interface Puja {
  monto: number;
  usuario: string;
  timestamp: number;
}

export interface SubastaDetalle extends Subasta {
  montoActual: number;
  historial: Puja[];
}

export interface CrearSubastaPayload {
  nombre: string;
  montoInicial: number;
  duracionSegundos: number;
}

export interface ResultadoPuja {
  ok: boolean;
  montoActual: number;
  motivo?: 'superada' | 'cerrada' | 'igual_o_menor' | string;
}
