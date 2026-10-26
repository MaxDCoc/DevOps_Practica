// Los textos de cada paso. Los usan el modo real y el simulado, así los dos cuentan lo mismo.
// Regla: el título dice QUÉ pasa en una línea; "explain" lo cuenta simple; "why" dice por qué importa.
import type { FlowEventInput, JobState, PipelineRequest } from './types'

type JobRef = Pick<JobState, 'job_id' | 'trace_id' | 'project'>

export function traceparent(traceId: string | null | undefined, spanId = '<span del publish>') {
  return `00-${traceId ?? '<trace_id>'}-${spanId}-01`
}

export function jobMessage(jobId: string, req: PipelineRequest, submittedAt: string) {
  return { job_id: jobId, project: req.project, branch: req.branch, config: req.config, submitted_at: submittedAt }
}

const secs = (s: number | null | undefined) => (s == null ? '' : `${s.toFixed(1).replace('.', ',')} s`)
const ref = (j: JobRef) => ({ jobId: j.job_id, traceId: j.trace_id, project: j.project })

export const say = {
  httpRequest(req: PipelineRequest): FlowEventInput {
    return {
      kind: 'http-req',
      phase: 'pedido',
      topic: 'http',
      from: 'browser',
      to: 'api',
      short: 'POST /pipelines',
      project: req.project,
      title: 'El navegador le pide a la API que ejecute el pipeline',
      explain: `Manda un pedido HTTP con el proyecto «${req.project}» y sus etapas (${req.config.stages.join(', ')}). A partir de ahora el navegador queda esperando una respuesta.`,
      payloads: [{ label: 'Cuerpo del pedido', data: req }],
    }
  },

  validateCall(req: PipelineRequest): FlowEventInput {
    return {
      kind: 'http-req',
      phase: 'pedido',
      topic: 'observabilidad',
      from: 'api',
      to: 'validator',
      short: '¿es válido?',
      project: req.project,
      title: 'La API le pregunta al validador si el pedido es correcto',
      explain: 'Es otra llamada HTTP, ahora de un servicio a otro. La API no sigue hasta tener la respuesta.',
      why: 'A esta llamada se le agrega la cabecera traceparent. Gracias a eso, lo que hace el validador queda registrado en la misma traza que el pedido original.',
      payloads: [
        { label: 'Cabecera que agrega OpenTelemetry', data: { traceparent: '00-<trace_id>-<span de la API>-01' } },
        { label: 'Cuerpo', data: req },
      ],
    }
  },

  validateResult(valid: boolean, errors: string[], project?: string): FlowEventInput {
    return {
      kind: 'http-res',
      phase: 'pedido',
      topic: 'http',
      from: 'validator',
      to: 'api',
      short: valid ? 'válido' : 'inválido',
      tone: valid ? 'ok' : 'error',
      project,
      title: valid ? 'El validador responde: el pedido es válido' : 'El validador responde: el pedido NO es válido',
      explain: valid
        ? 'Revisó el nombre del proyecto, el orden de las etapas y los segundos por etapa. Está todo bien.'
        : `Encontró ${errors.length === 1 ? 'un problema' : `${errors.length} problemas`}: ${errors.join('; ')}.`,
      payloads: [{ label: 'Respuesta del validador', data: { valid, errors } }],
    }
  },

  redisCreate(jobId: string, req: PipelineRequest, traceId: string | null, submittedAt: string): FlowEventInput {
    return {
      kind: 'redis',
      phase: 'pedido',
      topic: 'estado',
      from: 'api',
      to: 'redis',
      short: 'estado: en cola',
      jobId,
      traceId,
      project: req.project,
      title: 'La API anota el pipeline en Redis como «en cola»',
      explain: 'Redis guarda el estado de cada pipeline. Cualquiera puede consultarlo después con GET /pipelines/{id}.',
      why: 'Se anota antes de publicar el mensaje: un worker podría tomarlo enseguida, y el estado ya tiene que existir.',
      payloads: [
        {
          label: `Redis: SET job:${jobId}`,
          data: {
            job_id: jobId,
            project: req.project,
            status: 'queued',
            stages: req.config.stages.map((name) => ({ name, status: 'pending' })),
            trace_id: traceId,
            submitted_at: submittedAt,
          },
        },
      ],
    }
  },

  publish(jobId: string, req: PipelineRequest, traceId: string | null, submittedAt: string, external = false): FlowEventInput {
    return {
      kind: 'publish',
      phase: 'pedido',
      topic: 'mensajeria',
      from: 'api',
      to: 'rabbit',
      short: 'mensaje',
      jobId,
      traceId,
      project: req.project,
      title: external ? `Llega a la cola un pipeline enviado desde otro lado (${req.project})` : 'La API deja el trabajo en la cola de RabbitMQ',
      explain:
        'Publica un mensaje con los datos del pipeline. RabbitMQ lo guarda en la cola «pipeline.jobs» hasta que algún worker lo tome. El mensaje es persistente: no se pierde aunque RabbitMQ se reinicie.',
      why: 'En los headers del mensaje viaja el traceparent. Es lo que va a permitir que el trabajo del worker aparezca en la misma traza, del otro lado de la cola.',
      payloads: [
        { label: 'Dónde se publica', data: { exchange: 'pipelines', routing_key: 'pipeline.run', cola_destino: 'pipeline.jobs', persistente: true, message_id: jobId } },
        { label: 'Headers del mensaje', data: { traceparent: traceparent(traceId), 'x-attempt': 1 } },
        { label: 'Contenido del mensaje', data: jobMessage(jobId, req, submittedAt) },
      ],
    }
  },

  accepted(jobId: string, traceId: string | null, ms: number, project: string): FlowEventInput {
    return {
      kind: 'http-res',
      phase: 'pedido',
      topic: 'mensajeria',
      from: 'api',
      to: 'browser',
      short: '202 Accepted',
      tone: 'ok',
      jobId,
      traceId,
      project,
      meta: { ms },
      title: 'La API responde 202 sin esperar a que el pipeline termine',
      explain: `La respuesta llegó en ${Math.round(ms)} ms. El navegador recibe un job_id para consultar el avance, pero ninguna etapa se ejecutó todavía.`,
      why: 'Esto es desacoplar: la parte lenta (build, test, deploy) queda fuera del pedido HTTP. El cliente no espera y la API queda libre para el siguiente pedido.',
      payloads: [{ label: 'Respuesta 202', data: { job_id: jobId, status: 'queued', trace_id: traceId } }],
    }
  },

  rejected(errors: string[], ms: number, project: string): FlowEventInput {
    return {
      kind: 'http-res',
      phase: 'pedido',
      topic: 'http',
      from: 'api',
      to: 'browser',
      short: '422',
      tone: 'error',
      final: true,
      project,
      meta: { ms },
      title: 'La API responde 422: pedido rechazado',
      explain: `Tardó ${Math.round(ms)} ms. No se guardó nada en Redis ni se publicó ningún mensaje: el pedido se cortó acá.`,
      why: 'Validar antes de encolar evita que un worker pierda tiempo con un pedido que nunca podría funcionar.',
      payloads: [{ label: 'Respuesta 422', data: { detail: { errors } } }],
    }
  },

  unavailable(status: number, detail: string, ms: number, project: string): FlowEventInput {
    return {
      kind: 'http-res',
      phase: 'pedido',
      topic: 'http',
      from: 'api',
      to: 'browser',
      short: String(status || 'error'),
      tone: 'error',
      final: true,
      project,
      meta: { ms },
      title: `La API no pudo procesar el pedido (${status || 'sin conexión'})`,
      explain: `${detail}. Falló una dependencia (el validador o la cola).`,
      payloads: [{ label: 'Respuesta', data: { status, detail } }],
    }
  },

  deliver(job: JobRef, slot: number, attempt: number, redelivered: boolean): FlowEventInput {
    return {
      kind: 'deliver',
      phase: 'cola',
      topic: 'mensajeria',
      from: 'rabbit',
      to: `worker-${slot}`,
      short: redelivered ? 'mensaje (otra vez)' : 'mensaje',
      ...ref(job),
      meta: { slot, attempt, redelivered },
      title: redelivered ? `RabbitMQ le da el mismo mensaje al worker ${slot + 1} (intento ${attempt})` : `RabbitMQ le entrega el mensaje al worker ${slot + 1}`,
      explain: redelivered
        ? 'Como el mensaje nunca se confirmó, volvió a la cola y ahora lo toma otro worker. El pipeline arranca de nuevo desde la primera etapa.'
        : 'El worker estaba esperando trabajo. Toma un solo mensaje a la vez (prefetch = 1) y no recibe otro hasta terminar este.',
      why: redelivered
        ? 'No se perdió ningún trabajo aunque un worker se haya caído.'
        : 'El worker lee el traceparent del mensaje y continúa la misma traza que empezó la API.',
      payloads: [
        { label: 'Entrega', data: { cola: 'pipeline.jobs', worker: slot + 1, redelivered, intento: attempt } },
        { label: 'Headers recibidos', data: { traceparent: traceparent(job.trace_id), 'x-attempt': attempt } },
      ],
    }
  },

  stageEnd(job: JobRef, slot: number, stage: string, ok: boolean, seconds: number | null): FlowEventInput {
    return {
      kind: 'stage-end',
      phase: 'worker',
      topic: ok ? 'estado' : 'observabilidad',
      from: `worker-${slot}`,
      to: 'redis',
      short: ok ? `${stage}: ok` : `${stage}: falló`,
      tone: ok ? 'ok' : 'error',
      ...ref(job),
      meta: { slot, stage, ok },
      title: ok ? `El worker termina la etapa «${stage}»` : `La etapa «${stage}» falla`,
      explain: ok
        ? `La etapa tardó ${secs(seconds)}. El worker actualiza el estado en Redis para que se pueda ver el avance.`
        : `Falló después de ${secs(seconds)}. El pipeline queda marcado como fallido en Redis y las etapas siguientes no se ejecutan. El worker escribe un log de error con el mismo trace_id.`,
      why: ok ? undefined : 'En la traza, esta etapa aparece en rojo. Con su trace_id se encuentra el log exacto del error.',
      payloads: ok
        ? [{ label: `Redis: job:${job.job_id}`, data: { [stage]: 'succeeded', duration_s: seconds } }]
        : [
            { label: `Redis: job:${job.job_id}`, data: { status: 'failed', [stage]: 'failed', error: `falló la etapa ${stage} (simulado)` } },
            { label: 'Log del worker (una línea JSON)', data: { level: 'error', service: 'worker', msg: `falló la etapa ${stage}`, job_id: job.job_id, stage, trace_id: job.trace_id } },
          ],
    }
  },

  ack(job: JobRef, slot: number, ok: boolean): FlowEventInput {
    return {
      kind: 'ack',
      phase: 'cola',
      topic: 'mensajeria',
      from: `worker-${slot}`,
      to: 'rabbit',
      short: 'ack',
      tone: ok ? 'ok' : 'warn',
      ...ref(job),
      meta: { slot, ok },
      title: ok ? 'El worker confirma el mensaje (ack)' : 'El worker confirma el mensaje aunque el pipeline falló',
      explain: ok
        ? 'Recién ahora RabbitMQ borra el mensaje de la cola. El worker queda libre para el siguiente.'
        : 'Un test que falla no se arregla reintentando, así que el mensaje se da por procesado y se borra de la cola.',
      why: ok
        ? 'Se confirma al final a propósito: si el worker se cayera a mitad de camino, el mensaje seguiría en la cola y otro worker lo terminaría.'
        : 'Los reintentos son solo para errores inesperados (por ejemplo, que Redis no responda). Después de 3 intentos, el mensaje va a una cola aparte de mensajes fallidos.',
    }
  },

  redeliver(job: JobRef, slot: number): FlowEventInput {
    return {
      kind: 'redeliver',
      phase: 'cola',
      topic: 'mensajeria',
      from: `worker-${slot}`,
      to: 'rabbit',
      short: 'se cayó',
      tone: 'warn',
      ...ref(job),
      meta: { slot },
      title: `El worker ${slot + 1} se cae en medio del trabajo`,
      explain: 'No llegó a confirmar el mensaje. RabbitMQ detecta que se cortó la conexión y vuelve a poner el mensaje en la cola.',
      why: 'Por eso el ack va al final: un mensaje sin confirmar nunca se pierde.',
    }
  },

  traceDone(job: JobRef, slot: number): FlowEventInput {
    return {
      kind: 'span',
      phase: 'traza',
      topic: 'observabilidad',
      from: `worker-${slot}`,
      to: 'jaeger',
      short: 'spans',
      final: true,
      ...ref(job),
      title: 'La traza queda completa en Jaeger',
      explain:
        'La API, el validador y el worker fueron mandando por separado un registro de cada cosa que hicieron (un «span»). Jaeger los une en una sola traza porque todos llevan el mismo trace_id.',
      why: 'En la pestaña Traza se ve el pedido entero: cuánto tardó cada parte y cuánto esperó el mensaje en la cola.',
    }
  },

  info(title: string, explain: string): FlowEventInput {
    return { kind: 'info', title, explain, topic: 'mensajeria' }
  },
}
