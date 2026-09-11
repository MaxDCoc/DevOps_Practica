# Proyecto: Sistema de Subastas en Tiempo Real

TP1 de DevOps — UTN FRRe 2026. Grupo de 4 personas.
Entrega: lunes 14 de septiembre (coloquio grupal, nota individual en la defensa).

## Qué estamos construyendo

Una app de subastas: se publica un ítem con tiempo límite, los usuarios pujan,
y gana el monto más alto cuando expira el plazo. Las pujas se ven en vivo sin
refrescar.

El proyecto existe para demostrar conceptos de contenedores y DevOps. La lógica
de subastas es el vehículo, no el objetivo. Ante cualquier duda de prioridades,
gana lo que suma puntos de rúbrica.

## Requisitos obligatorios del TP

Estos no son negociables, vienen de la consigna:

1. App web y API en contenedores separados.
2. Redis contenerizado. **Solo la API accede a Redis**; la web nunca se conecta
   directo.
3. Publicación de imágenes en Docker Hub mediante GitHub Actions.
4. Deploy en cloud **bajando la imagen desde el registry**, no subiendo código
   fuente. Este punto se malinterpreta seguido.
5. CI en GitHub Actions con tests unitarios y SAST. Dos badges en el README:
   estado del CI y valoración del análisis de seguridad.
6. Proxy reverso con 3 réplicas de la API, demostrando balanceo y tolerancia a
   la caída de una instancia. **Esto es obligatorio solo en local.** En la nube
   alcanza con una sola instancia funcional bajada del registry; réplicas en
   cloud es mejora opcional, no requisito (confirmado en la consigna oficial:
   TP1-AppWebRedisContenerizados-DevOps-UTN-2026.pdf). Esto le saca presión al
   día de deploy en cloud: no hace falta resolver Traefik+3 réplicas ahí.

### Reparto de puntos (total 100)

| Ítem | Puntos |
|---|---|
| Apps funcionando (local o nube) | 30 |
| Visualización de variables en Redis | 10 |
| GitHub Actions publicando en registry | 20 |
| CI con tests y SAST | 10 |
| App funcionando en servicio externo | 20 |
| Coloquio (individual) | 10 |

50 de los 100 puntos dependen del pipeline y el deploy, no de la app. Priorizar
en consecuencia.

## Stack

| Capa | Tecnología | Razón |
|---|---|---|
| API | NestJS + TypeScript | Framework robusto con módulos, DI y CLI para escalar rápido |
| Web | React + Vite, servida por nginx | Build estático en imagen multi-stage |
| Estado | Redis 7 alpine | Obligatorio por consigna; permite 3 réplicas coherentes entre sí |
| Proxy | Traefik | Descubre réplicas por labels, sin editar config al escalar |
| Tests | Vitest + Supertest | Vienen con NestJS (desde Nest v12 el CLI genera Vitest, no Jest) |
| SAST | Semgrep o SonarCloud | Semgrep es simple en Actions; Sonar da badge de calidad ya armado |
| Registry | Docker Hub | Obligatorio |
| Cloud | Railway / Render / Cloud Run | Los tres levantan imagen desde Docker Hub |

## Arquitectura

```
Traefik :80
   ├── /        → web (React estático en nginx)
   └── /api     → api x3 (NestJS)
                    └── redis:6379
```

## Contrato de la API

Definido antes de escribir código, para que el front trabaje contra mocks sin
esperar al backend.

```
GET  /api/subastas              → lista
GET  /api/subastas/:id          → detalle + pujas
POST /api/subastas/:id/pujas    → { monto, usuario }
     200 → { ok: true, montoActual }
     409 → { ok: false, motivo: "superada", montoActual }
GET  /api/health                → { status, hostname }
```

`hostname` devuelve el nombre del contenedor que respondió. Se usa en la demo
para evidenciar que el tráfico se reparte entre las 3 réplicas.

## Claves en Redis

```
subasta:{id}              datos del ítem
subasta:{id}:puja         monto actual   ← acceso concurrente, requiere cuidado
subasta:{id}:historial    lista de pujas
subasta:{id}:cierre       clave con TTL para el cierre automático
subastas:index            set con los IDs de todas las subastas (para listar sin usar KEYS)
```

## El problema central: pujas concurrentes

Si dos usuarios pujan el mismo monto en el mismo instante, una implementación
ingenua le responde "ganaste" a ambos. La solución va con `WATCH`/`MULTI`/`EXEC`
o un script Lua, de modo que la comparación y escritura del monto ocurran de
forma atómica.

Esto es lo que justifica el proyecto entero y es la demo principal del coloquio.
No optimizar antes de tener la versión ingenua funcionando: hace falta poder
mostrar el antes y el después.

## Tiempo real con múltiples réplicas

Las actualizaciones en vivo usan WebSockets o SSE. Con 3 réplicas, un evento
emitido desde una instancia no llega a los clientes conectados a las otras. Se
resuelve con el adaptador de Redis para Socket.IO, que propaga los eventos entre
instancias vía Pub/Sub.

Es un segundo argumento independiente de por qué Redis es necesario acá.

## Alcance

**Dentro:** crear subasta, listar, pujar, ver pujas en vivo, cierre automático
por tiempo, determinación del ganador.

**Fuera:** registro con contraseñas (basta con ingresar un nombre), imágenes de
productos, categorías, pagos, historial de usuario.

Si sobra tiempo el domingo, se agrega. Nunca al revés.

## Roles

Cada persona es responsable de un área, pero todos commitean en todas. El
coloquio es individual.

- **Infra:** Dockerfiles multi-stage, docker-compose, Traefik, variables de
  entorno, health checks.
- **Pipeline:** GitHub Actions (tests, SAST, build, push), deploy en cloud desde
  Docker Hub, badges.
- **API:** endpoints, Redis, lógica de puja concurrente, tests unitarios.
- **Front:** React, tiempo real, informe y guion de la demo.

## Calendario

| Día | Objetivo |
|---|---|
| Martes 8 | Repo grupal, contrato de API acordado, Docker andando en las 4 máquinas |
| Miércoles 9 | Esqueleto completo funcionando aunque no haga nada: compose levanta web, API, Redis y Traefik |
| Jueves 10 | Lógica de subastas, workflow completo con push a Docker Hub |
| Viernes 11 | Tiempo real en la web, deploy en cloud desde la imagen |
| Sábado 12 | Demo de concurrencia, tests, SAST, badges |
| Domingo 13 | Congelar código. Informe, README con diagrama, ensayar dos veces |

La regla del miércoles es la más importante: el esqueleto completo primero,
funcionalidad después. Dividir por capas genera bloqueos entre personas.

## Demos a ensayar

1. **Pujas simultáneas.** Versión ingenua (ambos ganan) contra versión corregida
   (uno gana, al otro le llega "te superaron").
2. **Balanceo.** Refrescar y ver hostnames distintos en `/api/health`. Apagar un
   contenedor con `docker stop` y verificar que el sistema sigue respondiendo.
3. **Redis por dentro.** `redis-cli` mostrando el monto actual, el historial y
   el `TTL` de la subasta bajando hasta el cierre automático. Vale 10 puntos
   directos.

## Convenciones

- Todo levanta con `docker compose up`. Si algo requiere pasos manuales, está mal.
- Nada de credenciales en el repo. Usar `.env` con un `.env.example` versionado.
- Commits repartidos entre las 4 personas: el historial se mira en la defensa.
- README con diagrama de arquitectura, un comando para levantar todo, y las
  decisiones técnicas justificadas por escrito.

## Fuentes

- Consigna oficial: `TP1-AppWebRedisContenerizados-DevOps-UTN-2026.pdf`. La
  rúbrica y los requisitos de este archivo están verificados contra ella
  (30/10/20/10/20/10 = 100 puntos). El enunciado permite elegir cualquier app
  propia (no exige ToDo list, ese es solo el ejemplo sugerido) y grupos de
  hasta 3 a 5 personas.
- Material de cátedra: `Contenedores-v9.0-20260824.pdf`. Cubre conceptos base
  (imagen/contenedor/registry/OCI) y buenas prácticas de Dockerfile
  (multi-stage, usuario no root, `.dockerignore`, cache de capas). Referencia
  para quien arme los Dockerfiles, no agrega requisitos nuevos.
