import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip';

// ── PROYECCIÓN Y VENTAS (18-nov-2026, Cesar + encargados) ───────────
// Para que el encargado proyecte su pedido de 1 a 4 días sin hacer cuentas:
//  • Proyección de insumos: lo que se gastó los últimos 4 jueves, viernes…
//    (kardex de ventas → recetas), por día, con el rango; suma los días que
//    elija, le resta lo que tiene y dice cuánto pedir en empaques. Sin colchón.
//  • Ventas por producto: lo vendido de cada producto del menú, promedio por
//    día de la semana y día por día.
// RPCs: proyeccion_consumo(sucursal, dias) · historial_ventas_menu(sucursal, desde, hasta)
// ─────────────────────────────────────────────────────────────

const ROLES_VER_TODAS = ['ejecutivo', 'admin', 'superadmin', 'jefe_casa_matriz'];
const svDate = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' });
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dowDe = (f) => (new Date(f + 'T12:00:00').getDay() + 6) % 7;
const fCorta = (f) => { const d = new Date(f + 'T12:00:00'); return `${DIAS[dowDe(f)]} ${d.getDate()}`; };
const r1 = (x) => { const v = Math.round((Number(x) || 0) * 10) / 10; return v % 1 ? v.toFixed(1) : String(v); };
const fac = (p) => (Number(p?.conteo_factor) > 0 ? Number(p.conteo_factor) : 1);
const emp = (p) => p?.conteo_unidad || p?.unidad || 'unidad';

const c = { card: '#161616', border: '#2a2a2a', dim: '#888', text: '#eee', blue: '#60a5fa', yellow: '#facc15', green: '#4ade80', red: '#e63946' };
const chip = (on) => ({ background: on ? '#1e3a5f' : '#1a1a1a', color: on ? '#bfdbfe' : '#ccc', border: `1px solid ${on ? c.blue : '#333'}`,
  borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
const th = { padding: '8px 6px', fontWeight: 700, color: c.dim, fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' };
const td = { padding: '7px 6px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: 13 };

export default function ProyeccionView({ user }) {
  const [tab, setTab] = useState('proy');
  const [sucursales, setSucursales] = useState([]);
  const [suc, setSuc] = useState(null);
  const canAll = ROLES_VER_TODAS.includes(user.rol);

  useEffect(() => { (async () => {
    if (canAll) {
      const { data } = await db.from('sucursales').select('id,store_code,nombre').order('store_code');
      const lista = (data || []).filter(s => /^[SM]/.test(s.store_code || ''));
      setSucursales(lista); if (lista[0]) setSuc(lista[0]);
    } else if (user.store_code) {
      const { data } = await db.from('sucursales').select('id,store_code,nombre').eq('store_code', user.store_code).maybeSingle();
      if (data) setSuc(data);
    }
  })(); }, []);

  return (
    <div style={{ padding: '16px 16px 100px', maxWidth: 1000, margin: '0 auto', color: c.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📈 Proyección y ventas <InfoTip text="Lo que se gastó y vendió en tu sucursal, día por día, para calcular cuánto pedir para los próximos 1 a 4 días." /></h2>
          <div style={{ color: c.dim, fontSize: 13, marginTop: 2 }}>{suc ? `Sucursal: ${suc.nombre}` : 'Cargando sucursal…'}</div>
        </div>
        {canAll && sucursales.length > 0 && (
          <select className="input" value={suc?.id || ''} onChange={e => setSuc(sucursales.find(s => s.id === e.target.value))}>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} — {s.nombre}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button style={chip(tab === 'proy')} onClick={() => setTab('proy')}>📦 Proyección de insumos</button>
        <button style={chip(tab === 'ventas')} onClick={() => setTab('ventas')}>🍔 Ventas por producto</button>
      </div>
      {suc && (tab === 'proy' ? <Proyeccion suc={suc} /> : <Ventas suc={suc} />)}
    </div>
  );
}

function Proyeccion({ suc }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [dias, setDias] = useState(2);
  const [q, setQ] = useState('');
  const [soloPedir, setSoloPedir] = useState(false);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => { setD(null); setErr('');
    db.rpc('proyeccion_consumo', { p_sucursal_id: suc.id, p_dias: 4 }).then(({ data, error }) => {
      if (error) setErr(error.message); else setD(data);
    });
  }, [suc.id]);

  const filas = useMemo(() => {
    if (!d) return [];
    return Object.entries(d.productos || {}).map(([id, p]) => {
      const f = fac(p);
      const porDia = (p.por_dia || []).map(x => ({ ...x, e: x.prom / f, emin: x.min / f, emax: x.max / f }));
      const nec = porDia.slice(0, dias).reduce((s, x) => s + Number(x.prom || 0), 0);
      const tiene = Math.max(0, Number(d.stock?.[id] || 0));
      const pedir = Math.ceil(Math.max(0, nec - tiene) / f - 1e-9);
      return { id, ...p, porDia, necE: nec / f, tieneE: tiene / f, pedir };
    }).filter(x => x.necE > 0.001 || x.pedir > 0)
      .filter(x => !q || x.nombre.toLowerCase().includes(q.toLowerCase()))
      .filter(x => !soloPedir || x.pedir > 0)
      .sort((a, b) => a.categoria.localeCompare(b.categoria) || b.necE - a.necE);
  }, [d, dias, q, soloPedir]);

  if (err) return <div style={{ color: '#fca5a5' }}>No se pudo cargar: {err}</div>;
  if (!d) return <div style={{ color: c.dim }}>Calculando con las ventas de las últimas 4 semanas…</div>;

  const diasSel = (d.dias || []).slice(0, dias);
  const porCat = filas.reduce((m, x) => ((m[x.categoria] ||= []).push(x), m), {});
  const nPedir = filas.filter(x => x.pedir > 0).length;

  return (
    <>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: c.dim }}>¿Para cuántos días?</span>
          {[1, 2, 3, 4].map(n => <button key={n} style={chip(dias === n)} onClick={() => setDias(n)}>{n} día{n > 1 ? 's' : ''}</button>)}
        </div>
        <div style={{ fontSize: 13, marginTop: 8 }}>
          Proyectando: <b>{diasSel.map(x => fCorta(x.fecha)).join(', ')}</b>
          {diasSel.some(x => x.asueto) && <span style={{ color: c.yellow }}> · ⚠️ {diasSel.filter(x => x.asueto).map(x => `${fCorta(x.fecha)} es asueto (${x.asueto})`).join(', ')}: ese día puede vender distinto</span>}
        </div>
        <div style={{ fontSize: 11.5, color: c.dim, marginTop: 6 }}>
          Cada día = promedio de los últimos {Math.min(...diasSel.map(x => x.semanas)) < 4 ? `${Math.min(...diasSel.map(x => x.semanas))}–4` : 4} días iguales (ej. los últimos 4 jueves). Abajo, en gris, el día más bajo y el más alto.
          «Tenés» = inventario del sistema ahora{d.ultimo_conteo ? ` (último conteo nocturno: ${fCorta(d.ultimo_conteo)})` : ''}. Todo va en empaques.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input className="input" placeholder="Buscar insumo…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 200px' }} />
        <label style={{ fontSize: 13, color: '#ccc', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soloPedir} onChange={e => setSoloPedir(e.target.checked)} /> Solo lo que hay que pedir ({nPedir})
        </label>
      </div>

      <div style={{ overflowX: 'auto', background: c.card, border: `1px solid ${c.border}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr style={{ borderBottom: `1px solid ${c.border}` }}>
            <th style={{ ...th, textAlign: 'left' }}>Insumo</th>
            {diasSel.map(x => <th key={x.k} style={th}>{fCorta(x.fecha)}</th>)}
            <th style={th}>Necesitás</th><th style={th}>Tenés</th><th style={{ ...th, color: c.blue }}>Pedir</th>
          </tr></thead>
          <tbody>
            {Object.entries(porCat).map(([cat, items]) => [
              <tr key={'c' + cat}><td colSpan={diasSel.length + 4} style={{ padding: '10px 6px 4px', fontSize: 11, fontWeight: 800, color: '#777', textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat}</td></tr>,
              ...items.map(x => [
                <tr key={x.id} onClick={() => setAbierto(abierto === x.id ? null : x.id)} style={{ borderTop: `1px solid #222`, cursor: 'pointer' }}>
                  <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                    <div style={{ fontWeight: 600 }}>{x.nombre}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{emp(x)}</div>
                  </td>
                  {x.porDia.slice(0, dias).map(p => (
                    <td key={p.k} style={td}>
                      <div>{r1(p.e)}</div>
                      <div style={{ fontSize: 10.5, color: '#666' }}>{r1(p.emin)}–{r1(p.emax)}</div>
                    </td>
                  ))}
                  <td style={{ ...td, fontWeight: 700 }}>{r1(x.necE)}</td>
                  <td style={{ ...td, color: '#aaa' }}>{r1(x.tieneE)}</td>
                  <td style={td}>
                    <span style={{ fontWeight: 800, padding: '3px 10px', borderRadius: 8,
                      background: x.pedir > 0 ? '#1e3a5f' : '#14301f', color: x.pedir > 0 ? '#bfdbfe' : c.green }}>{x.pedir > 0 ? x.pedir : 'OK'}</span>
                  </td>
                </tr>,
                abierto === x.id && (
                  <tr key={x.id + 'h'}><td colSpan={diasSel.length + 4} style={{ padding: '4px 8px 12px', fontSize: 12, color: '#aaa' }}>
                    {x.porDia.slice(0, dias).map(p => (
                      <div key={p.k} style={{ marginTop: 4 }}>
                        <b style={{ color: '#ccc' }}>{fCorta(diasSel[p.k].fecha)}</b> se calculó con: {(p.hist || []).map(h => `${fCorta(h.f)} ${r1(h.q / fac(x))}`).join(' · ')}
                      </div>
                    ))}
                  </td></tr>
                )
              ])
            ])}
          </tbody>
        </table>
        {filas.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: c.dim }}>Nada que mostrar con ese filtro.</div>}
      </div>
      <div style={{ fontSize: 11.5, color: '#666', marginTop: 8 }}>
        Tocá un insumo para ver con qué días se calculó. Para pedir, hacé el conteo nocturno: en «Pedido sugerido» elegís los mismos días y te llena las cantidades.
      </div>
    </>
  );
}

function Ventas({ suc }) {
  const [rango, setRango] = useState(28);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [vista, setVista] = useState('semana');

  useEffect(() => { setD(null); setErr('');
    const hasta = new Date(); hasta.setDate(hasta.getDate() - 1);
    const desde = new Date(); desde.setDate(desde.getDate() - rango);
    db.rpc('historial_ventas_menu', { p_sucursal_id: suc.id, p_desde: svDate(desde), p_hasta: svDate(hasta) }).then(({ data, error }) => {
      if (error) setErr(error.message); else setD(data);
    });
  }, [suc.id, rango]);

  const fechas = d?.fechas || [];
  const cuentaDow = useMemo(() => { const n = Array(7).fill(0); fechas.forEach(f => n[dowDe(f)]++); return n; }, [fechas]);
  const prods = useMemo(() => (d?.productos || [])
    .filter(p => !q || p.nombre.toLowerCase().includes(q.toLowerCase()))
    .map(p => {
      const s = Array(7).fill(0); Object.entries(p.dias || {}).forEach(([f, v]) => { s[dowDe(f)] += Number(v); });
      return { ...p, dow: s.map((v, i) => cuentaDow[i] ? v / cuentaDow[i] : 0) };
    }), [d, q, cuentaDow]);
  const ultimas = fechas.slice(-14);

  if (err) return <div style={{ color: '#fca5a5' }}>No se pudo cargar: {err}</div>;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {[7, 14, 28, 56].map(n => <button key={n} style={chip(rango === n)} onClick={() => setRango(n)}>{n} días</button>)}
        <span style={{ width: 12 }} />
        <button style={chip(vista === 'semana')} onClick={() => setVista('semana')}>Promedio por día de la semana</button>
        <button style={chip(vista === 'diario')} onClick={() => setVista('diario')}>Día por día</button>
      </div>
      <input className="input" placeholder="Buscar producto…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      {!d ? <div style={{ color: c.dim }}>Cargando ventas…</div> : (
        <div style={{ overflowX: 'auto', background: c.card, border: `1px solid ${c.border}`, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead><tr style={{ borderBottom: `1px solid ${c.border}` }}>
              <th style={{ ...th, textAlign: 'left' }}>Producto</th>
              {vista === 'semana' ? DIAS.map((x, i) => <th key={x} style={th}>{x}<div style={{ fontWeight: 500, fontSize: 10, color: '#555' }}>{cuentaDow[i]} días</div></th>)
                : ultimas.map(f => <th key={f} style={th}>{fCorta(f)}</th>)}
              <th style={th}>Total</th><th style={th}>Prom/día</th>
            </tr></thead>
            <tbody>
              {prods.map(p => (
                <tr key={p.nombre} style={{ borderTop: '1px solid #222' }}>
                  <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', fontWeight: 600 }}>{p.nombre}</td>
                  {vista === 'semana'
                    ? p.dow.map((v, i) => { const mx = Math.max(...p.dow); return <td key={i} style={{ ...td, color: v === mx && v > 0 ? c.yellow : '#ddd' }}>{r1(v)}</td>; })
                    : ultimas.map(f => <td key={f} style={td}>{p.dias?.[f] ?? <span style={{ color: '#444' }}>0</span>}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{p.total}</td>
                  <td style={{ ...td, color: '#aaa' }}>{r1(fechas.length ? p.total / fechas.length : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {prods.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: c.dim }}>Sin ventas en ese rango.</div>}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: '#666', marginTop: 8 }}>
        Ventas cobradas del POS (salón, para llevar, delivery y PeYa). En amarillo, el día de la semana que más se vende cada producto.
      </div>
    </>
  );
}
