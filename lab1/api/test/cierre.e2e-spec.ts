import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Cierre automático (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // El cierre depende de que Redis expire la clave `:cierre` y dispare el
  // evento `expired` que escucha CierreListener (requiere
  // notify-keyspace-events Ex prendido en el Redis contra el que corre
  // esto). No hay forma de adelantar ese reloj desde el test, así que se
  // usa un TTL corto real y se espera con margen.
  it(
    'una subasta se cierra sola al vencer el tiempo y marca ganador al último postor',
    async () => {
      const server = app.getHttpServer();

      const { body: subasta } = await request(server)
        .post('/subastas')
        .send({ nombre: 'Test cierre', montoInicial: 100, duracionSegundos: 2 })
        .expect(201);

      await request(server)
        .post(`/subastas/${subasta.id}/pujas`)
        .send({ monto: 150, usuario: 'carla' })
        .expect(200);

      await esperar(3500);

      const detalle = await request(server).get(`/subastas/${subasta.id}`).expect(200);
      expect(detalle.body.cerrada).toBe(true);
      expect(detalle.body.ganador).toBe('carla');
    },
    10000,
  );

  it(
    'una subasta sin pujas se cierra sin ganador',
    async () => {
      const server = app.getHttpServer();

      const { body: subasta } = await request(server)
        .post('/subastas')
        .send({ nombre: 'Test cierre sin pujas', montoInicial: 100, duracionSegundos: 2 })
        .expect(201);

      await esperar(3500);

      const detalle = await request(server).get(`/subastas/${subasta.id}`).expect(200);
      expect(detalle.body.cerrada).toBe(true);
      expect(detalle.body.ganador).toBeNull();
    },
    10000,
  );
});
