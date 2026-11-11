/* ═══════════════════════════════════════════════════════════════════════
   Cebolla del día · comanda para Kevin (pedido de Cesar, 20-oct-2026)

   La cebolla blanca se hace todos los días de 7:00 a 8:00 para que llegue
   fresca a la tarde. Kevin entra, abre esto e imprime la comanda en carta:
   cuántas bolsas pidió cada sucursal y el total.

   Cuenta los pedidos de las sucursales desde el mediodía de ayer hasta las
   7:00 de hoy. Lo que llegue después de las 7:00 sale aparte como «agregar».
   Todo el cálculo vive en fn_comanda_cebolla(); aquí solo se pinta e imprime.
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react'
import { db } from '../../supabase'
import { today } from '../../config'

const C = {
  card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', okBg: '#0b2417', warn: '#f59e0b', warnBg: '#2a1f06', acc: '#60a5fa', mor: '#c084fc',
}
const REFRESCO_MS = 60000

const NOMBRE = {
  M001: 'Santa Tecla', S001: 'Soyapango', S002: 'Usulután', S003: 'Lourdes',
  S004: 'Venecia', S005: 'Drive Thru Lourdes', S006: 'Metrocentro',
}
const nom = (s) => NOMBRE[s.store_code] || s.nombre
const diaLegible = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export default function ComandaCebollaView({ user }) {
  const [fecha, setFecha] = useState(today())
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    const { data, error } = await db.rpc('fn_comanda_cebolla', { p_actor: user?.id, p_fecha: fecha })
    if (error) { setErr(error.message); return }
    setErr(''); setD(data)
  }, [user?.id, fecha])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, REFRESCO_MS)
    const vis = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [cargar])

  const sucs = d?.sucursales || []
  const n0 = (v) => Number(v) || 0
  const conAlgo = sucs.filter(s => n0(s.bolsas) + n0(s.morada) > 0)
  const conAgregar = sucs.filter(s => n0(s.agregar) + n0(s.morada_agregar) > 0)
  const sinPedido = sucs.filter(s => !s.hora_pedido && !s.hora_tarde)

  // 30-oct-2026: la misma persona hace blanca (bolsa 0.75 lb) y morada (bolsa 1 lb), así que
  // van juntas en una sola hoja carta, cada una con su casilla.
  function imprimir() {
    if (!d) return
    const celda = (v) => n0(v) ? `<td class="n">${n0(v)}</td><td class="chk">☐</td>` : `<td class="n">—</td><td></td>`
    const filas = (arr, cb, cm) => arr.map(s =>
      `<tr><td>${esc(nom(s))}</td>${celda(s[cb])}${celda(s[cm])}</tr>`).join('')
    const cab = '<tr><th>Sucursal</th><th style="text-align:right">Blanca</th><th>✓</th><th style="text-align:right">Morada</th><th>✓</th></tr>'
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda cebolla ${esc(d.fecha)}</title>
<style>
 @page{size:letter;margin:16mm}
 body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
 h1{font-size:21px;margin:0}.sub{color:#444;font-size:12.5px;margin:4px 0 16px}
 .tots{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
 .tot{border:3px solid #111;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
 .tot b{font-size:44px}.tot span{font-size:16px}.tot small{display:block;font-size:12px;color:#444}
 table{width:100%;border-collapse:collapse;font-size:17px;margin-bottom:14px}
 th{text-align:left;font-size:12px;color:#555;border-bottom:2px solid #111;padding:6px}
 td{padding:9px 6px;border-bottom:1px solid #bbb}.n{text-align:right;font-weight:bold;font-size:20px;width:80px}.chk{width:36px;text-align:center;font-size:20px}
 .aviso{font-size:13px;margin:6px 0}.firmas{margin-top:30px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;font-size:13px}
 .firmas div{border-top:1px solid #111;padding-top:6px}
</style></head><body>
<h1>FREAKIE DOGS · CASA MATRIZ — Comanda de cebolla</h1>
<div class="sub">${esc(diaLegible(d.fecha))} · pedidos hasta las ${esc(d.corte)} · impresa por ${esc(user?.nombre || '')} a las ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' })}</div>
<div class="tots">
 <div class="tot"><span>Cebolla blanca<small>bolsa 0.75 lb · hacer de 7:00 a 8:00</small></span><b>${n0(d.total)}</b></div>
 <div class="tot"><span>Cebolla morada<small>bolsa 1 lb · empezar hoy mismo</small></span><b>${n0(d.total_morada)}</b></div>
</div>
<table>${cab}${filas(conAlgo, 'bolsas', 'morada') || '<tr><td colspan="5">Ninguna sucursal pidió cebolla.</td></tr>'}</table>
${conAgregar.length ? `<div class="aviso"><b>Agregar (pedido después de las 7:00): blanca ${n0(d.total_agregar)} · morada ${n0(d.total_morada_agregar)}</b></div><table>${cab}${filas(conAgregar, 'agregar', 'morada_agregar')}</table>` : ''}
${sinPedido.length ? `<div class="aviso">Sin pedido todavía: ${sinPedido.map(s => esc(nom(s))).join(', ')}</div>` : ''}
<div class="firmas"><div>Entregó (Kevin)</div><div>Recibió (área)</div><div>Hora en que terminó</div></div>
<script>window.onload=()=>{window.print()}</script></body></html>`
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) { setErr('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para el ERP.'); return }
    w.document.open(); w.document.write(html); w.document.close()
  }

  const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 12 }
  const chip = (txt, col, bg) => <span style={{ fontSize: 11.5, fontWeight: 700, color: col, background: bg, borderRadius: 99, padding: '2px 9px', whiteSpace: 'nowrap' }}>{txt}</span>

  return (
    <div style={{ padding: '18px 14px 60px', color: C.txt, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>🧅 Cebolla del día</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 2 }}>
            {d ? diaLegible(d.fecha) : ''} · pedidos desde ayer al mediodía hasta las 7:00
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={fecha} max={today()} onChange={e => setFecha(e.target.value)}
            style={{ background: C.card, color: C.txt, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13 }} />
          <button onClick={imprimir} disabled={!d}
            style={{ background: C.ok, color: '#06180c', border: 0, borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            🖨 Imprimir comanda
          </button>
        </div>
      </div>

      {err && <div style={{ ...card, borderColor: '#7f1d1d', color: '#fca5a5', marginTop: 12 }}>{err}</div>}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, marginBottom: 12 }}>
            <div style={{ ...card, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 11.5, color: C.dim, letterSpacing: '.05em' }}>CEBOLLA BLANCA · bolsa 0.75 lb</div>
              <div style={{ fontSize: 50, fontWeight: 800, lineHeight: 1.05 }}>{d.total}</div>
              <div style={{ fontSize: 11.5, color: C.dim }}>bolsas · {(n0(d.total) * 0.75).toFixed(2).replace(/\.?0+$/, '')} lb</div>
              {n0(d.total_agregar) > 0 && <div style={{ color: C.warn, fontSize: 12.5, fontWeight: 700 }}>+{d.total_agregar} por agregar</div>}
            </div>
            <div style={{ ...card, marginBottom: 0, textAlign: 'center', borderColor: '#6b21a8' }}>
              <div style={{ fontSize: 11.5, color: C.mor, letterSpacing: '.05em' }}>CEBOLLA MORADA · bolsa 1 lb</div>
              <div style={{ fontSize: 50, fontWeight: 800, lineHeight: 1.05, color: C.mor }}>{d.total_morada}</div>
              <div style={{ fontSize: 11.5, color: C.dim }}>bolsas · {n0(d.total_morada)} lb</div>
              {n0(d.total_morada_agregar) > 0 && <div style={{ color: C.warn, fontSize: 12.5, fontWeight: 700 }}>+{d.total_morada_agregar} por agregar</div>}
            </div>
          </div>

          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: C.dim, fontSize: 11.5, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Sucursal</th><th>Pedido</th>
                  <th style={{ textAlign: 'right' }}>Blanca</th><th style={{ textAlign: 'right', color: C.mor }}>Morada</th>
                </tr>
              </thead>
              <tbody>
                {sucs.map(s => (
                  <tr key={s.store_code} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '9px 4px', fontWeight: 600 }}>{nom(s)}</td>
                    <td>{s.hora_pedido ? chip(s.hora_pedido, C.ok, C.okBg) : s.hora_tarde ? chip(`tarde ${s.hora_tarde}`, C.warn, C.warnBg) : chip('sin pedido', C.warn, C.warnBg)}</td>
                    <td style={{ textAlign: 'right', fontSize: 17, fontWeight: 700 }}>{n0(s.bolsas) || '—'}{n0(s.agregar) ? <span style={{ color: C.warn, fontSize: 12 }}> +{s.agregar}</span> : null}</td>
                    <td style={{ textAlign: 'right', fontSize: 17, fontWeight: 700, color: C.mor }}>{n0(s.morada) || '—'}{n0(s.morada_agregar) ? <span style={{ color: C.warn, fontSize: 12 }}> +{s.morada_agregar}</span> : null}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid #3a3a45`, fontWeight: 800 }}>
                  <td style={{ padding: '9px 4px' }}>Total</td><td />
                  <td style={{ textAlign: 'right', fontSize: 17 }}>{d.total}</td>
                  <td style={{ textAlign: 'right', fontSize: 17, color: C.mor }}>{d.total_morada}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {sinPedido.length > 0 && (
            <div style={{ color: C.warn, fontSize: 13 }}>
              ⚠ {sinPedido.length === 1 ? 'Falta el pedido de' : 'Faltan los pedidos de'} {sinPedido.map(nom).join(', ')}. Si lo mandan después, aparece aquí solo como «agregar».
            </div>
          )}
          <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>
            Se actualiza cada minuto. Turno de cebolla blanca: 7:00–8:00, para que se use fresca en la tarde. La morada se empieza el mismo día.
          </div>
        </>
      )}
    </div>
  )
}
