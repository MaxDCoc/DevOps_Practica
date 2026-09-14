import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Pujas (e2e)', () => {
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

  async function crearSubasta(server: App, montoInicial = 100) {
    const { body } = await request(server)
      .post('/subastas')
      .send({ nombre: 'Test puja', montoInicial, duracionSegundos: 60 })
      .expect(201);
    return body as { id: string };
  }

  it('una puja válida sube el monto y queda en el historial', async () => {
    const server = app.getHttpServer();
    const subasta = await crearSubasta(server);

    const res = await request(server)
      .post(`/subastas/${subasta.id}/pujas`)
      .send({ monto: 150, usuario: 'ana' })
      .expect(200);

    expect(res.body).toEqual({ ok: true, montoActual: 150 });

    const detalle = await request(server).get(`/subastas/${subasta.id}`).expect(200);
    expect(detalle.body.montoActual).toBe(150);
    expect(detalle.body.historial).toHaveLength(1);
    expect(detalle.body.historial[0]).toMatchObject({ monto: 150, usuario: 'ana' });
  });

  it('una puja menor o igual al monto actual devuelve 409 "superada"', async () => {
    const server = app.getHttpServer();
    const subasta = await crearSubasta(server, 100);

    const res = await request(server)
      .post(`/subastas/${subasta.id}/pujas`)
      .send({ monto: 100, usuario: 'ana' })
      .expect(409);

    expect(res.body).toEqual({ ok: false, motivo: 'superada', montoActual: 100 });
  });

  it('pujar sin usuario devuelve 400', async () => {
    const server = app.getHttpServer();
    const subasta = await crearSubasta(server);

    await request(server)
      .post(`/subastas/${subasta.id}/pujas`)
      .send({ monto: 150 })
      .expect(400);
  });

  it('pujar en una subasta inexistente devuelve 404', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/subastas/no-existe-123/pujas')
      .send({ monto: 150, usuario: 'ana' })
      .expect(404);
  });
});
