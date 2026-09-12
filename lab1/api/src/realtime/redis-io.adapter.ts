import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

// Sin esto, cada réplica de la API tendría su propia lista de clientes
// conectados por WebSocket, y un evento emitido en la réplica 1 nunca
// llegaría a un cliente conectado a la réplica 2 o 3. El adaptador usa
// Redis Pub/Sub para que las 3 réplicas se avisen entre sí.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
  ) {
    super(app);
  }

  connectToRedis(): void {
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
