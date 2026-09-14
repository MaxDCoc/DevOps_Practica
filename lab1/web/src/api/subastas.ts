import type { CrearSubastaPayload, ResultadoPuja, Subasta, SubastaDetalle } from '../types/subasta'

export async function listarSubastas(): Promise<Subasta[]> {
  const res = await fetch('/api/subastas')
  if (!res.ok) {
    throw new Error(`Error al listar subastas: ${res.statusText}`)
  }
  return res.json()
}

export async function obtenerSubasta(id: string): Promise<SubastaDetalle> {
  const res = await fetch(`/api/subastas/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(`Error al obtener detalle de la subasta: ${res.statusText}`)
  }
  return res.json()
}

export async function crearSubasta(payload: CrearSubastaPayload): Promise<Subasta> {
  const res = await fetch('/api/subastas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => null)
    throw new Error(errorData?.message || `Error al crear subasta: ${res.statusText}`)
  }
  return res.json()
}

export async function realizarPuja(
  id: string,
  monto: number,
  usuario: string,
  ingenua = false,
): Promise<ResultadoPuja> {
  const endpoint = ingenua ? `/api/subastas/${encodeURIComponent(id)}/pujas/ingenua` : `/api/subastas/${encodeURIComponent(id)}/pujas`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto, usuario }),
  })

  const data = await res.json()
  return data as ResultadoPuja
}
