# Dashboard de la demo (P4)

Un front para **explicar** lo que pasa en DeployFlow mientras se presenta. Con el compose arriba:
**http://localhost:3000**.

## Cómo se usa

1. A la izquierda está el **guion de la demo**: los 5 pasos de la Fase 5 y tres extras (pedido
   inválido, un worker que se cae, pedido a medida). Cada paso tiene su botón, qué mirar y una frase
   para decir.
2. Al apretar el botón, el pedido aparece en el diagrama **un paso por vez**: un paquete viaja entre
   dos servicios, el resto queda atenuado, y abajo se explica qué pasa y por qué importa. Debajo del
   diagrama están los paneles de **Jaeger** (las barras de la traza aparecen a medida que cada span
   se exporta), **Prometheus** (scrape cada 5 s, ok/fallidos, cola y duraciones) y **Logs JSON**.
3. **Anterior / Siguiente** (o las flechas del teclado) para moverse; **Pausar** (o la barra
   espaciadora) para frenar la reproducción automática; **Lento / Normal / Rápido** para el ritmo.
   La explicación nunca se acelera sola: si el sistema real todavía no llegó al siguiente paso,
   espera.
4. A la derecha queda la **lista de pasos** del pedido; clic en cualquiera para volver a verlo.
5. Abajo: **Qué viaja** (el contenido exacto del paso: cuerpo HTTP, headers del mensaje con el
   `traceparent` explicado, lo que se escribe en Redis), **Traza** (la cascada leída de Jaeger),
   **Pipelines**, **Métricas** y **Conceptos**.

Los pasos 2 y 5 (muchos pedidos a la vez) usan la vista **Ver todo en vivo**: el estado real de la
cola y de cada worker, sin animaciones, y las últimas respuestas de la API.

## Dos orígenes de datos

- **Stack real** (por defecto si la API responde): habla con la API por `/api` y con Jaeger por
  `/jaeger`. Como la API no avisa cuando cambia un job, el front consulta `GET /pipelines` cada
  ~600 ms y convierte cada cambio (en cola → corriendo → etapa → fin) en un paso. Para escalar o tirar
  un worker, el guion muestra el comando de `docker` para copiar.
- **Simulado** (plan B sin Docker): el mismo flujo y las mismas reglas del validador, dentro del
  navegador. Permite escalar workers con botones y tirar un worker a mitad de un pipeline.

## Desarrollo

```bash
cd lab2/services/web
npm install
npm run dev        # proxy a la API (:8000) y a Jaeger (:16686) del host
npm run build      # chequeo de tipos + build
```

Sin el stack levantado arranca en modo simulado.

En el contenedor, nginx sirve el build y hace de proxy de `/api/` → `API_UPSTREAM` y `/jaeger/` →
`JAEGER_UPSTREAM` (los define el compose), así el navegador no tiene problemas de CORS.
