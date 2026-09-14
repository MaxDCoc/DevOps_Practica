# Sistema de Subastas en Vivo — Explicado en simple

![CI](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/ci.yml/badge.svg?branch=docs%2Ffase10-documentacion)
![SAST](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/sast.yml/badge.svg?branch=docs%2Ffase10-documentacion)

> Las dos insignias de arriba son controles automáticos: la primera dice si las pruebas pasaron, la segunda si el revisor de seguridad encontró problemas. Si están en verde, está todo bien.

Este es el trabajo práctico N°1 de DevOps (UTN, 2026). Es una página web para hacer **subastas en vivo**, como las de un remate: alguien publica algo para vender con un tiempo límite, la gente ofrece plata (puja), y cuando se acaba el tiempo gana quien ofreció más. Todo se ve en el momento, sin recargar la página.

Esta rama se llama `docs/fase10-documentacion` y junta lo que se hizo en todas las versiones anteriores del proyecto.

## Cómo prenderlo (un solo paso)

No hay que instalar nada a mano. Con este comando se prende todo junto:

```bash
docker compose up --build
```

Hay que pararse primero en la carpeta `lab1/` y ejecutarlo ahí. Eso arma y prende 4 piezas: la página, 3 copias del servidor y la memoria compartida.

Después se abre el navegador en:

| Dirección | Qué vas a ver |
| --- | --- |
| <http://localhost/> | La página de subastas para crear, ver y pujar |
| <http://localhost/api/health> | Una respuesta técnica que dice `ok` y qué copia del servidor contestó |
| <http://localhost:8080> | El tablero del distribuidor de visitas (Traefik) |

Para apagar todo: `Ctrl + C` y luego `docker compose down`.

## Cómo funciona, con un ejemplo

Imaginá que Ana publica "Bicicleta usada, arranca en $10.000, dura 60 segundos":

1. Ana completa el formulario (nombre, precio inicial, duración) y la subasta aparece en la lista.
2. Bruno entra al detalle y ofrece $11.000 con su nombre. La pantalla de Ana se actualiza sola, sin recargar.
3. Carla ofrece $11.000 justo al mismo tiempo que otro. El sistema acepta solo una y a la otra le avisa "te superaron".
4. Se acaba el tiempo. El sistema marca la subasta como cerrada y muestra quién ganó y con cuánto.

Nada de esto pide contraseña: solo se escribe un nombre, como en una lista de presentes.

## Las piezas, en palabras simples

```
Tu navegador
   |
   v
Portero (Traefik) — recibe todas las visitas en el puerto 80
   |-- si pedís la página (/) → te lleva a la Web
   `-- si pedís datos (/api) → te reparte entre Servidor 1, 2 o 3
                                    |
                                    v
                              Memoria compartida (Redis)
                              Guarda precios, listas e historial
```

- **La página (Web):** lo que ve el usuario. Está hecha con React y la sirve un programa simple (nginx).
- **Los servidores (API 1, 2 y 3):** son 3 copias iguales del mismo cerebro, hecho con NestJS. Si una se apaga, las otras siguen atendiendo y nadie lo nota. Eso se llama tolerancia a fallos.
- **El portero (Traefik):** es quien recibe todo y reparte. Si pedís la página te manda a la Web, si pedís datos te manda a uno de los 3 servidores. Para que el vivo no se corte, recuerda con una galletita (`api_sticky`) a qué servidor estás mirando.
- **La memoria compartida (Redis):** es donde se guarda lo importante: cuánto va cada subasta, quién ofreció y cuánto falta para el cierre. La página nunca la toca directo, solo los servidores. Así las 3 copias siempre ven lo mismo.

## Qué ya anda y qué falta

**Ya funciona (Fases 0 a 7):**

- La página, los 3 servidores, el portero y la memoria prenden con un comando.
- Se pueden crear subastas, ver la lista, entrar al detalle, pujar con nombre y ver todo en vivo.
- Si dos pujan igual al mismo instante, solo gana uno (antes ganaban los dos por error, eso se dejó a propósito para mostrar la diferencia).
- Cuando se acaba el tiempo, se cierra sola y dice el ganador.
- Si se apaga un servidor a propósito (`docker stop`), la página sigue andando.
- Hay robots que revisan el código solos cada vez que se sube algo: uno corre las pruebas y arma las cajas para publicar (CI), otro busca errores de seguridad (SAST con Semgrep).

**Todavía falta:**

- **Fase 8 — Subirlo a internet:** hoy anda solo en la compu local. Falta prenderlo en un servicio de nube (Railway, Render o similar) usando las cajas ya publicadas en Docker Hub. Con una sola copia alcanza.
- **Fase 9 — Más pruebas formales:** hay una prueba de pujas simultáneas, pero faltan las pruebas prolijas de crear, listar, pujar y cierre automático.
- **Fase 10 — Este documento:** se congela el domingo antes de la entrega del lunes 14/9.

## Las decisiones importantes, explicadas

- **¿Por qué 3 servidores?** Para demostrar que si uno se cae, el sistema sigue. En la nube pedida alcanza con uno.
- **¿Por qué una memoria compartida?** Porque si cada servidor guardara lo suyo, verían precios distintos. Con una sola memoria todos ven lo mismo.
- **¿Cómo se evita que dos ganen a la vez?** Con una operación que compara y guarda en un solo paso indivisible (un script en Lua). Es como revisar y anotar sin soltar el lápiz.
- **¿Cómo se entera la página al instante?** Por un canal abierto (WebSocket). Cuando hay nueva oferta o cierre, el servidor avisa y la pantalla se actualiza sola.
- **¿Cómo se cierra sola?** Cada subasta tiene un temporizador en la memoria. Cuando suena, un oyente marca la ganadora.
- **Un problema que tuvimos:** el chequeo de salud usaba la palabra `localhost` y fallaba porque adentro del contenedor eso apuntaba a un lugar equivocado (IPv6). Con `127.0.0.1` se arregló.
- **Otra:** al listar se evitó usar un comando peligroso (`KEYS`) y se usa una lista índice de IDs.

## Los robots que revisan todo (para curiosos)

Cada vez que se sube código a `main`, `fases6y7`, `feature/integracion` o esta rama:

1. Se corren las pruebas solas.
2. Se busca si hay fallas de seguridad.
3. Si todo pasa, se arman las cajas (imágenes) y se suben a Docker Hub como `subastas-api` y `subastas-web`.

Para que eso ande hay que guardar dos claves en GitHub: `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN`.

## Las 3 demostraciones del coloquio

1. **Choque de ofertas:** se puja lo mismo al mismo tiempo en la versión con error (ganan los dos) y en la arreglada (uno gana, el otro ve "te superaron").
2. **Se cae un servidor y no pasa nada:** se recarga la salud y se ven nombres de servidor distintos; se apaga uno y todo sigue.
3. **Se mira adentro de la memoria:** con `redis-cli` se muestra el precio actual, la lista de ofertas y cómo baja el temporizador hasta el cierre.

## Dónde está cada cosa (técnico, resumido)

- `AGENTS.md` — reglas y contrato del trabajo.
- `PLAN.md` — lista de fases con tildes.
- `COLOQUIO.md` — guía para defender.
- `docker-compose.yml` — cómo prenden las 4 piezas.
- `api/src/subastas/` — crear, pujar, cerrar.
- `api/src/realtime/` — avisos en vivo.
- `web/src/components/` — pantallas y formularios.
- `.github/workflows/` — los robots CI y SAST.

## Diccionario de palabras (glosario)

| Palabra | Qué es, en simple |
|---|---|
| **API** | El cerebro que atiende pedidos de datos. La página le pregunta y él responde. No se ve. |
| **Web / nginx** | La página que sí se ve. Nginx es solo el mozo que la sirve rápido. |
| **React** | La herramienta con la que está hecha la página. |
| **NestJS** | La herramienta con la que está hecho el cerebro. Ordena el código en cajitas. |
| **Traefik (el portero)** | Recibe todas las visitas y las reparte: página por un lado, datos por otro. |
| **Redis (memoria compartida)** | Cuaderno único donde se anota precio, ofertas y temporizador. Lo leen los 3 servidores. |
| **Réplica** | Copia igual de un servidor. Hay 3 para que si una se cae, sigan las otras. |
| **Tolerancia a fallos** | Que todo siga andando aunque se apague una parte. |
| **Balanceo** | Repartir las visitas entre las 3 copias para que ninguna se sature. |
| **Socket / WebSocket (canal en vivo)** | Cable siempre abierto entre página y servidor para avisar al instante, sin recargar. |
| **Sticky cookie (galletita)** | Marca que deja el portero para mandarte siempre al mismo servidor mientras mirás el vivo. |
| **Healthcheck (chequeo de salud)** | Pregunta automática "¿estás vivo?" que se hace cada 10 segundos a cada pieza. |
| **Hostname** | Nombre de la copia que contestó. Sirve para mostrar que se reparten las visitas. |
| **Docker (caja/contenedor)** | Caja que lleva todo lo necesario para que algo ande igual en cualquier compu. |
| **Imagen** | El molde de la caja. La imagen se guarda, la caja se prende. |
| **Docker Hub (registry)** | Galpón en internet donde se guardan las cajas para bajarlas después. |
| **docker compose** | El que prende todas las cajas juntas con un solo comando. |
| **CI (integración continua)** | Robot que cada vez que subís código corre las pruebas solo. |
| **SAST / Semgrep** | Robot revisor de seguridad que busca errores comunes en el código. |
| **Badge (insignia)** | El cartelito verde/rojo de arriba que dice si los robots pasaron. |
| **Puja** | Oferta de plata por algo. |
| **TTL (temporizador)** | Cuenta regresiva de cada subasta. Cuando llega a cero, se cierra sola. |
| **Keyspace event** | El "timbre" que suena cuando vence el temporizador. |
| **Lua** | Idiomita para hacer la comparación y el guardado en un solo paso, sin que nadie se meta en el medio. |
| **WATCH / MULTI / EXEC** | Otra forma de lograr lo mismo que Lua, pero en varios pasos. Se eligió Lua por simple. |
| **`KEYS` vs índice** | `KEYS` es revolver todo el cuaderno para buscar, peligroso. El índice es una listita de IDs, prolijo. |
| **localhost / 127.0.0.1** | Dos formas de decir "esta misma compu". Una fallaba adentro de la caja (IPv6), la otra no. |
| **IPv4 / IPv6** | Dos versiones de direcciones. La caja solo escuchaba en la vieja (IPv4). |
| **e2e (punta a punta)** | Prueba que recorre todo como un usuario real, de la página a la memoria. |
| **Supertest / Vitest** | Herramientas para hacer pruebas automáticas. |
| **Railway / Render / Cloud Run** | Servicios de nube para prender el proyecto en internet. Fase 8 pendiente. |
