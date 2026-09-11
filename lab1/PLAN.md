# Plan de desarrollo — Sistema de Subastas

## Qué es este proyecto

TP1 de DevOps (UTN FRRe 2026), a entregar el lunes 14/9. Es una app de
subastas en tiempo real: se publica un ítem con un tiempo límite, los
usuarios pujan, y gana el monto más alto cuando expira el plazo. Las pujas
se ven en vivo sin refrescar la página.

La lógica de subastas es el vehículo, no el objetivo real del trabajo: el
TP existe para demostrar conceptos de contenedores y DevOps (web y API
contenerizadas por separado, Redis como único punto de acceso desde la
API, publicación de imágenes en Docker Hub vía GitHub Actions, deploy en
la nube bajando la imagen del registry, CI con tests y SAST, y un proxy
reverso con 3 réplicas de la API demostrando balanceo y tolerancia a
fallos). El detalle completo de la consigna, el stack y las decisiones
técnicas está en [AGENTS.md](./AGENTS.md).

Backlog técnico dividido en fases. Cada fase habilita a la siguiente
(orden de dependencias, no de días). Tildar `- [ ]` a medida que se
completa cada función. Si aparece algo nuevo durante el desarrollo,
agregarlo en la fase que corresponda.

Contexto técnico completo (stack, arquitectura, contrato de API, claves de
Redis, alcance, convenciones): ver [AGENTS.md](./AGENTS.md).

## Cómo repartir el trabajo sin pisarse

Respuesta corta: sí, hay fases enteras que se pueden hacer en paralelo, y
también hay partes paralelizables dentro de las fases que son secuenciales.
La clave para no pisarse en los commits es simple: **cada persona trabaja en
carpetas/archivos distintos**.

### Fases que se pueden arrancar YA, en paralelo con todo lo demás

Estas no tocan `api/src` ni `web/src`, así que no compiten por los mismos
archivos que la lógica de subastas:

- **Fase 7 completa (Pipeline CI/CD)** — solo toca `.github/workflows/` y el
  README. No necesita que la lógica de subastas exista: el job de tests ya
  puede correr `npm test` desde el día 1 (hay un test de ejemplo
  scaffoldeado en Fase 0), y el job de build+push funciona con cualquier
  Dockerfile, tenga lógica adentro o no.
- **Fase 6 completa (3 réplicas + balanceo)** — solo toca
  `docker-compose.yml` y las labels de Traefik. Alcanza con que el
  contenedor responda `/api/health` (ya funciona desde la Fase 0), no hace
  falta que haya subastas ni pujas todavía.
- **Fase 8 (deploy en la nube)** — en su mayoría independiente
  (configuración del proveedor cloud), aunque conviene esperar a tener al
  menos la Fase 2 andando para que la demo en la nube muestre algo más que
  un health check.
- **Fase 10 (documentación)** — README e informe se van escribiendo en
  paralelo con todo el desarrollo, a medida que se toman decisiones.
  Congelar recién al final (Domingo).

### La columna vertebral del backend NO se puede paralelizar

Fase 1 → Fase 2 → Fase 3 → Fase 4 (la parte de API) son secuenciales de
verdad, cada una depende de que la anterior exista:

- Fase 2 (pujar) necesita poder crear y leer subastas de Redis (Fase 1).
- Fase 3 (cierre automático) necesita el historial de pujas para determinar
  el ganador (Fase 2).
- Fase 4 (tiempo real) emite eventos de "nueva puja" y "subasta cerrada"
  que no existen hasta que Fase 2 y 3 estén.

Esto no obliga a que una sola persona haga las cuatro: significa que
conviene que **una sola persona a la vez** esté tocando esos módulos de la
API, en orden, para no generar conflictos. Es ideal para que la lleve una
persona de punta a punta, o que se la vayan pasando entre dos.

### Lo que SÍ se paraleliza dentro de esas fases secuenciales

El contrato de API ya está congelado en `AGENTS.md`. Mientras la API
construye la lógica real, la Web puede construir la pantalla
correspondiente contra datos falsos (mocks) que respeten ese contrato, sin
esperar a que el backend esté terminado:

- Mientras alguien hace `POST /api/subastas/:id/pujas` de verdad (Fase 2,
  api), otra persona arma la pantalla de puja en la web contra un mock que
  devuelve `{ ok: true, montoActual }`. Cuando ambas partes están listas,
  se conecta el mock real y listo.
- Lo mismo con Fase 4: alguien arma el WebSocket Gateway en la API mientras
  otra persona arma el cliente de sockets en la web contra un servidor de
  prueba o eventos simulados.

### Los puntos de fricción reales (donde sí nos podemos pisar)

1. **`api/src/app.module.ts`** — cada módulo nuevo (subastas, pujas,
   websocket) se registra acá. Si dos personas agregan un módulo al mismo
   tiempo, van a chocar en este archivo (conflicto chico y fácil de
   resolver, pero va a pasar). Mitigación: avisar antes de tocarlo, o
   mergear de a uno.
2. **`web/src/App.tsx`** — hoy es un solo archivo con todo adentro. Si dos
   personas de Front tocan pantallas distintas ahí, van a chocar todo el
   tiempo. Antes de repartir Fase 1 (web) y Fase 5, conviene separar en
   componentes/rutas (por ejemplo con React Router:
   `ListadoSubastas.tsx`, `DetalleSubasta.tsx`, `IdentificarUsuario.tsx`)
   para que cada uno edite su propio archivo.
3. **El servicio de Redis (`api/src/redis/`)** — las funciones de Fase 1, 2
   y 3 se van sumando ahí. Si las agrega siempre la misma persona, no hay
   drama; si son personas distintas, conviene separar por responsabilidad
   (`subastas.repository.ts`, `pujas.repository.ts`) en vez de un único
   archivo gigante compartido.

### Resumen: quién puede arrancar ya mismo, sin esperar a nadie

| Rol | Puede arrancar ya con |
|---|---|
| Infra | Fase 6 (réplicas) |
| Pipeline | Fase 7 (CI/CD) y el arranque de Fase 8 (cloud) |
| API | Fase 1 → 2 → 3 → 4, en ese orden, sin saltear pasos |
| Front | Fase 1 (web, contra mocks) → Fase 5 → Fase 4 (cliente de sockets, contra mocks) |

Los cuatro pueden estar trabajando el mismo día sin bloquearse, siempre que
Front use mocks alineados al contrato de `AGENTS.md` mientras espera que la
API real esté lista.

## Fase 0 — Esqueleto que levanta ✅ (completa, verificada con `docker compose up`)

**Infra**
- [x] `Dockerfile` de la web (multi-stage: build Vite → runtime nginx)
- [x] `Dockerfile` de la API (multi-stage: build Nest → runtime Node)
- [x] `docker-compose.yml` con web, api, redis y traefik
- [x] Labels de Traefik: `/` → web, `/api` → api
- [x] `.env.example`

**API**
- [x] `GET /api/health` → `{ status, hostname }` (hostname = nombre del
      contenedor). Nest expone todo bajo prefijo global `api` (ver
      `api/src/main.ts`), por eso el controller vive en `api/src/health/`
      con ruta `health` y termina siendo `/api/health`.

**Web**
- [x] Fetch a `/api/health` y mostrarlo en pantalla (sin estilo todavía)

**Nota de troubleshooting (por si les pasa lo mismo):** el healthcheck de
la API usaba `wget http://localhost:3000/...`, pero dentro del contenedor
`localhost` resuelve primero a `::1` (IPv6) y el server de Nest solo
escucha en IPv4 (`0.0.0.0`), así que la conexión se rechazaba, Docker
marcaba el contenedor "unhealthy" y Traefik dejaba de enrutarle tráfico a
`/api` (mandaba todo a la web, que devolvía 404). Se resolvió cambiando el
healthcheck a `http://127.0.0.1:3000/...`. Si arman healthchecks para otros
servicios, usen `127.0.0.1`, no `localhost`.

## Fase 1 — Modelo de datos y CRUD de subastas 🔶 (backend listo, falta Web)

**Redis (servicio dentro de la API)** — `api/src/subastas/subastas.repository.ts`
- [x] `saveSubasta(subasta)`
- [x] `getSubasta(id)`
- [x] `listSubastas()`
- [x] `getMontoActual(id)` (adelantado de Fase 2, lo pedía el detalle)
- [x] `getHistorial(id)` (adelantado de Fase 2, lo pedía el detalle; devuelve
      `[]` hasta que Fase 2 empiece a escribir con `appendHistorial`)

**API** — `api/src/subastas/subastas.{controller,service}.ts`
- [x] `POST /api/subastas` — crear subasta (nombre, monto inicial, duración)
- [x] `GET /api/subastas` — listar
- [x] `GET /api/subastas/:id` — detalle + historial de pujas (404 si no
      existe)
- [x] Validación manual básica (400 si falta nombre, o los montos/duración
      no son números positivos)

**Web** (queda para la rama de frontend, contra el contrato ya congelado)
- [ ] Vista listado de subastas
- [ ] Vista detalle de una subasta
- [ ] Alta de subasta (formulario o seed de datos de prueba)

**Decisión técnica:** para listar sin usar `KEYS subasta:*` (mala práctica
en Redis en producción), se agregó un Set `subastas:index` con todos los
IDs. Ya está documentado en `AGENTS.md`. Cliente de Redis: `ioredis`
(elegido pensando en Fase 2 — transacciones `MULTI/EXEC` — y Fase 4 —
adaptador de Socket.IO). Vive en `api/src/redis/redis.module.ts` como
módulo `@Global()`, así Fase 2 y Fase 4 lo inyectan sin volver a
configurarlo.

**Nota de troubleshooting (ioredis + ESM):** con `"module": "nodenext"` en
el `tsconfig.json`, `import Redis from 'ioredis'` rompe la compilación
(“This expression is not constructable”). Hay que usar el import con
nombre: `import { Redis } from 'ioredis'`.

**Verificado end-to-end** con `docker compose up` (crear, listar, detalle,
404 en subasta inexistente, 400 en body inválido, y las claves de Redis
inspeccionadas con `redis-cli`).

## Fase 2 — Puja concurrente (el corazón del proyecto)

- [ ] `pujarIngenua(id, monto, usuario)` — versión sin atomicidad, a
      propósito, para mostrar el bug en la demo (buscar monto, comparar en
      JS, guardar)
- [ ] `getMontoActual(id)`
- [ ] `setMontoActualSiSupera(id, monto)` — atómico, con `WATCH/MULTI/EXEC`
      o script Lua (`evalPuja.lua`)
- [ ] `pujarAtomica(id, monto, usuario)` — versión corregida, usa la
      función anterior
- [ ] `appendHistorial(id, { monto, usuario, timestamp })`
- [ ] `getHistorial(id)`
- [ ] `POST /api/subastas/:id/pujas` →
      `200 { ok: true, montoActual }` /
      `409 { ok: false, motivo: "superada", montoActual }`
- [ ] Test: dos pujas simultáneas al mismo monto → solo una gana

## Fase 3 — Cierre automático

- [ ] `setCierreConTTL(id, segundos)` al crear la subasta
- [ ] Habilitar `notify-keyspace-events Ex` en la config de Redis
- [ ] Listener de eventos `expired` (`__keyevent@0__:expired`)
- [ ] `onSubastaExpirada(id)`
- [ ] `determinarGanador(id)`
- [ ] `marcarComoCerrada(id)`

## Fase 4 — Tiempo real multi-réplica

**API**
- [ ] WebSocket Gateway (NestJS + Socket.IO)
- [ ] `emitNuevaPuja(id, payload)`
- [ ] `emitSubastaCerrada(id, ganador)`
- [ ] Adaptador Redis para Socket.IO (pub/sub entre las 3 réplicas)

**Web**
- [ ] `connectSocket()`
- [ ] `suscribirseASubasta(id)`
- [ ] Actualizar UI en vivo al recibir `nuevaPuja` (sin refrescar)
- [ ] Actualizar UI al recibir `subastaCerrada`

## Fase 5 — Identificación simple del usuario 🙋 (asignada a un compañero, en curso)

- [ ] Pantalla/modal para ingresar nombre (sin contraseña)
- [ ] Guardar nombre en `localStorage`/`sessionStorage`
- [ ] Enviar el nombre como `usuario` en cada puja

## Fase 6 — Infra completa (3 réplicas + balanceo)

- [ ] `docker-compose` con 3 instancias de la API detrás de Traefik
- [ ] Healthcheck de cada instancia usando `GET /api/health`
- [ ] Verificar: refrescar y ver hostnames distintos
- [ ] Verificar: `docker stop` de una instancia sin caída del servicio

## Fase 7 — Pipeline CI/CD

- [ ] Job `test` (npm ci + jest)
- [ ] Job `sast` (Semgrep u otra herramienta)
- [ ] Job `build-and-push` (build + push de imagen web y api a Docker Hub)
- [ ] Badge de estado del CI en el README
- [ ] Badge de valoración del análisis de seguridad en el README

## Fase 8 — Deploy en la nube

- [ ] Servicio en Railway/Render/Cloud Run configurado para bajar la
      imagen desde Docker Hub (no build desde código fuente)
- [ ] Variables de entorno cargadas en el proveedor cloud
- [ ] Nota: acá alcanza con **una sola instancia** funcionando; réplicas en
      cloud es mejora opcional, no requisito

## Fase 9 — Tests unitarios

- [ ] Test de concurrencia de `pujarAtomica` (simular condición de carrera)
- [ ] Tests de endpoints con Supertest: crear, listar, pujar, health
- [ ] Test de cierre automático (TTL simulado/mockeado)

## Fase 10 — Documentación final

- [ ] README con diagrama de arquitectura
- [ ] README con el comando único para levantar todo (`docker compose up`)
- [ ] README con las decisiones técnicas justificadas
- [ ] Informe: resultados obtenidos, dificultades encontradas, mejoras
      futuras
