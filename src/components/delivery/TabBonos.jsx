// ─────────────────────────────────────────────────────────────────────────────
// Torre de Control · Bonos y costeo de delivery
// Lee TODO en vivo por la RPC gateada torre_bonos_delivery(p_token, p_mes):
//   viajes del mes (con km, tiempo real y monto de la orden), drivers activos
//   con su paga fija (salario + viático) y las tarifas/tasas patronales.
// El bono por viaje se calcula igual que siempre (bonoDriver); acá se agrega la
// vista por sucursal → driver → día → viaje y los KPIs de costo de delivery.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';   // mismo token de staff que la tab Pedidos

// ── Paleta / estilos (consistentes con DeliveryView) ─────────────────────────
const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#888', off: '#555',
};
const card = (ex = {}) => ({ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginBottom: 10, ...ex });
const btn  = (bg, fg = '#fff') => ({ padding: '9px 16px', borderRadius: 8, background: bg, color: fg, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const inp  = { background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '9px 12px', color: c.text, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const lbl  = { display: 'block', fontSize: 11, color: c.dim, marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const kpi  = (color) => ({ flex: 1, minWidth: 130, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: `3px solid ${color}` });

const n = (x) => Number(x) || 0;
const fmt = (x) => `$${n(x).toFixed(2)}`;

// ── Bono por viaje (idéntico al de DeliveryView, no se cambia el cálculo) ─────
function bonoDriver(viajes, cfg) {
  const umbral   = cfg.km_umbral_doble ?? 17;
  const fuera    = viajes.filter(v => v.es_fuera_de_horario).length;
  const normal   = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'entrega' && n(v.distancia_km) < umbral).length;
  const larga    = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'entrega' && n(v.distancia_km) >= umbral).length;
  const mandados = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'mandado').length;
  const total    = normal * (cfg.tarifa_entrega_normal ?? 0.5)
                 + larga  * (cfg.tarifa_entrega_larga  ?? 1.0)
                 + fuera  * (cfg.tarifa_fuera_horario  ?? 3.0)
                 + mandados * (cfg.tarifa_mandado       ?? 0.5);
  return { normal, larga, fuera, mandados, total: Math.round(total * 100) / 100 };
}

// ── Costo fijo patronal del driver (paga fija + ISSS + AFP) ───────────────────
function costoFijo(d, cfg) {
  if (!d.cuenta_salario) return { fija: 0, isss: 0, afp: 0, total: 0 };
  const base = n(d.salario_mensual), viat = n(d.viatico_mensual);
  const isss = Math.min(base, cfg.patronal_isss_tope ?? 1000) * (cfg.patronal_isss_pct ?? 7.5) / 100;
  const afp  = base * (cfg.patronal_afp_pct ?? 8.75) / 100;
  const fija = base + viat;
  return { fija, isss, afp, total: fija + isss + afp };
}

// ── Agrupa los viajes de un driver-día en "viajes reales" (rondas) ────────────
// Órdenes recogidas con < 180 s de diferencia salieron juntas (botón "Salir con
// todos"). Es una estimación por tiempos; los mandados sin recogida van sueltos.
const VENTANA_MS = 180 * 1000;
function agruparRondas(vjs) {
  const conRec = vjs.filter(v => v.recogido_sv).sort((a, b) => a.recogido_sv.localeCompare(b.recogido_sv));
  const sinRec = vjs.filter(v => !v.recogido_sv);
  const rondas = [];
  let cur = null;
  for (const v of conRec) {
    const t = Date.parse(v.recogido_sv.replace(' ', 'T'));
    if (cur && (t - cur._last) <= VENTANA_MS) { cur.viajes.push(v); cur._last = t; }
    else { cur = { viajes: [v], _last: t, hora: v.recogido_sv.slice(11, 16) }; rondas.push(cur); }
  }
  for (const v of sinRec) rondas.push({ viajes: [v], _last: 0, hora: null });
  return rondas;
}

const mesActual = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const fmtMes = m => { if (!m) return ''; const [y, mo] = m.split('-'); return `${MESES[+mo - 1]} ${y}`; };
const cfgFloats = (obj) => { const o = {}; for (const k in (obj || {})) { const f = parseFloat(obj[k]); o[k] = isNaN(f) ? obj[k] : f; } return o; };

// ═════════════════════════════════════════════════════════════════════════════
export default function TabBonos({ user, show = () => {}, puedeAprobar = false }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [mes, setMes]       = useState(mesActual());
  const [data, setData]     = useState(null);      // payload de la RPC
  const [guardados, setGuardados] = useState([]);  // estado calculado/aprobado
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState('');
  const [guardando, setGuardando] = useState(false);
  const [openSuc, setOpenSuc]     = useState({});  // store_code → bool
  const [openDrv, setOpenDrv]     = useState(null); // empleado_id
  const [openDia, setOpenDia]     = useState(null); // empleado_id|fecha

  const cargar = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setErr('');
    try {
      const [{ data: d, error }, bon] = await Promise.all([
        db.rpc('torre_bonos_delivery', { p_token: token, p_mes: mes }),
        db.from('bonos_delivery_mensual').select('*').eq('mes', mes),
      ]);
      if (error) throw error;
      setData(d);
      setGuardados(bon.data || []);
    } catch (e) {
      setErr(e.message || 'No se pudo cargar');
      setData(null);
    }
    setLoading(false);
  }, [token, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  const cfg = useMemo(() => cfgFloats(data?.tarifas), [data]);

  // Proración del costo fijo en el mes corriente (salario completo vs venta parcial)
  const factor = useMemo(() => {
    const [y, mo] = mes.split('-').map(Number);
    const diasMes = new Date(y, mo, 0).getDate();
    if (mes !== mesActual()) return 1;
    const hoy = new Date(Date.now() - 6 * 3600 * 1000).getUTCDate();
    return Math.min(1, hoy / diasMes);
  }, [mes]);

  // Árbol: sucursal → drivers (con sus viajes, bono y costo fijo)
  const sucursales = useMemo(() => {
    if (!data) return [];
    const drivers = data.drivers || [];
    const viajes = data.viajes || [];
    const ventasMap = Object.fromEntries((data.ventas_por_sucursal || []).map(v => [v.store_code, n(v.ventas)]));

    const porDriver = drivers.map(d => {
      const vjs = viajes.filter(v => v.empleado_id === d.empleado_id);
      return { ...d, vjs, bono: bonoDriver(vjs, cfg), costo: costoFijo(d, cfg), saved: guardados.find(g => g.empleado_id === d.empleado_id) };
    });

    const byStore = {};
    for (const d of porDriver) {
      const sc = d.store_code || '—';
      (byStore[sc] ||= { store_code: sc, nombre: d.sucursal_nombre || sc, drivers: [] }).drivers.push(d);
    }
    return Object.values(byStore)
      .map(s => {
        s.drivers.sort((a, b) => b.bono.total - a.bono.total);
        s.ventas = ventasMap[s.store_code] || 0;
        s.bono   = s.drivers.reduce((x, d) => x + d.bono.total, 0);
        s.fijo   = s.drivers.reduce((x, d) => x + d.costo.total, 0) * factor;
        s.costoPct = s.ventas > 0 ? (s.fijo + s.bono) / s.ventas * 100 : null;
        s.viajes = s.drivers.reduce((x, d) => x + d.vjs.length, 0);
        return s;
      })
      .sort((a, b) => a.store_code.localeCompare(b.store_code));
  }, [data, cfg, guardados, factor]);

  const tot = useMemo(() => {
    const ventas = sucursales.reduce((s, x) => s + x.ventas, 0);
    const bono   = sucursales.reduce((s, x) => s + x.bono, 0);
    const fijo   = sucursales.reduce((s, x) => s + x.fijo, 0);
    const viajes = sucursales.reduce((s, x) => s + x.viajes, 0);
    const drivers = sucursales.reduce((s, x) => s + x.drivers.length, 0);
    return { ventas, bono, fijo, viajes, drivers, costoPct: ventas > 0 ? (fijo + bono) / ventas * 100 : null };
  }, [sucursales]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const { data: nq, error } = await db.rpc('calcular_bonos_delivery_mes', { p_mes: mes });
      if (error) throw error;
      show(`✅ Bonos calculados para ${nq} conductor(es)`);
      cargar();
    } catch (e) { show('❌ ' + e.message); }
    setGuardando(false);
  };

  const aprobar = async (empleadoId) => {
    const { error } = await db.from('bonos_delivery_mensual')
      .update({ estado: 'aprobado' }).eq('mes', mes).eq('empleado_id', empleadoId);
    if (error) { show('❌ ' + error.message); return; }
    show('✅ Bono aprobado'); cargar();
  };

  const colorPct = (p) => p == null ? c.dim : p <= 20 ? c.green : p <= 35 ? c.yellow : c.red;

  // ── Guard de sesión ─────────────────────────────────────────────────────────
  if (!token) return (
    <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>
      Entrá con tu PIN en 📥 <b>Pedidos</b> para ver los bonos y el costeo de delivery.
    </div>
  );
  if (loading) return <div style={{ textAlign: 'center', padding: 32, color: c.dim }}>Cargando…</div>;
  if (err) return <div style={{ textAlign: 'center', padding: 32, color: c.red }}>⚠️ {err}</div>;

  return (
    <div>
      {/* Selector de mes */}
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Período</label>
        <input type="month" value={mes} max={mesActual()} onChange={e => setMes(e.target.value)} style={inp} />
      </div>

      {tot.drivers === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: c.dim }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
          <div>Sin actividad de delivery en {fmtMes(mes)}</div>
        </div>
      ) : (
        <>
          {/* KPIs globales */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={kpi(colorPct(tot.costoPct))}>
              <div style={{ fontSize: 10, color: c.dim }}>COSTO DE DELIVERY</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: colorPct(tot.costoPct) }}>
                {tot.costoPct == null ? '—' : `${tot.costoPct.toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 9, color: c.dim }}>(fijo+bono) ÷ ventas</div>
            </div>
            <div style={kpi(c.blue)}><div style={{ fontSize: 10, color: c.dim }}>VENTAS ENTREGADAS</div><div style={{ fontSize: 18, fontWeight: 700, color: c.blue }}>{fmt(tot.ventas)}</div></div>
            <div style={kpi(c.orange)}><div style={{ fontSize: 10, color: c.dim }}>COSTO FIJO {mes === mesActual() ? '(prorr.)' : ''}</div><div style={{ fontSize: 18, fontWeight: 700, color: c.orange }}>{fmt(tot.fijo)}</div></div>
            <div style={kpi(c.green)}><div style={{ fontSize: 10, color: c.dim }}>BONO VIAJES</div><div style={{ fontSize: 18, fontWeight: 700, color: c.green }}>{fmt(tot.bono)}</div></div>
            <div style={kpi(c.purple)}><div style={{ fontSize: 10, color: c.dim }}>VIAJES · DRIVERS</div><div style={{ fontSize: 18, fontWeight: 700, color: c.purple }}>{tot.viajes} · {tot.drivers}</div></div>
          </div>

          {/* Comparación por sucursal */}
          <div style={card()}>
            <div style={{ fontSize: 12, fontWeight: 700, color: c.dim, marginBottom: 8 }}>🏪 COSTO DE DELIVERY POR SUCURSAL</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid #444`, color: c.dim }}>
                    <th style={{ padding: '6px 6px', textAlign: 'left' }}>Sucursal</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ventas</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Fijo</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Bono</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right' }}>Costo %</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sucursales].sort((a, b) => (a.costoPct ?? 999) - (b.costoPct ?? 999)).map(s => (
                    <tr key={s.store_code} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '6px 6px', color: c.text, fontWeight: 600 }}>{s.store_code} <span style={{ color: c.dim, fontWeight: 400 }}>{s.nombre}</span></td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: c.blue }}>{fmt(s.ventas)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: c.orange }}>{fmt(s.fijo)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: c.green }}>{fmt(s.bono)}</td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 800, color: colorPct(s.costoPct) }}>{s.costoPct == null ? '—' : `${s.costoPct.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Árbol: sucursal → driver → día → viaje */}
          {sucursales.map(s => {
            const abierta = openSuc[s.store_code] ?? true;
            return (
              <div key={s.store_code} style={card({ padding: 10 })}>
                <div onClick={() => setOpenSuc(o => ({ ...o, [s.store_code]: !abierta }))}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ fontWeight: 700, color: c.text }}>{abierta ? '▾' : '▸'} {s.store_code} · {s.nombre}</span>
                  <span style={{ fontSize: 12, color: c.dim }}>{s.drivers.length} drivers · bono {fmt(s.bono)}</span>
                </div>

                {abierta && s.drivers.map(d => {
                  const drvOpen = openDrv === d.empleado_id;
                  const incompleto = d.cuenta_salario && (n(d.salario_mensual) === 0 || n(d.viatico_mensual) === 0);
                  // Días con actividad
                  const dias = Object.values(d.vjs.reduce((acc, v) => {
                    (acc[v.fecha] ||= { fecha: v.fecha, vjs: [] }).vjs.push(v); return acc;
                  }, {})).sort((a, b) => b.fecha.localeCompare(a.fecha));
                  return (
                    <div key={d.empleado_id} style={{ borderTop: '1px solid #262626', marginTop: 6, paddingTop: 6 }}>
                      <div onClick={() => setOpenDrv(drvOpen ? null : d.empleado_id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '2px 0' }}>
                        <span style={{ color: c.text }}>
                          {drvOpen ? '▾' : '▸'} {d.nombre}
                          {!d.cuenta_salario && <span style={{ fontSize: 10, color: c.dim }}> · no cuenta salario</span>}
                          {incompleto && <span style={{ fontSize: 10, color: c.yellow }}> ⚠️ falta sueldo/viático</span>}
                          {d.saved?.estado && <span style={{ fontSize: 10, color: d.saved.estado === 'aprobado' ? c.green : c.yellow }}> · {d.saved.estado}</span>}
                        </span>
                        <span style={{ fontSize: 12, color: c.dim }}>{d.vjs.length} viajes · <b style={{ color: c.green }}>{fmt(d.bono.total)}</b></span>
                      </div>

                      {drvOpen && (
                        <div style={{ paddingLeft: 12 }}>
                          {/* Resumen de paga del driver */}
                          <div style={{ fontSize: 11, color: c.dim, padding: '4px 0' }}>
                            Bono: Nrm {d.bono.normal} · Lrg {d.bono.larga} · F.Hr {d.bono.fuera} · Mnd {d.bono.mandados}
                            {d.cuenta_salario && <> · Fija {fmt(d.costo.fija)} + ISSS {fmt(d.costo.isss)} + AFP {fmt(d.costo.afp)} = <b>{fmt(d.costo.total)}</b></>}
                          </div>
                          {dias.map(dia => {
                            const diaKey = d.empleado_id + '|' + dia.fecha;
                            const diaOpen = openDia === diaKey;
                            const bonoDia = bonoDriver(dia.vjs, cfg).total;
                            const rondas = agruparRondas(dia.vjs);
                            return (
                              <div key={diaKey} style={{ borderTop: '1px dashed #2a2a2a' }}>
                                <div onClick={() => setOpenDia(diaOpen ? null : diaKey)}
                                  style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', padding: '4px 0', fontSize: 12 }}>
                                  <span style={{ color: c.blue }}>{diaOpen ? '▾' : '▸'} {dia.fecha} <span style={{ color: c.dim }}>({rondas.length} viaje{rondas.length !== 1 ? 's' : ''}, {dia.vjs.length} órdenes)</span></span>
                                  <span style={{ color: c.green }}>{fmt(bonoDia)}</span>
                                </div>
                                {diaOpen && rondas.map((r, i) => (
                                  <div key={i} style={{ margin: '4px 0 8px', paddingLeft: 10, borderLeft: `2px solid ${r.viajes.length > 1 ? c.purple : '#333'}` }}>
                                    {r.viajes.length > 1 && (
                                      <div style={{ fontSize: 11, color: c.purple, fontWeight: 600 }}>🛵 Viaje con {r.viajes.length} órdenes {r.hora && `· salió ${r.hora}`} <span style={{ color: c.dim, fontWeight: 400 }}>(agrupado por hora de salida)</span></div>
                                    )}
                                    {r.viajes.map(v => (
                                      <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: c.text }}>
                                        <span>
                                          {v.tipo === 'mandado' ? '📦 Mandado' : (v.orden_numero || '—')}
                                          {v.es_fuera_de_horario && <span style={{ color: c.orange }}> · f.hr</span>}
                                        </span>
                                        <span style={{ color: c.dim }}>
                                          {v.distancia_km != null && `${n(v.distancia_km).toFixed(1)} km`}
                                          {v.minutos != null && ` · ${v.minutos} min`}
                                          {v.monto != null && <span style={{ color: c.blue }}> · {fmt(v.monto)}</span>}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            );
                          })}

                          {puedeAprobar && d.saved && d.saved.estado !== 'aprobado' && (
                            <button onClick={() => aprobar(d.empleado_id)} style={{ ...btn(c.green), width: '100%', marginTop: 6 }}>✅ Aprobar bono</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Calcular/guardar bonos del mes */}
          {puedeAprobar && (
            <button onClick={guardar} disabled={guardando}
              style={{ ...btn(guardando ? '#333' : c.yellow, guardando ? c.dim : '#000'), width: '100%', marginTop: 6 }}>
              {guardando ? 'Calculando…' : `💾 Calcular y guardar bonos — ${fmtMes(mes)}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: c.dim, marginTop: 10, lineHeight: 1.5 }}>
            Costo fijo = sueldo base + viático + ISSS ({cfg.patronal_isss_pct ?? 7.5}%, tope {fmt(cfg.patronal_isss_tope ?? 1000)}) + AFP ({cfg.patronal_afp_pct ?? 8.75}%).
            {mes === mesActual() && ' En el mes corriente el costo fijo se prorratea por los días transcurridos.'}
            {' '}La agrupación de órdenes en un mismo viaje es estimada por la hora de salida.
          </div>
        </>
      )}
    </div>
  );
}
