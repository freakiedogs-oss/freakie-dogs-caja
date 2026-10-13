/* Desglose de agrandados por tipo (6-oct-2026, pedido de Cesar).
   Cada tipo paga según su precio: papa y bebida $0.10, papa $0.08, bebida $0.04.
   El tocino se muestra en la misma lista para que la cajera compare todo junto.
   Lo usan el chip del POS y la vista de supervisión del ERP. */

const TIPOS = [
  { k: 'pb',   nombre: 'Papa y bebida', icono: '🍟🥤', color: '#22c55e', valor: 'valor_pb',   mes: 'pb_mes',   hoy: 'pb_hoy' },
  { k: 'papa', nombre: 'Solo papa',     icono: '🍟',   color: '#fbbf24', valor: 'valor_papa', mes: 'papa_mes', hoy: 'papa_hoy' },
  { k: 'beb',  nombre: 'Solo bebida',   icono: '🥤',   color: '#60a5fa', valor: 'valor_beb',  mes: 'beb_mes',  hoy: 'beb_hoy' },
]

const usd = (n) => '$' + Number(n || 0).toFixed(2)

export default function AgrandadoDesglose({ f, grande = false }) {
  const filas = TIPOS.map(t => ({
    ...t,
    v: Number(f[t.valor] || 0),
    n: Number(f[t.mes] || 0),
    h: Number(f[t.hoy] || 0),
  }))
  if (Number(f.tocino_valor || 0) > 0) {
    filas.push({ k: 'toc', nombre: 'Tocino extra', icono: '🥓', color: '#fb923c',
                 v: Number(f.tocino_valor), n: Number(f.tocino_mes || 0), h: Number(f.tocino_hoy || 0) })
  }
  const maxDinero = Math.max(...filas.map(x => x.n * x.v), 0.0001)
  const lider = filas.reduce((a, b) => (b.n * b.v > a.n * a.v ? b : a), filas[0])
  const fs = grande ? 1.1 : 1

  return (
    <div style={{ background: '#1a1a1c', borderRadius: 11, padding: 14, marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <b style={{ fontSize: 14 * fs }}>¿Qué estás vendiendo más?</b>
        <span style={{ color: '#8a8a92', fontSize: 11.5 * fs }}>este mes · hoy</span>
      </div>
      {filas.map(x => {
        const dinero = x.n * x.v
        const esLider = lider && x.k === lider.k && dinero > 0
        return (
          <div key={x.k} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 18 * fs, width: 34, textAlign: 'center' }}>{x.icono}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 * fs, fontWeight: 700 }}>
                    {x.nombre}
                    {esLider && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#0b0b0c', background: x.color,
                                               borderRadius: 20, padding: '1px 7px', fontWeight: 800 }}>tu fuerte</span>}
                  </div>
                  <div style={{ color: '#8a8a92', fontSize: 11.5 * fs }}>vale {usd(x.v)} c/u</div>
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 15 * fs, fontWeight: 800, color: x.color }}>{usd(dinero)}</div>
                <div style={{ color: '#8a8a92', fontSize: 11.5 * fs }}>
                  {x.n} · <span style={{ color: x.h > 0 ? '#f0f0f2' : '#8a8a92' }}>+{x.h} hoy</span>
                </div>
              </div>
            </div>
            <div style={{ background: '#0d0d0f', borderRadius: 99, height: 7, overflow: 'hidden', marginTop: 5, marginLeft: 42 }}>
              <div style={{ background: x.color, height: '100%', borderRadius: 99,
                            width: `${(dinero / maxDinero) * 100}%`, transition: 'width .4s' }} />
            </div>
          </div>
        )
      })}
      <div style={{ color: '#8a8a92', fontSize: 11 * fs, marginTop: 4, lineHeight: 1.4 }}>
        Los agrandados se pagan al cerrar cada bloque de {f.bloque_tam} puntos (${(f.bloque_tam * Number(f.valor_unit)).toFixed(0)}).
        {Number(f.tocino_valor || 0) > 0 && ' El tocino se paga por unidad, sin bloques.'}
      </div>
    </div>
  )
}
