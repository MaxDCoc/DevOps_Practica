import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

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

  emitNuevaPuja(id: string, payload: { montoActual: number; usuario: string }): void {
    this.server.to(sala(id)).emit('nuevaPuja', payload);
  }

  emitSubastaCerrada(id: string, ganador: string | null): void {
    this.server.to(sala(id)).emit('subastaCerrada', { ganador });
  }
}

function sala(id: string): string {
  return `subasta:${id}`;
}
