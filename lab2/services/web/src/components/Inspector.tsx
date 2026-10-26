import type { FlowEvent } from '../types'
import { nodeName } from '../util'

function Json({ data }: { data: unknown }) {
  const text = JSON.stringify(data, null, 2) ?? String(data)
  // resaltado mínimo: claves, strings, números y null
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`
      if (lit) return `<span class="j-lit">${lit}</span>`
      if (num) return `<span class="j-num">${num}</span>`
      return m
    })
  return <pre className="json" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Desarma un traceparent W3C en sus 4 partes. */
export function Traceparent({ value }: { value: string }) {
  const [v, trace, span, flags] = value.split('-')
  return (
    <div className="traceparent">
      <p className="small muted">El traceparent tiene cuatro partes:</p>
      <code>
        <span className="tp-v">{v}</span>-<span className="tp-trace">{trace}</span>-<span className="tp-span">{span}</span>-<span className="tp-flags">{flags}</span>
      </code>
      <dl className="tp-legend">
        <dt className="tp-v">{v}</dt>
        <dd>versión del formato</dd>
        <dt className="tp-trace">trace_id</dt>
        <dd>identifica todo el pedido; es el mismo en todos los servicios</dd>
        <dt className="tp-span">span</dt>
        <dd>quién mandó esto (el «padre» del próximo paso)</dd>
        <dt className="tp-flags">{flags}</dt>
        <dd>la traza se guarda</dd>
      </dl>
    </div>
  )
}

function findTraceparent(data: unknown): string | null {
  if (data && typeof data === 'object' && 'traceparent' in data) {
    const v = (data as Record<string, unknown>).traceparent
    return typeof v === 'string' ? v : null
  }
  return null
}

export function Inspector({ event }: { event: FlowEvent | null }) {
  if (!event)
    return (
      <div className="empty-state">
        Acá se ve qué viaja exactamente en el paso que se está explicando: el cuerpo HTTP, los headers del mensaje o lo que se escribe en Redis.
      </div>
    )
  return (
    <div className="inspector">
      <p className="muted small">Qué viaja en el paso</p>
      <h3>{event.title}</h3>
      {event.from && event.to && (
        <p className="route">
          De <b>{nodeName(event.from)}</b> a <b>{nodeName(event.to)}</b>
          {event.traceId && (
            <>
              {' '}
              · trace_id <code>{event.traceId}</code>
            </>
          )}
        </p>
      )}
      <div className="payloads">
        {(event.payloads ?? []).map((p) => {
          const tp = findTraceparent(p.data)
          return (
            <div key={p.label} className="payload">
              <h4>{p.label}</h4>
              {tp && <Traceparent value={tp} />}
              <Json data={p.data} />
            </div>
          )
        })}
        {!event.payloads?.length && <p className="muted">En este paso no viaja un mensaje propio.</p>}
      </div>
    </div>
  )
}
