import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Pujas concurrentes (e2e)', () => {
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

  it('si dos usuarios pujan el mismo monto al mismo tiempo, solo uno gana', async () => {
    const server = app.getHttpServer();

    const { body: subasta } = await request(server)
      .post('/subastas')
      .send({ nombre: 'Test concurrencia', montoInicial: 100, duracionSegundos: 60 })
      .expect(201);

    const [respuestaA, respuestaB] = await Promise.all([
      request(server).post(`/subastas/${subasta.id}/pujas`).send({ monto: 200, usuario: 'ana' }),
      request(server).post(`/subastas/${subasta.id}/pujas`).send({ monto: 200, usuario: 'beto' }),
    ]);

    const resultados = [respuestaA, respuestaB];
    const ganadores = resultados.filter((r) => r.status === 200 && r.body.ok === true);
    const superados = resultados.filter((r) => r.status === 409 && r.body.motivo === 'superada');

    expect(ganadores).toHaveLength(1);
    expect(superados).toHaveLength(1);
    expect(ganadores[0]!.body.montoActual).toBe(200);
  });

  it('la versión ingenua deja ganar a las dos pujas simultáneas (bug a propósito)', async () => {
    const server = app.getHttpServer();

    const { body: subasta } = await request(server)
      .post('/subastas')
      .send({ nombre: 'Test bug ingenuo', montoInicial: 100, duracionSegundos: 60 })
      .expect(201);

    const [respuestaA, respuestaB] = await Promise.all([
      request(server)
        .post(`/subastas/${subasta.id}/pujas/ingenua`)
        .send({ monto: 200, usuario: 'ana' }),
      request(server)
        .post(`/subastas/${subasta.id}/pujas/ingenua`)
        .send({ monto: 200, usuario: 'beto' }),
    ]);

    const ganadores = [respuestaA, respuestaB].filter(
      (r) => r.status === 200 && r.body.ok === true,
    );

    expect(ganadores).toHaveLength(2);
  });
});
