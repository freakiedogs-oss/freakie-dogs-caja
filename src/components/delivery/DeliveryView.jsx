import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { db } from '../../supabase';
import { today, n } from '../../config';

import TabPedidos from './TabPedidos';
import TabParametros from './TabParametros';
// Cobertura usa Leaflet (mapa): lazy para no cargarlo hasta abrir ese tab
const TabCobertura = lazy(() => import('./TabCobertura'));

// ── Paleta ──────────────────────────────────────────────────────────────────
const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#888', off: '#555',
};
const card = (ex = {}) => ({ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginBottom: 10, ...ex });
const btn  = (bg, fg = '#fff') => ({ padding: '9px 16px', borderRadius: 8, background: bg, color: fg, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const inp  = { background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '9px 12px', color: c.text, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const lbl  = { display: 'block', fontSize: 11, color: c.dim, marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const kpi  = (color) => ({ flex: 1, minWidth: 140, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: `3px solid ${color}` });

// ── Cargos de motoristas (case-sensitive, tal como está en BD) ───────────────
const CARGOS_DRIVER = ['Motorista', 'Domicilio', 'Motorista Interno', 'Domicilios Propios'];

// ── config_delivery: array {parametro,valor} → objeto plano ─────────────────
const parseCfg = rows => (rows || []).reduce((a, r) => { a[r.parametro] = parseFloat(r.valor); return a; }, {});

// ── Tarifa EXCLUSIVA: fuera_de_horario reemplaza el bono de distancia ────────
// $0.50 viaje <17km | $1.00 viaje ≥17km | $3.00 viaje fuera de horario (flat)
// Un viaje fuera de horario siempre vale $3 sin importar la distancia
function calcTarifa(tipo, dist, fuera, cfg) {
  if (fuera) return cfg.tarifa_fuera_horario ?? 3.0;
  if (tipo === 'mandado') return cfg.tarifa_mandado ?? 0.5;
  const umbral = cfg.km_umbral_doble ?? 17;
  return n(dist) >= umbral ? (cfg.tarifa_entrega_larga ?? 1.0) : (cfg.tarifa_entrega_normal ?? 0.5);
}

// ── Resumen de bono mensual por driver ───────────────────────────────────────
function bonoDriver(viajes, cfg) {
  const umbral   = cfg.km_umbral_doble ?? 17;
  // fuera_horario es exclusivo: esos viajes NO cuentan en normal/larga/mandados
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

const mesActual = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const fmtMes = m => { if (!m) return ''; const [y, mo] = m.split('-'); return `${MESES[+mo - 1]} ${y}`; };

// ═══════════════════════════════════════════════════════════════════════════════
export default function DeliveryView({ user, show = () => {} }) {
  const [tab, setTab] = useState('pedidos');
  const rol = user?.rol || '';
  const puedeAprobar = ['ejecutivo', 'superadmin', 'admin'].includes(rol);

  return (
    <div style={{ padding: '16px 16px 100px', background: c.bg, minHeight: '100vh' }}>
      {/* TABS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {[['pedidos','📥 Pedidos'],['bonos','💰 Bonos'],['cobertura','🗺️ Cobertura'],['parametros','⚙️ Parámetros']].map(([k, etq]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: tab === k ? c.red : '#222',
            color: tab === k ? '#fff' : c.dim,
          }}>{etq}</button>
        ))}
      </div>

      {tab === 'pedidos'   && <TabPedidos  show={show} />}
      {tab === 'parametros' && <TabParametros show={show} />}
      {tab === 'bonos'     && <TabBonos    user={user} show={show} puedeAprobar={puedeAprobar} />}
      {tab === 'cobertura' && (
        <Suspense fallback={<div style={{ color: c.dim, padding: 20 }}>Cargando mapa…</div>}>
          <TabCobertura show={show} />
        </Suspense>
      )}
    </div>
  );
}

// ── TAB 3: BONOS DEL MES ─────────────────────────────────────────────────────
function TabBonos({ user, show, puedeAprobar }) {
  const [mes, setMes]           = useState(mesActual());
  const [drivers, setDrivers]   = useState([]);
  const [viajes, setViajes]     = useState([]);
  const [config, setConfig]     = useState({});
  const [guardados, setGuardados] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const [emp, vjs, cfg, bon] = await Promise.all([
      // empleados usa nombre_completo (no 'nombre'): alias para el resto del tab
      db.from('empleados').select('id,nombre:nombre_completo,cargo').in('cargo', CARGOS_DRIVER).eq('activo', true),
      db.from('viajes_delivery').select('*').like('fecha', mes + '%'),
      db.from('config_delivery').select('parametro,valor'),
      db.from('bonos_delivery_mensual').select('*, empleados(nombre_completo,cargo)').eq('mes', mes),
    ]);
    setDrivers(emp.data || []);
    setViajes(vjs.data || []);
    setConfig(parseCfg(cfg.data));
    setGuardados(bon.data || []);
    setLoading(false);
  }, [mes]);

  useEffect(() => { cargar(); }, [cargar]);

  // Calcular bonos cliente-side (cálculo correcto aditivo)
  const resumen = useMemo(() => {
    if (!drivers.length || !Object.keys(config).length) return [];
    return drivers
      .map(d => {
        const vjs = viajes.filter(v => v.empleado_id === d.id);
        if (vjs.length === 0 && !guardados.find(g => g.empleado_id === d.id)) return null;
        const calc  = bonoDriver(vjs, config);
        const saved = guardados.find(g => g.empleado_id === d.id);
        return { ...d, viajes: vjs.length, calc, saved };
      })
      .filter(Boolean)
      .sort((a, b) => b.calc.total - a.calc.total);
  }, [drivers, viajes, config, guardados]);

  const totales = useMemo(() => ({
    viajes: resumen.reduce((s, d) => s + d.viajes, 0),
    bono:   resumen.reduce((s, d) => s + d.calc.total, 0),
    drivers: resumen.length,
  }), [resumen]);

  const guardar = async () => {
    if (viajes.length === 0) { show('⚠️ No hay viajes registrados en este mes'); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.rpc('calcular_bonos_delivery_mes', { p_mes: mes });
      if (error) throw error;
      show(`✅ Bonos calculados para ${data} conductor(es)`);
      cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
    setGuardando(false);
  };

  const aprobar = async (empleadoId) => {
    const { error } = await db.from('bonos_delivery_mensual')
      .update({ estado: 'aprobado' })
      .eq('mes', mes).eq('empleado_id', empleadoId);
    if (error) { show('❌ ' + error.message); return; }
    show('✅ Bono aprobado');
    cargar();
  };

  const cfgKeys = [
    ['km_umbral_doble','Umbral km doble','km'],
    ['tarifa_entrega_normal','Tarifa normal','$'],
    ['tarifa_entrega_larga','Tarifa larga','$'],
    ['tarifa_fuera_horario','Fuera de horario','$'],
    ['tarifa_mandado','Mandado','$'],
  ];

  return (
    <div>
      {/* Selector de mes */}
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Período</label>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)}
          style={inp} />
      </div>

      {/* Tarifas configuradas */}
      <div style={card({ marginBottom: 14 })}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.dim, marginBottom: 8 }}>⚙️ TARIFAS CONFIGURADAS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cfgKeys.map(([k, label, unit]) => (
            <div key={k} style={{ background: '#111', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: c.dim }}>{label}: </span>
              <span style={{ color: c.yellow, fontWeight: 700 }}>
                {unit === '$' ? `$${(config[k] ?? '-')}` : `${config[k] ?? '-'} km`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 32, color: c.dim }}>Cargando...</div>}

      {!loading && resumen.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: c.dim }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
          <div style={{ marginBottom: 4 }}>Sin viajes en {fmtMes(mes)}</div>
          <div style={{ fontSize: 12 }}>Registra viajes en la pestaña 🚗 para calcular bonos</div>
        </div>
      )}

      {/* KPIs resumen */}
      {!loading && resumen.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={kpi(c.green)}><div style={{ fontSize: 10, color: c.dim }}>BONO TOTAL</div><div style={{ fontSize: 20, fontWeight: 700, color: c.green }}>${totales.bono.toFixed(2)}</div></div>
            <div style={kpi(c.blue)}><div style={{ fontSize: 10, color: c.dim }}>VIAJES</div><div style={{ fontSize: 20, fontWeight: 700, color: c.blue }}>{totales.viajes}</div></div>
            <div style={kpi(c.purple)}><div style={{ fontSize: 10, color: c.dim }}>DRIVERS</div><div style={{ fontSize: 20, fontWeight: 700, color: c.purple }}>{totales.drivers}</div></div>
          </div>

          {/* Tabla por driver */}
          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid #444` }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', color: c.dim, fontWeight: 600 }}>Conductor</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>Nrm</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>Lrg</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>F.Hr</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>Mnd</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', color: c.green }}>Bono</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', color: c.dim }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map(d => {
                  const estado = d.saved?.estado;
                  const estadoColor = { aprobado: c.green, calculado: c.yellow }[estado] || c.dim;
                  return (
                    <tr key={d.id} style={{ borderBottom: `1px solid #333`, cursor: 'pointer' }}
                      onClick={() => setExpandido(expandido === d.id ? null : d.id)}>
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: c.text }}>
                        {d.nombre}
                        <div style={{ fontSize: 10, color: c.dim, fontWeight: 400 }}>{d.cargo}</div>
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>{d.calc.normal}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>{d.calc.larga}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>{d.calc.fuera}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>{d.calc.mandados}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: c.green }}>${d.calc.total.toFixed(2)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, color: estadoColor }}>
                        {estado ? estado.toUpperCase() : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `2px solid #555`, background: '#161616' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 700, color: '#fff' }}>TOTAL</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>{resumen.reduce((s,d)=>s+d.calc.normal,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>{resumen.reduce((s,d)=>s+d.calc.larga,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>{resumen.reduce((s,d)=>s+d.calc.fuera,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>{resumen.reduce((s,d)=>s+d.calc.mandados,0)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: c.green, fontSize: 14 }}>${totales.bono.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Panel expandido por driver */}
          {expandido && (() => {
            const d = resumen.find(x => x.id === expandido);
            if (!d) return null;
            return (
              <div style={card({ borderLeft: `3px solid ${c.green}`, marginBottom: 14 })}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{d.nombre}</div>
                <div style={{ fontSize: 12, color: c.dim, marginBottom: 10 }}>{d.viajes} viajes en {fmtMes(mes)}</div>
                {[
                  ['Entregas normales', d.calc.normal, config.tarifa_entrega_normal, c.blue],
                  ['Entregas largas', d.calc.larga, config.tarifa_entrega_larga, c.yellow],
                  ['Fuera de horario', d.calc.fuera, config.tarifa_fuera_horario, c.orange],
                  ['Mandados', d.calc.mandados, config.tarifa_mandado, c.dim],
                ].map(([lbl2, qty, tarifa, color]) => qty > 0 && (
                  <div key={lbl2} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #333', fontSize: 13 }}>
                    <span style={{ color }}>{lbl2}: <strong>{qty}</strong></span>
                    <span style={{ color: c.green }}>× ${(tarifa ?? 0).toFixed(2)} = ${(qty * (tarifa ?? 0)).toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                  <span style={{ color: c.text }}>BONO TOTAL</span>
                  <span style={{ color: c.green }}>${d.calc.total.toFixed(2)}</span>
                </div>
                {puedeAprobar && d.saved && d.saved.estado !== 'aprobado' && (
                  <button onClick={() => aprobar(d.id)} style={{ ...btn(c.green), width: '100%', marginTop: 8 }}>
                    ✅ Aprobar Bono
                  </button>
                )}
                {d.saved?.estado === 'aprobado' && (
                  <div style={{ textAlign: 'center', padding: 8, color: c.green, fontSize: 13, fontWeight: 600 }}>✅ BONO APROBADO</div>
                )}
              </div>
            );
          })()}

          {/* Botón guardar */}
          {puedeAprobar && (
            <button onClick={guardar} disabled={guardando || viajes.length === 0}
              style={{ ...btn(guardando ? '#333' : c.yellow, guardando ? c.dim : '#000'), width: '100%' }}>
              {guardando ? 'Calculando...' : `💾 Calcular y Guardar Bonos — ${fmtMes(mes)}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
