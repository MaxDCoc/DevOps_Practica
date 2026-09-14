import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Subasta } from '../subastas/subasta.model.js';

// El path tiene que empezar con /api: Traefik solo enruta a la API lo que
// matchea PathPrefix(`/api`) (ver docker-compose.yml). El cliente de la web
// tiene que conectarse usando este mismo path.
@WebSocketGateway({
  path: '/api/socket.io/',
  cors: { origin: true },
})
export class RealtimeGateway {
  @WebSocketServer()
  private readonly server!: Server;

  @SubscribeMessage('suscribirseASubasta')
  suscribirseASubasta(@ConnectedSocket() client: Socket, @MessageBody() id: string): void {
    client.join(sala(id));
  }

  // "nuevaPuja" (con sala) es para quien está mirando el detalle de esa
  // subasta puntual. "nuevaPujaGlobal" (sin sala, a todos los conectados)
  // es para que el listado pueda actualizar el monto de la card sin que el
  // usuario tenga que entrar al detalle.
  emitNuevaPuja(id: string, payload: { montoActual: number; usuario: string }): void {
    const full = { id, ...payload };
    this.server.to(sala(id)).emit('nuevaPuja', full);
    this.server.emit('nuevaPujaGlobal', full);
  }

  emitSubastaCerrada(id: string, ganador: string | null): void {
    const full = { id, ganador };
    this.server.to(sala(id)).emit('subastaCerrada', full);
    this.server.emit('subastaCerradaGlobal', full);
  }

  // Sin sala: todavía nadie está "suscripto" a una subasta que recién se
  // crea, así que esto siempre va a todos los conectados (para que el
  // listado la agregue sin refrescar).
  emitSubastaCreada(subasta: Subasta): void {
    this.server.emit('subastaCreada', subasta);
  }
}

function sala(id: string): string {
  return `subasta:${id}`;
}
