import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Subastas CRUD (e2e)', () => {
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

  it('POST /subastas crea una subasta con los datos enviados', async () => {
    const server = app.getHttpServer();

    const res = await request(server)
      .post('/subastas')
      .send({ nombre: 'Bicicleta', montoInicial: 1000, duracionSegundos: 60 })
      .expect(201);

    expect(res.body).toMatchObject({
      nombre: 'Bicicleta',
      montoInicial: 1000,
      duracionSegundos: 60,
      cerrada: false,
      ganador: null,
    });
    expect(typeof res.body.id).toBe('string');
  });

  it('POST /subastas rechaza body inválido con 400', async () => {
    const server = app.getHttpServer();

    await request(server).post('/subastas').send({ nombre: '' }).expect(400);
    await request(server)
      .post('/subastas')
      .send({ nombre: 'X', montoInicial: -5, duracionSegundos: 60 })
      .expect(400);
    await request(server)
      .post('/subastas')
      .send({ nombre: 'X', montoInicial: 10, duracionSegundos: 0 })
      .expect(400);
  });

  it('GET /subastas lista las subastas creadas', async () => {
    const server = app.getHttpServer();

    const { body: creada } = await request(server)
      .post('/subastas')
      .send({ nombre: 'Test listado', montoInicial: 50, duracionSegundos: 60 })
      .expect(201);

    const res = await request(server).get('/subastas').expect(200);
    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(creada.id);
  });

  it('GET /subastas/:id devuelve el detalle con historial vacío recién creada', async () => {
    const server = app.getHttpServer();

    const { body: creada } = await request(server)
      .post('/subastas')
      .send({ nombre: 'Test detalle', montoInicial: 30, duracionSegundos: 60 })
      .expect(201);

    const res = await request(server).get(`/subastas/${creada.id}`).expect(200);

    expect(res.body.montoActual).toBe(30);
    expect(res.body.historial).toEqual([]);
  });

  it('GET /subastas/:id devuelve 404 si no existe', async () => {
    const server = app.getHttpServer();

    await request(server).get('/subastas/no-existe-123').expect(404);
  });
});
