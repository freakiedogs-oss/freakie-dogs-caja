/* ═══════════════════════════════════════════════════════════════════════
   Resultados delivery (7-nov-2026, pedido de Cesar)

   Cada encargado ve, día por día, cómo calificaron los clientes los pedidos
   de SU sucursal: nota, motivo, comentario, quién lo llevó y cuánto se tardó
   en cada etapa (confirmar, cocina, esperando motorista, ruta). Los 😞 y los
   que pidieron contacto quedan como pendientes hasta que el encargado marca
   que ya llamó al cliente.
   Ejecutivo / admin / superadmin eligen sucursal (o todas).
   Datos: fn_resultados_delivery(store, desde, hasta). La encuesta la llena
   el cliente en su link de seguimiento (tracking_calificar).
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react'
import { db } from '../../supabase'

const SUPERVISAN = ['ejecutivo', 'admin', 'superadmin']
const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', okTxt: '#86efac', warn: '#fbbf24', bad: '#f87171', badBg: '#2e1311', acc: '#60a5fa',
}
const CARA = { 3: '😀', 2: '😐', 1: '😞' }
const ETAPAS = [
  { k: 'min_confirmar', t: 'Confirmar', col: '#64748b' },
  { k: 'min_cocina', t: 'Cocina', col: '#f59e0b' },
  { k: 'min_asignar', t: 'Asignar', col: '#a78bfa' },
  { k: 'min_retirar', t: 'Esperando motorista', col: '#f97316' },
  { k: 'min_ruta', t: 'En ruta', col: '#60a5fa' },
]
const hoySV = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)
const menosDias = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() - n * 864e5).toISOString().slice(0, 10)
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaLarga = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}` }
const waHref = (tel) => { const d = String(tel || '').replace(/\D/g, ''); return d.length >= 8 ? `https://wa.me/${d.length === 8 ? '503' + d : d}` : null }
const money = (n) => '$' + Number(n || 0).toFixed(2)

export default function ResultadosDeliveryView({ user }) {
  const supervisa = SUPERVISAN.includes(user?.rol)
  const propia = user?.store_code && user.store_code !== 'CM001' ? user.store_code : ''
  const [store, setStore] = useState(supervisa ? '' : propia)
  const [sucursales, setSucursales] = useState([])
  const [rango, setRango] = useState(7)
  const [filtro, setFiltro] = useState('todas')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(null)

  useEffect(() => {
    db.from('sucursales').select('store_code, nombre').eq('tiene_delivery', true).eq('activa', true).order('nombre')
      .then(({ data: s }) => setSucursales(s || []))
  }, [])

  const puedeElegir = supervisa || !propia
  const cargar = useCallback(async () => {
    if (!supervisa && !store) { setData(null); return }
    const hasta = hoySV()
    const { data: r, error: e } = await db.rpc('fn_resultados_delivery', {
      p_store: store || null, p_desde: menosDias(hasta, rango - 1), p_hasta: hasta,
    })
    if (e) { setError(e.message); return }
    setError(''); setData(r)
  }, [store, rango, supervisa])

  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t) }, [cargar])

  const contactado = async (c) => {
    const nota = window.prompt(`¿Qué hablaste con ${c.cliente || 'el cliente'}? (queda registrado)`, '')
    if (nota === null) return
    setOcupado(c.id)
    const { error: e } = await db.rpc('fn_resultados_delivery_contactado', { p_id: c.id, p_usuario_id: user?.id, p_nota: nota })
    setOcupado(null)
    if (e) { alert(e.message); return }
    cargar()
  }

  const r = data?.resumen || {}
  const cals = (data?.calificaciones || []).filter(c =>
    filtro === 'todas' ? true
      : filtro === 'malas' ? c.nota < 3
      : (c.nota === 1 || c.quiere_contacto) && !c.contactado_at)
  const porDia = (data?.dias || []).map(d => ({ ...d, items: cals.filter(c => c.dia === d.dia) }))
  const pctBuenas = r.calificados ? Math.round(r.buenas / r.calificados * 100) : null

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto', color: C.txt }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>🛵 Resultados delivery</div>
          <div style={{ fontSize: 12.5, color: C.dim }}>Cómo calificaron los clientes y cuánto se tardó cada pedido</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {puedeElegir && (
            <select value={store} onChange={e => setStore(e.target.value)} style={S.sel}>
              {supervisa ? <option value=''>Todas las sucursales</option> : <option value=''>Elegí sucursal</option>}
              {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
            </select>
          )}
          {[1, 7, 30].map(n => (
            <button key={n} onClick={() => setRango(n)} style={S.tab(rango === n)}>{n === 1 ? 'Hoy' : `${n} días`}</button>
          ))}
        </div>
      </div>

      {error && <div style={{ ...S.card, color: C.bad }}>⚠️ {error}</div>}
      {!data && !error && <div style={S.card}>{!supervisa && !store ? 'Elegí tu sucursal.' : 'Cargando…'}</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
            <Kpi n={pctBuenas == null ? '—' : `${pctBuenas}%`} t="😀 excelente" col={C.okTxt} />
            <Kpi n={r.malas ?? 0} t="😞 malas" col={r.malas ? C.bad : C.txt} />
            <Kpi n={r.pendientes_contacto ?? 0} t="por contactar" col={r.pendientes_contacto ? C.warn : C.txt} />
            <Kpi n={`${r.calificados ?? 0}/${r.entregados ?? 0}`} t="calificaron / entregados" />
            <Kpi n={r.min_total_mediana != null ? `${Math.round(r.min_total_mediana)} min` : '—'} t="tiempo típico de entrega" />
            <Kpi n={r.pct_mas_60 != null ? `${r.pct_mas_60}%` : '—'} t="tardaron más de 60 min" col={r.pct_mas_60 >= 30 ? C.bad : C.txt} />
          </div>

          {(data.motivos || []).length > 0 && (
            <div style={{ ...S.card, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.dim, marginRight: 4 }}>Lo que más mencionan:</span>
              {data.motivos.map(m => <span key={m.motivo} style={S.chip}>{m.motivo} · {m.n}</span>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, margin: '4px 0 12px' }}>
            {[['todas', 'Todas'], ['malas', 'Solo 😐 y 😞'], ['pend', 'Por contactar']].map(([k, t]) => (
              <button key={k} onClick={() => setFiltro(k)} style={S.tab(filtro === k)}>{t}</button>
            ))}
          </div>

          {porDia.map(d => (
            <div key={d.dia} style={{ marginBottom: 14 }}>
              <div style={S.dia}>
                <b style={{ textTransform: 'capitalize' }}>{fechaLarga(d.dia)}</b>
                <span style={{ color: C.dim }}>
                  {d.entregados} entregados · {d.calificados} calificaron
                  {d.calificados > 0 && ` · 😀 ${d.buenas} 😐 ${d.regulares} 😞 ${d.malas}`}
                  {d.min_total_mediana != null && ` · típico ${Math.round(d.min_total_mediana)} min`}
                </span>
              </div>
              {d.items.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: '6px 4px' }}>Sin calificaciones{filtro !== 'todas' ? ' con este filtro' : ''}.</div>}
              {d.items.map(c => <Tarjeta key={c.id} c={c} supervisa={supervisa && !store} ocupado={ocupado === c.id} onContactado={() => contactado(c)} />)}
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: C.dim, textAlign: 'center', marginTop: 8 }}>
            El cliente califica desde su link de seguimiento cuando recibe el pedido. Se actualiza cada minuto.
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ n, t, col }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: col || C.txt }}>{n}</div>
      <div style={{ fontSize: 11.5, color: C.dim }}>{t}</div>
    </div>
  )
}

function Tarjeta({ c, supervisa, ocupado, onContactado }) {
  const total = ETAPAS.reduce((s, e) => s + Math.max(0, Number(c[e.k]) || 0), 0) || 1
  const pend = (c.nota === 1 || c.quiere_contacto) && !c.contactado_at
  const wa = waHref(c.telefono)
  return (
    <div style={{ ...S.card, borderColor: c.nota === 1 ? '#7a2a30' : C.line, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 32, lineHeight: 1 }}>{CARA[c.nota]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <b>{c.numero_orden} <span style={{ color: C.dim, fontWeight: 400 }}>· {c.hora}{supervisa ? ` · ${c.sucursal}` : ''}</span></b>
            <span style={{ fontWeight: 800, color: c.min_total > 60 ? C.bad : c.min_total > 45 ? C.warn : C.okTxt }}>{c.min_total} min</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 2 }}>
            🛵 {c.motorista || 'sin motorista'}{c.pedidos_en_viaje > 1 ? ` · entrega ${c.orden_entrega ?? '?'} de ${c.pedidos_en_viaje} del viaje` : ''} · {money(c.total)} {c.metodo_pago || ''}
          </div>
          {(c.motivos || []).length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {c.motivos.map(m => <span key={m} style={S.chip}>{m}</span>)}
            </div>
          )}
          {c.comentario && <div style={{ marginTop: 6, fontSize: 13.5, fontStyle: 'italic' }}>«{c.comentario}»</div>}

          {/* Tiempos por etapa */}
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 10, background: C.line }}>
            {ETAPAS.map(e => (Number(c[e.k]) > 0) && (
              <div key={e.k} title={`${e.t}: ${c[e.k]} min`} style={{ width: `${Math.max(0, c[e.k]) / total * 100}%`, background: e.col }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: C.dim, marginTop: 5 }}>
            {ETAPAS.map(e => (
              <span key={e.k}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: e.col, marginRight: 4 }} />
                {e.t}: <b style={{ color: C.txt }}>{c[e.k] ?? '—'}</b>{c[e.k] != null ? ' min' : ''}</span>
            ))}
          </div>

          {(c.nota === 1 || c.quiere_contacto) && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: pend ? C.badBg : '#0e2a17', fontSize: 12.5 }}>
              {pend ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{c.quiere_contacto ? '📞 Pidió que lo contacten' : '📞 Llamar al cliente'}: <b>{c.cliente || 'Cliente'}</b></span>
                  {wa && <a href={wa} target="_blank" rel="noopener" style={S.btnWa}>WhatsApp</a>}
                  {c.telefono && <a href={`tel:${c.telefono}`} style={S.btnSec}>Llamar</a>}
                  <button disabled={ocupado} onClick={onContactado} style={S.btnOk}>{ocupado ? '…' : '✅ Ya lo contacté'}</button>
                </div>
              ) : (
                <span style={{ color: C.okTxt }}>✅ Contactado por {c.contactado_nombre}{c.nota_contacto ? `: «${c.nota_contacto}»` : ''}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  card: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 12 },
  sel: { background: C.card, color: C.txt, border: `1px solid ${C.line}`, borderRadius: 9, padding: '7px 10px', fontSize: 13 },
  tab: (on) => ({ background: on ? C.acc : C.card, color: on ? '#0b1220' : C.txt, border: `1px solid ${on ? C.acc : C.line}`,
                  borderRadius: 9, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }),
  chip: { background: '#26262b', border: `1px solid ${C.line}`, borderRadius: 12, padding: '2px 9px', fontSize: 12 },
  dia: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '6px 4px',
         borderBottom: `1px solid ${C.line}`, marginBottom: 8, fontSize: 13 },
  btnWa: { background: '#25D366', color: '#04220f', borderRadius: 7, padding: '4px 9px', fontWeight: 700, textDecoration: 'none', fontSize: 12 },
  btnSec: { background: '#333', color: '#fff', borderRadius: 7, padding: '4px 9px', fontWeight: 700, textDecoration: 'none', fontSize: 12 },
  btnOk: { background: C.ok, color: '#04220f', border: 0, borderRadius: 7, padding: '5px 10px', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
}
