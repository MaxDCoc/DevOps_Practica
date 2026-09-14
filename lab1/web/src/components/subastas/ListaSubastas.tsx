import type { Subasta } from '../../types/subasta'

interface ListaSubastasProps {
  subastas: Subasta[]
  subastaSeleccionadaId: string | null
  onSeleccionar: (id: string) => void
  onCrearClick: () => void
  cargando: boolean
}

export function ListaSubastas({
  subastas,
  subastaSeleccionadaId,
  onSeleccionar,
  onCrearClick,
  cargando,
}: ListaSubastasProps) {
  return (
    <div className="subastas-container">
      <div className="subastas-header-actions">
        <div>
          <h2>Subastas disponibles</h2>
          <span className="subtitle">
            Hacé clic en un ítem para ver el detalle y pujar en tiempo real.
          </span>
        </div>
        <button
          type="button"
          className="user-btn-primary"
          onClick={onCrearClick}
        >
          + Publicar subasta
        </button>
      </div>

      {cargando && <div className="subastas-loading">Cargando subastas…</div>}

      {!cargando && subastas.length === 0 && (
        <div className="subastas-empty">
          <p>No hay ninguna subasta activa por el momento.</p>
          <button
            type="button"
            className="user-btn-primary"
            onClick={onCrearClick}
          >
            Publicar la primera subasta
          </button>
        </div>
      )}

      {!cargando && subastas.length > 0 && (
        <div className="subastas-grid">
          {subastas.map((s) => {
            const isSelected = s.id === subastaSeleccionadaId
            return (
              <div
                key={s.id}
                className={`subasta-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSeleccionar(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSeleccionar(s.id)
                }}
              >
                <div>
                  <div className="subasta-card-header">
                    <h3 className="subasta-card-title">{s.nombre}</h3>
                    {s.cerrada ? (
                      <span className="badge badge-cerrada">Cerrada</span>
                    ) : (
                      <span className="badge badge-live">
                        <span className="pulse-dot" /> En vivo
                      </span>
                    )}
                  </div>

                  <div className="subasta-card-price">
                    ${s.montoActual ?? s.montoInicial}
                  </div>
                </div>

                <div className="subasta-card-meta">
                  <span>Monto base: ${s.montoInicial}</span>
                  {s.cerrada ? (
                    <span className="ganador">Ganador: {s.ganador || 'Sin pujas'}</span>
                  ) : (
                    <span>Duración: {s.duracionSegundos}s</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
