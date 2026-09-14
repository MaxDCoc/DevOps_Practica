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

**Web** ✅
- [x] Vista listado de subastas
- [x] Vista detalle de una subasta
- [x] Alta de subasta (formulario con presets de duración y validación)

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

## Fase 2 — Puja concurrente (el corazón del proyecto) ✅ (completa, verificada con tests e2e y a mano vía Traefik)

**Redis** — `api/src/subastas/pujas.repository.ts`
- [x] `getMontoActual(id)` (ya estaba de Fase 1)
- [x] `setMontoActualSiSupera(id, monto)` — atómico, con **script Lua**
      (`PUJAR_ATOMICO_SCRIPT`, registrado como comando custom
      `pujarAtomico` vía `redis.defineCommand`). Se eligió Lua en vez de
      `WATCH/MULTI/EXEC` porque resuelve la atomicidad en un solo viaje a
      Redis, sin loop de reintento.
- [x] `appendHistorial(id, { monto, usuario, timestamp })`
- [x] `setMontoActualSinVerificar(id, monto)` — sin chequeo, solo para la
      versión ingenua

**API** — `api/src/subastas/pujas.{service,controller}.ts`
- [x] `pujarAtomica(id, monto, usuario)` — versión corregida
- [x] `pujarIngenua(id, monto, usuario)` — versión rota a propósito (lee,
      espera 200ms simulando la ventana de carrera, escribe sin
      revalidar), para el demo antes/después
- [x] `POST /api/subastas/:id/pujas` →
      `200 { ok: true, montoActual }` /
      `409 { ok: false, motivo: "superada", montoActual }`
- [x] `POST /api/subastas/:id/pujas/ingenua` — mismo contrato, usa la
      versión rota (demo-only, no forma parte del contrato "real"; ver
      AGENTS.md)
- [x] Test e2e (`api/test/pujas-concurrencia.e2e-spec.ts`): dos pujas
      simultáneas al mismo monto en la versión atómica → una gana (200) y
      la otra recibe 409 "superada"; la misma prueba contra la versión
      ingenua confirma que ahí ganan las dos (el bug reproducido a
      propósito)

**Verificado dos formas:** `npm run test:e2e` (contra Redis real en
`localhost:6379`, hay que tener `docker compose up -d redis` corriendo) y
a mano con `curl` en paralelo contra `http://localhost/api/...` (el camino
real de Traefik), con el mismo resultado en ambos casos.

**Nota:** para que los tests e2e corran localmente sin Docker Desktop
completo, se expuso el puerto de Redis al host (`6379:6379` en
`docker-compose.yml`). No es necesario para producción, solo para poder
testear desde la máquina sin entrar al contenedor.

## Fase 3 — Cierre automático ✅ (completa, verificada con `docker compose up` esperando el TTL real)

- [x] `setCierreConTTL(id, segundos)` al crear la subasta —
      `api/src/subastas/cierre.repository.ts`, llamado desde
      `SubastasService.crear()`
- [x] Habilitar `notify-keyspace-events Ex` en Redis — `command` del
      servicio `redis` en `docker-compose.yml`
- [x] Listener de eventos `expired` (`__keyevent@0__:expired`) —
      `api/src/subastas/cierre.listener.ts`, usando una segunda conexión
      dedicada (`redis.duplicate()`) porque una conexión en modo
      `subscribe` no puede usarse para otros comandos
- [x] `onSubastaExpirada(id)` — mismo archivo, se dispara desde el handler
      del mensaje
- [x] `determinarGanador(id)` — `subastas.repository.ts`: toma el último
      elemento del historial (con `pujarAtomica`, el historial solo
      contiene pujas ganadoras en orden, así que el último es el ganador;
      `null` si nunca hubo pujas)
- [x] `marcarComoCerrada(id, ganador)` — `subastas.repository.ts`, reescribe
      solo el registro `subasta:{id}` (no toca `:puja` ni el índice)

**Extra que no estaba en el checklist pero era necesario:** con el cierre
ya andando, se podía seguir pujando en una subasta cerrada (el script Lua
solo compara montos, no mira la bandera `cerrada`). Se agregó el chequeo en
`PujasService`: pujar sobre una subasta cerrada ahora responde
`409 { ok: false, motivo: "cerrada", montoActual }`. Documentado en
AGENTS.md.

**Verificado a mano contra el stack real:** subasta con `duracionSegundos`
corto (3-5s), se puja, se espera el vencimiento, y el detalle pasa solo a
`cerrada: true` con el `ganador` correcto (o `null` si nadie pujó). El log
de `CierreListener` confirma el evento disparado.

## Fase 4 — Tiempo real multi-réplica ✅ (backend y Web integrados)

**API** — `api/src/realtime/`
- [x] WebSocket Gateway (NestJS + Socket.IO) — `realtime.gateway.ts`, path
      `/api/socket.io/` (no el default `/socket.io/`, para que Traefik lo
      enrute a la API igual que el resto de `/api`)
- [x] `emitNuevaPuja(id, payload)` — llamado desde `PujasService` (tanto en
      `pujarAtomica` como en `pujarIngenua`, para que la demo del bug
      también se vea en vivo)
- [x] `emitSubastaCerrada(id, ganador)` — llamado desde `CierreListener`
      cuando se cierra la subasta (Fase 3)
- [x] Adaptador Redis para Socket.IO — `redis-io.adapter.ts`, conectado en
      `main.ts` con dos conexiones dedicadas (`redisClient.duplicate()`
      x2, una para publish y otra para subscribe, igual que en
      `CierreListener`)

**Web** ✅
- [x] `connectSocket()`
- [x] `suscribirseASubasta(id)`
- [x] Actualizar UI en vivo al recibir `nuevaPuja` (sin refrescar)
- [x] Actualizar UI al recibir `subastaCerrada`

**Contrato de WebSocket documentado en AGENTS.md** (path, eventos, ejemplo
de cliente) para que Front pueda arrancar sin esperar nada más.

**Verificado end-to-end** con un cliente `socket.io-client` de prueba
contra el stack real (a través de Traefik en `http://localhost`): se creó
una subasta, se pujó, y llegaron los dos eventos (`nuevaPuja` y
`subastaCerrada` con el ganador) en tiempo real, sin polling.

**Pendiente de verificar recién en Fase 6:** que el adaptador de Redis
realmente propague eventos *entre* réplicas distintas (ahora mismo solo
hay una instancia de la API corriendo, así que no hay nada que propagar
todavía). La demo real de esto es con las 3 réplicas ya levantadas.

## Fase 5 — Identificación simple del usuario 🙋 (asignada a un compañero, en curso)

- [x] Pantalla/modal para ingresar nombre (sin contraseña)
- [x] Guardar nombre en `localStorage`/`sessionStorage`
- [x] Enviar el nombre como `usuario` en cada puja

## Fase 6 — Infra completa (3 réplicas + balanceo) ✅

- [x] `docker-compose` con 3 instancias de la API detrás de Traefik
      (`api1` / `api2` / `api3`, labels Traefik compartidas + sticky cookie)
- [x] Healthcheck de cada instancia usando `GET /api/health`
- [x] Verificar: refrescar y ver hostnames distintos
- [x] Verificar: `docker stop` de una instancia sin caída del servicio
- [x] Lock Redis `SET NX` en `CierreListener` para que solo una réplica
      cierre la subasta al expirar el TTL

## Fase 7 — Pipeline CI/CD ✅

- [x] Job `test` (npm ci + Vitest unitarios en `lab1/api`)
- [x] Job `sast` (Semgrep en `.github/workflows/sast.yml`)
- [x] Job `build-and-push` (build + push de imagen web y api a Docker Hub)
- [x] Badge de estado del CI en el README
- [x] Badge de valoración del análisis de seguridad en el README (workflow SAST)

**Badges:** el SVG de Actions sin query mira la rama **default** (`main`).
Si el pipeline solo corrió en `fases6y7`, el badge muestra "no status"
aunque el commit tenga check verde. Usar:

```
https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/ci.yml/badge.svg?branch=fases6y7
https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/sast.yml/badge.svg?branch=fases6y7
```

Al mergear a `main`, sacar el `?branch=...` (o cambiarlo a `main`) para que
reflejen la rama default. Triggers de CI/SAST incluyen `fases6y7`.

## Fase 8 — Deploy en la nube ✅ (desplegado y verificado en Railway)

**Problema que había que resolver primero:** el código de la web usa rutas
relativas (`fetch('/api/subastas')`). Localmente eso funciona porque
Traefik intercepta `/api` antes de que llegue a nginx. En la nube, si `web`
y `api` son dos servicios con URLs públicas distintas, esas mismas rutas
relativas apuntarían al dominio de la web y darían 404 — y agregar CORS +
una URL absoluta hardcodeada en el código de React hubiera sido tocar
código de Front para un problema de infra.

- [x] `web/nginx.conf.template` — el propio nginx de la imagen `web`
      reenvía `/api/*` hacia `API_URL` (variable de entorno del
      contenedor). Cero cambios en `web/src`: el fetch relativo sigue
      funcionando igual, local y en la nube.
- [x] `web/Dockerfile` copia esa plantilla a
      `/etc/nginx/templates/default.conf.template` (la imagen oficial de
      nginx la procesa sola al arrancar).
- [x] `docker-compose.yml`: `API_URL=http://api1:3000` como default local
      (nunca se usa de verdad ahí, pero nginx necesita un valor válido para
      no fallar al arrancar).
- [x] Fix de una carrera real encontrada al probar esto: nginx resolvía el
      host de `proxy_pass` una sola vez al arrancar, y si el contenedor
      destino todavía no estaba listo, nginx no levantaba. Se arregló con
      `resolver 127.0.0.11` (DNS interno de Docker) + `set` para forzar
      resolución por request en vez de al inicio.
- [x] Verificado que el fix no rompió nada local: `docker compose up`,
      balanceo entre las 3 réplicas y creación de subastas siguen andando.

**Deploy en Railway (3 servicios, todos desde imagen de Docker Hub, no
build desde código):**
- [x] Proveedor: Railway (permite pasarle un comando custom al contenedor
      de Redis, necesario para `--notify-keyspace-events Ex`; la mayoría
      de los Redis "administrados" gratuitos no dejan tocar esa config, y
      sin eso el cierre automático de la Fase 3 no funciona en la nube)
- [x] Servicio `redis` — imagen `redis:7-alpine`, comando
      `redis-server --notify-keyspace-events Ex`, sin dominio público
      (solo red privada)
- [x] Servicio `api` — imagen `mateodiezq/subastas-api:latest`, puerto
      3000, env vars `REDIS_HOST=redis.railway.internal`, `REDIS_PORT=6379`,
      `PORT=3000`, dominio público generado
- [x] Servicio `web` — imagen `mateodiezq/subastas-web:latest`, puerto 80,
      env vars `API_URL=http://api.railway.internal:3000` (red privada,
      **no** la URL pública: conectarse a la propia URL pública desde
      adentro de la misma nube falló por "hairpin"/loopback bloqueado) y
      `NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1`
- [x] Una sola instancia de cada uno (cumple la consigna: en la nube
      alcanza con eso, réplicas ahí es mejora opcional)

**Bugs reales encontrados y resueltos durante el deploy** (quedan también
como material para el informe/coloquio, sección "dificultades"):
1. Railway devolvía "Application failed to respond" en `web` — el target
   port del dominio público no coincidía con el 80 real de nginx.
2. `nginx` no arrancaba (`host not found in resolver`) — el resolver
   hardcodeado (`127.0.0.11`, DNS de Docker) no existe fuera de
   docker-compose. Se resolvió usando `NGINX_LOCAL_RESOLVERS`, una función
   de la propia imagen oficial de nginx que autodetecta el resolver
   correcto leyendo `/etc/resolv.conf` del contenedor (hay que activarla
   con `NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1`, viene apagada por defecto).
3. Con el resolver ya andando, `nginx` sí resolvía el dominio público de
   la API pero fallaba al conectarse (`Address not available`, errno 99):
   problema de "hairpin" — conectarse a la propia IP pública desde dentro
   de la misma nube. Se resolvió usando la red privada de Railway
   (`api.railway.internal:3000`) en vez del dominio público.
4. Ya funcionando el deploy, el monto y el estado de la subasta no se
   actualizaban solos en la pantalla: `useSubastaSocket.ts` intentaba
   suscribirse a la sala de la subasta en un efecto separado que podía
   correr antes de que el socket terminara de conectar, y nunca
   reintentaba. Se arregló re-suscribiendo en cada evento `connect`
   (usando un ref para tener siempre el id más reciente), no solo cuando
   cambia el id de la subasta.

## Fase 9 — Tests unitarios ✅ (15 tests e2e, corriendo en local y en CI)

- [x] Test de concurrencia de `pujarAtomica` (simular condición de carrera)
      — ya existía de la Fase 2, `api/test/pujas-concurrencia.e2e-spec.ts`
      (incluye también el caso ingenuo: dos ganadores a propósito, para el
      contraste de la demo)
- [x] Tests de endpoints con Supertest: crear, listar, pujar, health
      — `api/test/health.e2e-spec.ts`, `subastas.e2e-spec.ts`,
      `pujas.e2e-spec.ts` (casos felices + 400/404/409)
- [x] Test de cierre automático (TTL real corto, no mockeado — el cierre
      depende de un evento real de Redis vía Pub/Sub, no se puede simular
      con timers falsos) — `api/test/cierre.e2e-spec.ts`, cubre el caso
      con ganador y el caso sin pujas

**Hallazgo importante mientras se hacía esto:** `npm test` (lo que corría
el CI) solo matchea archivos `*.spec.ts`. Todos los tests reales —
incluido el de concurrencia que ya existía desde la Fase 2— son
`*.e2e-spec.ts`, así que **el CI nunca los estaba ejecutando**, aunque
estuvieran en el repo. Se corrigió `.github/workflows/ci.yml`:
- Se agregó un servicio `redis:7-alpine` al job de tests.
- Un paso nuevo habilita `notify-keyspace-events Ex` con `redis-cli` antes
  de correr los tests (si no, el test de cierre automático fallaría en CI
  aunque funcione en local).
- El job ahora corre `npm test` **y** `npm run test:e2e`.

**Verificado en local:** `npm run test:e2e` → 6 archivos, 15 tests, todos
en verde, contra el Redis real de `docker-compose`.

## Fase 10 — Documentación final ✅ (este README, rama docs/fase10-documentacion)

- [x] README con diagrama de arquitectura
- [x] README con el comando único para levantar todo (`docker compose up`)
- [x] README con las decisiones técnicas justificadas
- [x] Informe: resultados obtenidos, dificultades encontradas, mejoras
      futuras
