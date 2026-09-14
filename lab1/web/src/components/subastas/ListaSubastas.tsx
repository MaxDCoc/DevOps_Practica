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
          <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#0f172a' }}>
            Subastas Disponibles
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Haz clic en un ítem para ver el detalle y pujar en tiempo real.
          </span>
        </div>
        <button
          type="button"
          className="user-btn-primary"
          onClick={onCrearClick}
        >
          + Publicar Subasta
        </button>
      </div>

      {cargando && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          Cargando subastas...
        </div>
      )}

      {!cargando && subastas.length === 0 && (
        <div
          style={{
            background: '#f8fafc',
            border: '2px dashed #cbd5e1',
            borderRadius: '10px',
            padding: '3rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '1.1rem', color: '#475569', margin: '0 0 1rem 0' }}>
            No hay ninguna subasta activa por el momento.
          </p>
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
                      <span className="badge badge-activa">Activa</span>
                    )}
                  </div>

                  <div className="subasta-card-price">
                    ${s.montoActual ?? s.montoInicial}
                  </div>
                </div>

                <div className="subasta-card-meta">
                  <span>Monto base: ${s.montoInicial}</span>
                  {s.cerrada ? (
                    <span style={{ color: '#2563eb', fontWeight: 500 }}>
                      Ganador: {s.ganador || 'Sin pujas'}
                    </span>
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
