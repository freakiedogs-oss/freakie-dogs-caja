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
  ok: '#22c55e', okBg: '#0b2417', warn: '#f59e0b', warnBg: '#2a1f06', acc: '#60a5fa',
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
  const conBolsas = sucs.filter(s => Number(s.bolsas) > 0)
  const conAgregar = sucs.filter(s => Number(s.agregar) > 0)
  const sinPedido = sucs.filter(s => !s.hora_pedido && !s.hora_tarde)

  function imprimir() {
    if (!d) return
    const filas = (arr, campo) => arr.map(s =>
      `<tr><td>${esc(nom(s))}</td><td class="n">${Number(s[campo])}</td><td class="chk">☐</td></tr>`).join('')
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda cebolla ${esc(d.fecha)}</title>
<style>
 @page{size:letter;margin:18mm}
 body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
 h1{font-size:22px;margin:0}.sub{color:#444;font-size:13px;margin:4px 0 18px}
 .tot{border:3px solid #111;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
 .tot b{font-size:44px}
 table{width:100%;border-collapse:collapse;font-size:17px;margin-bottom:16px}
 th{text-align:left;font-size:12px;color:#555;border-bottom:2px solid #111;padding:6px}
 td{padding:10px 6px;border-bottom:1px solid #bbb}.n{text-align:right;font-weight:bold;font-size:20px;width:90px}.chk{width:40px;text-align:center;font-size:20px}
 .aviso{font-size:13px;margin:6px 0}.firmas{margin-top:34px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;font-size:13px}
 .firmas div{border-top:1px solid #111;padding-top:6px}
</style></head><body>
<h1>FREAKIE DOGS · CASA MATRIZ — Comanda de cebolla blanca</h1>
<div class="sub">${esc(diaLegible(d.fecha))} · pedidos hasta las ${esc(d.corte)} · impresa por ${esc(user?.nombre || '')} a las ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' })}</div>
<div class="tot"><span style="font-size:18px">Bolsas de cebolla blanca a preparar<br><span style="font-size:13px;color:#444">Hacer de 7:00 a 8:00</span></span><b>${Number(d.total)}</b></div>
<table><tr><th>Sucursal</th><th style="text-align:right">Bolsas</th><th>Lista</th></tr>${filas(conBolsas, 'bolsas') || '<tr><td colspan="3">Ninguna sucursal pidió cebolla blanca.</td></tr>'}</table>
${conAgregar.length ? `<div class="aviso"><b>Agregar (pedido después de las 7:00): ${Number(d.total_agregar)} bolsas</b></div><table>${filas(conAgregar, 'agregar')}</table>` : ''}
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
          <div style={{ fontSize: 19, fontWeight: 800 }}>🧅 Cebolla blanca del día</div>
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
          <div style={{ ...card, marginTop: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: C.dim, letterSpacing: '.05em' }}>BOLSAS A PREPARAR</div>
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}>{d.total}</div>
            {Number(d.total_agregar) > 0 && <div style={{ color: C.warn, fontSize: 13, fontWeight: 700 }}>+{d.total_agregar} por agregar (pedidos después de las 7:00)</div>}
          </div>

          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: C.dim, fontSize: 11.5, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Sucursal</th><th>Pedido</th>
                  <th style={{ textAlign: 'right' }}>Bolsas</th><th style={{ textAlign: 'right' }}>Agregar</th>
                </tr>
              </thead>
              <tbody>
                {sucs.map(s => (
                  <tr key={s.store_code} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '9px 4px', fontWeight: 600 }}>{nom(s)}</td>
                    <td>{s.hora_pedido ? chip(s.hora_pedido, C.ok, C.okBg) : s.hora_tarde ? chip(`tarde ${s.hora_tarde}`, C.warn, C.warnBg) : chip('sin pedido', C.warn, C.warnBg)}</td>
                    <td style={{ textAlign: 'right', fontSize: 17, fontWeight: 700 }}>{Number(s.bolsas) || '—'}</td>
                    <td style={{ textAlign: 'right', color: C.warn, fontWeight: 700 }}>{Number(s.agregar) ? `+${s.agregar}` : ''}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid #3a3a45`, fontWeight: 800 }}>
                  <td style={{ padding: '9px 4px' }}>Total</td><td />
                  <td style={{ textAlign: 'right', fontSize: 17 }}>{d.total}</td>
                  <td style={{ textAlign: 'right', color: C.warn }}>{Number(d.total_agregar) ? `+${d.total_agregar}` : ''}</td>
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
            Se actualiza cada minuto. Turno de cebolla: 7:00–8:00, para que se use fresca en la tarde.
          </div>
        </>
      )}
    </div>
  )
}
