// ────────────────────────────────────────────────────────────────────
// Horarios semanales (16-nov-2026, Cesar) — reemplaza la versión por tramos
// (abandonada desde oct). Planilla libre: cada persona × cada día con
// entrada/salida, almuerzo, horas extra y tipo de día (libre, vacación,
// incapacidad, permiso, falta).
//  · Encargado: arma la semana, ve costo vs ventas (meta 12–13%), asuetos,
//    alertas de descanso, el asistente de ventas, y la envía antes del jueves.
//  · Cesar / RRHH: resumen de todas las sucursales, aprueban o devuelven, y
//    aprueban/rechazan horas extra una por una (comparadas con la marcación).
// Todo pasa por RPCs `horario_*` que validan el PIN y la sucursal.
// ────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';

const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e', red: '#e63946', green: '#4ade80',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#8a8a8a',
};
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const TIPOS = {
  trabaja:     { t: 'Trabaja',     col: c.text },
  libre:       { t: 'Libre',       col: '#777', bg: 'transparent' },
  vacacion:    { t: 'Vacación',    col: '#93c5fd', bg: '#0f2236' },
  incapacidad: { t: 'Incapacidad', col: '#fca5a5', bg: '#2a1414' },
  permiso:     { t: 'Permiso',     col: '#d4d4d8', bg: '#222' },
  falta:       { t: 'Falta',       col: '#fca5a5', bg: '#2a1414' },
};
const EST = {
  borrador:     { t: 'Borrador · entregar antes del jueves', col: c.yellow, bg: '#2a2410' },
  enviado:      { t: 'Enviado · esperando aprobación', col: c.blue, bg: '#0f2236' },
  aprobado:     { t: 'Aprobado', col: c.green, bg: '#0d2b18' },
  rechazado:    { t: 'Devuelto para corregir', col: '#fca5a5', bg: '#2a1414' },
  sin_entregar: { t: 'Sin entregar', col: '#fca5a5', bg: '#2a1414' },
};
// Aprueban RRHH, ejecutivos (Cesar) y superadmin. El rol «admin» no aprueba:
// Jazmín Fuentes (admin) es encargada de Cafetalón (horarios_editores).
const APRUEBAN = ['rrhh', 'ejecutivo', 'superadmin'];

const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const lunes = (d) => { const x = new Date(d); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); x.setHours(12, 0, 0, 0); return x; };
const masDias = (s, n) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + n); return iso(x); };
const mins = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const f12 = (t) => { if (!t) return ''; let [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
// Almuerzo con hora fija (17-nov-2026): fin = inicio + minutos; sugerencia = mitad del turno, redondeada a media hora
const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const finAlm = (ini, min) => hhmm(mins(ini) + Number(min || 0));
const sugAlm = (ent, sal, min) => { const a = mins(ent); let b = mins(sal); if (a == null || b == null) return '13:00'; if (b <= a) b += 1440;
  return hhmm(Math.round((a + (b - a - Number(min || 0)) / 2) / 30) * 30); };
const enAlmuerzo = (t, m) => { if (!t?.almuerzo_min || !t.almuerzo_inicio) return false; const a = mins(t.hora_entrada); let l = mins(t.almuerzo_inicio);
  if (l < a) l += 1440; let x = m; if (x < a) x += 1440; return x >= l && x < l + Number(t.almuerzo_min); };
const fh = (n) => { const r = Math.round((Number(n) || 0) * 2) / 2; return `${r % 1 ? r.toFixed(1) : r}h`; };
const fmt = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const horasDe = (t) => {
  if (!t || t.tipo !== 'trabaja' || !t.hora_entrada || !t.hora_salida) return 0;
  let a = mins(t.hora_entrada), b = mins(t.hora_salida); if (b <= a) b += 1440;
  return Math.max(0, (b - a - (t.almuerzo_min || 0)) / 60);
};
const fechaCorta = (s) => { const d = new Date(s + 'T12:00:00'); return `${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()}`; };

const btn = (bg, extra = {}) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', ...extra });
const chip = (on) => ({ background: on ? '#3b1a1d' : '#222', color: on ? '#fecaca' : '#ccc', border: `1px solid ${on ? c.red : '#333'}`,
  borderRadius: 8, padding: '6px 10px', fontSize: 12.5, cursor: 'pointer', margin: '0 6px 6px 0' });

export default function HorariosView({ user }) {
  const aprueba = APRUEBAN.includes(user?.rol);
  const [tab, setTab] = useState(aprueba ? 'resumen' : 'planilla');
  const [store, setStore] = useState(!aprueba && user?.store_code && STORES[user.store_code] ? user.store_code : 'M001');
  const [semana, setSemana] = useState(() => iso(lunes(new Date(Date.now() + 7 * 864e5))));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [sel, setSel] = useState(null);          // { uid, fecha }
  const [diaAsist, setDiaAsist] = useState(4);   // viernes por defecto
  const [ocultos, setOcultos] = useState({});    // por confirmar descartados

  // La sesión no guarda el PIN: las RPC identifican al usuario por su id
  // (mismo criterio que el resto del ERP). El parámetro se llama p_pin por
  // compatibilidad y acepta id o PIN.
  const pin = String(user?.id || '');

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    const { data, error: e } = await db.rpc('horario_cargar', { p_pin: pin, p_store: store, p_semana: semana });
    if (e) setError(e.message || 'No se pudo cargar'); else setD(data);
    setCargando(false);
  }, [pin, store, semana]);
  useEffect(() => { if (tab === 'planilla') cargar(); }, [tab, cargar]);

  const fechas = useMemo(() => [...Array(7)].map((_, i) => masDias(semana, i)), [semana]);
  const turno = useCallback((uid, f) => (d?.turnos || []).find(t => t.usuario_id === uid && t.fecha === f), [d]);
  const feriado = (f) => (d?.feriados || []).find(x => x.fecha === f);
  const estado = d?.semana?.estado || 'borrador';

  const guardar = async (uid, fecha, datos) => {
    const { error: e } = await db.rpc('horario_guardar_dia', { p_pin: pin, p_store: store, p_usuario: uid, p_fecha: fecha, p_d: datos });
    if (e) { setError(e.message); return e.message || 'No se pudo guardar'; }
    await cargar(); return true;
  };
  const accion = async (fn, args, ok) => {
    setError('');
    const { error: e } = await db.rpc(fn, { p_pin: pin, ...args });
    if (e) setError(e.message); else { if (ok) ok(); await cargar(); }
  };

  // ── Alertas: asuetos, sin día libre, descanso corto, días seguidos ──
  const alertas = useMemo(() => {
    if (!d) return [];
    const out = [];
    (d.feriados || []).forEach(f => {
      const n = (d.personas || []).filter(p => turno(p.id, f.fecha)?.tipo === 'trabaja').length;
      out.push({ t: 'pro', m: `${fechaCorta(f.fecha)} es asueto (${f.nombre})`, s: `${n} persona${n === 1 ? '' : 's'} trabaja${n === 1 ? '' : 'n'} ese día: llevan recargo de $${d.costo?.valor_asueto_dia ?? 15} y ya está sumado al costo.` });
    });
    (d.personas || []).forEach(p => {
      const ts = fechas.map(f => turno(p.id, f));
      if (ts.every(t => !t)) return;
      if (!ts.some(t => !t || t.tipo !== 'trabaja')) out.push({ t: 'danger', m: `${p.nombre} no tiene día libre`, s: 'Necesita un día de descanso en la semana. Si trabaja su día libre, va con recargo.' });
      const sinHora = fechas.filter((f, i) => ts[i]?.tipo === 'trabaja' && ts[i].almuerzo_min > 0 && !ts[i].almuerzo_inicio).map(fechaCorta);
      if (sinHora.length) out.push({ t: 'warning', m: `${p.nombre}: falta la hora del almuerzo (${sinHora.join(', ')})`, s: 'Tocá la casilla y poné a qué hora sale a almorzar, para que cada quien sepa y se organice.' });
      let seg = 0, max = 0; ts.forEach(t => { if (t?.tipo === 'trabaja') { seg++; max = Math.max(max, seg); } else seg = 0; });
      for (let i = 0; i < 6; i++) {
        const a = ts[i], b = ts[i + 1];
        if (a?.tipo === 'trabaja' && b?.tipo === 'trabaja' && a.hora_salida && b.hora_entrada) {
          let fin = mins(a.hora_salida); if (fin <= mins(a.hora_entrada)) fin += 1440;
          const gap = (1440 + mins(b.hora_entrada) - fin) / 60;
          if (gap < 11) out.push({ t: 'warning', m: `${p.nombre}: sale ${DIAS[i]} a las ${f12(a.hora_salida)} y entra ${DIAS[i + 1]} a las ${f12(b.hora_entrada)}`, s: `Solo ${fh(gap)} de descanso. Lo recomendado son 11 h o más.` });
        }
      }
    });
    return out;
  }, [d, fechas, turno]);

  // ── Asistente: gente por hora vs pedidos promedio de ese día ──
  const asistente = useMemo(() => {
    if (!d) return null;
    const dw = diaAsist + 1, f = fechas[diaAsist];
    const ped = d.pedidos_hora?.[dw] || {};
    const horas = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const gente = horas.map(h => (d.personas || []).filter(p => {
      const t = turno(p.id, f); if (!t || t.tipo !== 'trabaja' || !t.hora_entrada) return false;
      let a = mins(t.hora_entrada), b = mins(t.hora_salida); if (b <= a) b += 1440;
      // quien está almorzando a esa hora no cuenta como gente en el piso
      return h * 60 + 30 >= a && h * 60 + 30 < b && !enAlmuerzo(t, h * 60 + 30);
    }).length);
    // Repartir LA MISMA gente que puso el encargado según la forma de la venta
    // de ese día: no dice cuánta gente contratar (eso lo cuida el costo vs la
    // meta), sino a qué hora sobra o falta. Mínimo 2 por hora abierta.
    const totPed = horas.reduce((s, h) => s + Number(ped[h] || 0), 0);
    const totGente = gente.reduce((s, g) => s + g, 0);
    // Mitad pareja + mitad según la venta: la gente no se puede mover 100% a los
    // picos (hay que abrir, limpiar, preparar), así que la sugerencia es moderada.
    const abiertas = horas.filter(h => Number(ped[h] || 0) > 0).length || 1;
    const rec = horas.map(h => { const v = Number(ped[h] || 0);
      return v && totPed ? Math.max(2, Math.round(totGente / abiertas * 0.5 + totGente * v / totPed * 0.5)) : 0; });
    const sug = []; let i = 0;
    const lejos = (k) => rec[k] && Math.abs(gente[k] - rec[k]) >= 2;
    while (i < horas.length) {
      const df = gente[i] - rec[i];
      if (!lejos(i)) { i++; continue; }
      let j = i; while (j + 1 < horas.length && lejos(j + 1) && Math.sign(gente[j + 1] - rec[j + 1]) === Math.sign(df)) j++;
      const pk = Math.max(...horas.slice(i, j + 1).map(h => Number(ped[h] || 0)));
      const mx = Math.max(...horas.slice(i, j + 1).map((_, k) => Math.abs(gente[i + k] - rec[i + k])));
      sug.push(df < 0
        ? { t: 'danger', m: `De ${f12(horas[i] + ':00')} a ${f12((horas[j] + 1) + ':00')} te faltan ${mx}`, s: `Es de las horas con más pedidos del día: mové a alguien de una hora tranquila o adelantá una entrada.` }
        : { t: 'warning', m: `De ${f12(horas[i] + ':00')} a ${f12((horas[j] + 1) + ':00')} te sobra${mx > 1 ? 'n' : ''} ${mx}`, s: `Hora tranquila: buen momento para almuerzos, o para que alguien entre más tarde.` });
      i = j + 1;
    }
    return { horas, ped, gente, rec, sug, maxPed: Math.max(1, ...horas.map(h => Number(ped[h] || 0))) };
  }, [d, diaAsist, fechas, turno]);

  if (tab === 'resumen' && aprueba) {
    return <Resumen pin={pin} semana={semana} setSemana={setSemana} irA={(sc) => { setStore(sc); setTab('planilla'); }} />;
  }

  const costo = d?.costo || {};
  const pct = costo.ventas_proyectadas > 0 ? costo.costo / costo.ventas_proyectadas * 100 : 0;
  const colPct = pct > (costo.meta_pct || 13) ? '#E24B4A' : pct > (costo.meta_verde_pct || 12) ? '#EF9F27' : '#639922';

  return (
    <div style={{ padding: '16px 16px 100px', background: c.bg, minHeight: '100vh', color: c.text }}>
      {aprueba && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button onClick={() => setTab('resumen')} style={btn('#222', { color: c.dim })}>Resumen de sucursales</button>
          <button style={btn(c.red)}>Planilla de {STORES[store]}</button>
        </div>
      )}

      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {aprueba ? (
          <select value={store} onChange={e => setStore(e.target.value)}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700 }}>
            {Object.entries(STORES).filter(([k]) => !['EVT01', 'CM001'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : <span style={{ fontSize: 17, fontWeight: 800 }}>{STORES[store] || store}</span>}
        <button onClick={() => setSemana(masDias(semana, -7))} style={btn('#222')}>‹</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Semana {fechaCorta(semana)} – {fechaCorta(masDias(semana, 6))}</span>
        <button onClick={() => setSemana(masDias(semana, 7))} style={btn('#222')}>›</button>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 7, background: EST[estado].bg, color: EST[estado].col }}>{EST[estado].t}</span>
        <span style={{ flex: 1 }} />
        {d?.hay_semana_anterior && (
          <button onClick={() => accion('horario_copiar_anterior', { p_store: store, p_semana: semana })} style={btn('#222')}>Copiar semana anterior</button>
        )}
      </div>
      {d?.semana?.comentario && estado === 'rechazado' && (
        <div style={{ background: '#2a1414', border: `1px solid ${c.red}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
          Te lo devolvieron: <b>{d.semana.comentario}</b>
        </div>
      )}
      {error && <div style={{ background: '#2a1414', color: '#fca5a5', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>{error}</div>}
      {cargando && !d && <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>}

      {d && (
        <>
          {/* Costo vs ventas */}
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, fontSize: 13 }}>
              <span>Costo estimado de planilla: <b>{fmt(costo.costo)}</b> <span style={{ color: c.dim }}>({costo.personas || 0} personas · {fh(costo.horas)} · extra {fh(costo.extras)})</span></span>
              <span>Ventas proyectadas: <b>{fmt(costo.ventas_proyectadas)}</b></span>
              <b style={{ color: colPct }}>{pct.toFixed(1)}% de las ventas{pct > (costo.meta_pct || 13) ? ' · pasa la meta' : ''}</b>
            </div>
            <div style={{ position: 'relative', height: 9, background: '#222', borderRadius: 5, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, pct / 20 * 100)}%`, height: '100%', background: colPct }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(costo.meta_pct || 13) / 20 * 100}%`, width: 2, background: '#fff' }} />
            </div>
            <div style={{ fontSize: 10.5, color: c.dim, marginTop: 3 }}>Meta {costo.meta_verde_pct}–{costo.meta_pct}% · sueldo semanal de quien trabaja + extras a ${costo.valor_hora_extra}/h + asuetos a ${costo.valor_asueto_dia}/día</div>
          </div>

          {/* Planilla */}
          <div style={{ overflowX: 'auto', background: c.card, border: `1px solid ${c.border}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 820 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: c.dim, fontWeight: 600, width: 130 }}>Persona</th>
                {fechas.map((f, i) => (
                  <th key={f} style={{ padding: '8px 4px', color: feriado(f) ? c.purple : c.dim, fontWeight: 600 }}>
                    {DIAS[i]} {Number(f.slice(8))}{feriado(f) && <div style={{ fontSize: 9.5, color: c.purple }}>Asueto</div>}
                  </th>
                ))}
                <th style={{ color: c.dim, fontWeight: 600, width: 56 }}>Horas</th>
                <th style={{ color: c.dim, fontWeight: 600, width: 52 }}>Extra</th>
              </tr></thead>
              <tbody>
                {(d.personas || []).map(p => {
                  let tot = 0, ext = 0;
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${c.border}` }}>
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                        <div style={{ fontSize: 10.5, color: c.dim }}>{p.rol}{p.prestado ? ' · prestado' : ''}</div>
                      </td>
                      {fechas.map(f => {
                        const t = turno(p.id, f); tot += horasDe(t); ext += Number(t?.horas_extra || 0);
                        const tp = t ? TIPOS[t.tipo] : null; const on = sel?.uid === p.id && sel?.fecha === f;
                        return (
                          <td key={f} style={{ padding: 3 }}>
                            <div onClick={() => setSel({ uid: p.id, fecha: f })}
                              style={{ cursor: 'pointer', borderRadius: 7, minHeight: 40, padding: '4px 2px', textAlign: 'center',
                                       border: on ? `1.5px solid ${c.blue}` : `1px solid ${c.border}`, background: tp?.bg ?? '#141414', lineHeight: 1.3 }}>
                              {!t ? <span style={{ color: '#444' }}>+</span>
                                : t.tipo === 'trabaja' ? (
                                  <>
                                    <div>{f12(t.hora_entrada)}–{f12(t.hora_salida)}</div>
                                    <div style={{ fontSize: 9.5, color: t.almuerzo_min && !t.almuerzo_inicio ? c.yellow : c.dim }}>
                                      {!t.almuerzo_min ? 'sin alm' : t.almuerzo_inicio ? `alm ${f12(t.almuerzo_inicio)}–${f12(finAlm(t.almuerzo_inicio, t.almuerzo_min))}` : `alm ${t.almuerzo_min}′ · ¿hora?`}
                                    </div>
                                    {Number(t.horas_extra) > 0 && (
                                      <div style={{ fontSize: 9.5, fontWeight: 800, color: t.extra_estado === 'rechazada' ? '#fca5a5' : c.yellow }}>
                                        +{fh(t.horas_extra)}{t.extra_estado === 'aprobada' ? ' ✓' : t.extra_estado === 'rechazada' ? ' ✕' : ''}
                                      </div>
                                    )}
                                  </>
                                ) : <span style={{ color: tp.col }}>{tp.t}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center', fontWeight: 800 }}>{fh(tot)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: ext ? c.yellow : '#555' }}>{ext ? `+${fh(ext)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sel && <Editor key={`${sel.uid}-${sel.fecha}`} persona={(d.personas || []).find(p => p.id === sel.uid)} fecha={sel.fecha}
                          t={turno(sel.uid, sel.fecha)} asueto={feriado(sel.fecha)}
                          onCerrar={() => setSel(null)} onGuardar={(datos) => guardar(sel.uid, sel.fecha, datos)} />}

          {/* Alertas */}
          {alertas.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {alertas.map((a, i) => <Aviso key={i} {...a} />)}
            </div>
          )}

          {/* Asistente de ventas */}
          {asistente && (
            <div style={{ background: c.card, border: `1px solid #1e4a66`, borderRadius: 12, padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>✨ Asistente según tus ventas</b>
                <span style={{ fontSize: 11.5, color: c.dim }}>pedidos promedio de las últimas 6 semanas</span>
                <span style={{ flex: 1 }} />
                {DIAS.map((x, i) => <button key={x} onClick={() => setDiaAsist(i)} style={chip(diaAsist === i)}>{x}</button>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, padding: '0 2px' }}>
                {asistente.horas.map((h, i) => {
                  const v = Number(asistente.ped[h] || 0);
                  return (
                    <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: c.dim }}>
                      <div style={{ fontWeight: 800, color: asistente.gente[i] < asistente.rec[i] ? '#fca5a5' : asistente.gente[i] > asistente.rec[i] && asistente.rec[i] ? c.yellow : c.green }}>
                        {asistente.gente[i]}/{asistente.rec[i] || '–'}
                      </div>
                      <div style={{ height: Math.max(3, v / asistente.maxPed * 70), background: '#3a3a44', borderRadius: 4, margin: '3px 2px' }} title={`${v} pedidos/h`} />
                      {f12(h + ':00')}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 10.5, color: c.dim, margin: '6px 0' }}>Arriba: personas en tu horario / cómo quedarían repartidas según la venta de ese día. Barras: pedidos por hora.</div>
              {asistente.sug.length === 0
                ? <Aviso t="success" m="Este día va de acuerdo a las ventas" s="No hay horas con gente de más ni de menos." />
                : asistente.sug.map((a, i) => <Aviso key={i} {...a} />)}
            </div>
          )}

          {/* Semana pasada: posibles extras */}
          {(d.por_confirmar || []).filter(x => !ocultos[x.turno_id]).length > 0 && (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
              <b style={{ fontSize: 14 }}>Semana pasada · ¿fue hora extra?</b>
              {(d.por_confirmar || []).filter(x => !ocultos[x.turno_id]).map(x => {
                const p = (d.personas || []).find(y => y.id === x.usuario_id);
                const h = Math.max(0.5, Math.round(x.minutos / 30) / 2);
                return (
                  <div key={x.turno_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${c.border}`, flexWrap: 'wrap', fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 220 }}>{p?.nombre || 'Persona'} · {fechaCorta(x.fecha)}: salía {f12(x.programada)} y marcó {f12(x.marco)} (+{x.minutos} min)</span>
                    <button onClick={() => guardar(x.usuario_id, x.fecha, { tipo: 'solo_extra', horas_extra: h, extra_motivo: 'Marcó salida tarde' })}
                            style={btn('#14532d')}>Anotar +{fh(h)}</button>
                    <button onClick={() => setOcultos(o => ({ ...o, [x.turno_id]: true }))} style={btn('#222')}>No fue extra</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            {aprueba && estado !== 'aprobado' && (d.turnos || []).length > 0 && (
              <>
                <button onClick={() => { const m = window.prompt('¿Qué tiene que corregir el encargado?'); if (m != null) accion('horario_revisar', { p_store: store, p_semana: semana, p_aprobar: false, p_comentario: m }); }}
                        style={btn('#3a1a1a')}>Devolver</button>
                <button onClick={() => accion('horario_revisar', { p_store: store, p_semana: semana, p_aprobar: true, p_comentario: null })} style={btn('#16a34a')}>Aprobar semana</button>
              </>
            )}
            {!aprueba && ['borrador', 'rechazado'].includes(estado) && (d.turnos || []).length > 0 && (
              <button onClick={() => accion('horario_enviar', { p_store: store, p_semana: semana })} style={btn(c.red, { padding: '10px 18px', fontSize: 14 })}>Enviar a aprobación</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Aviso({ t, m, s }) {
  const col = { danger: ['#2a1414', '#fca5a5'], warning: ['#2a2410', '#fde68a'], success: ['#0d2b18', '#86efac'], pro: ['#1e1633', '#c4b5fd'] }[t] || ['#222', '#ddd'];
  return (
    <div style={{ background: col[0], color: col[1], borderRadius: 9, padding: '8px 11px', marginBottom: 6, fontSize: 12.5 }}>
      <b>{m}</b>{s && <div style={{ opacity: .9 }}>{s}</div>}
    </div>
  );
}

function Editor({ persona, fecha, t, asueto, onCerrar, onGuardar }) {
  const [tipo, setTipo] = useState(t?.tipo || 'trabaja');
  const [ent, setEnt] = useState(t?.hora_entrada?.slice(0, 5) || '10:00');
  const [sal, setSal] = useState(t?.hora_salida?.slice(0, 5) || '18:30');
  const [alm, setAlm] = useState(t?.almuerzo_min ?? 30);
  // Hora del almuerzo: si nunca se tocó, se sugiere a la mitad del turno y se mueve con la entrada/salida
  const [almIniTocado, setAlmIniTocado] = useState(t?.almuerzo_inicio?.slice(0, 5) || null);
  const almIni = almIniTocado || sugAlm(ent, sal, alm);
  const [ext, setExt] = useState(Number(t?.horas_extra || 0));
  const [mot, setMot] = useState(t?.extra_motivo || '');
  const [nota, setNota] = useState(t?.nota || '');
  const [err, setErr] = useState('');
  const [guardando, setGuardando] = useState(false);
  const h = horasDe({ tipo, hora_entrada: ent, hora_salida: sal, almuerzo_min: alm });

  const ok = async () => {
    if (tipo === 'trabaja' && (!ent || !sal)) { setErr('Poné la hora de entrada y de salida'); return; }
    if (tipo === 'trabaja' && ent === sal) { setErr('La salida tiene que ser distinta a la entrada'); return; }
    if (ext < 0 || ext > 16) { setErr('Las horas extra van de 0 a 16'); return; }
    if (tipo === 'trabaja' && alm > 0) {
      const a = mins(ent); let b = mins(sal); if (b <= a) b += 1440; let l = mins(almIni); if (l < a) l += 1440;
      if (!almIni) { setErr('Poné a qué hora sale a almorzar'); return; }
      if (l + alm > b) { setErr('El almuerzo tiene que quedar dentro del turno (entre la entrada y la salida)'); return; }
    }
    setGuardando(true); setErr('');
    const r = await onGuardar({ tipo, hora_entrada: ent, hora_salida: sal, almuerzo_min: alm, almuerzo_inicio: alm > 0 ? almIni : null, horas_extra: tipo === 'trabaja' ? ext : 0, extra_motivo: mot, nota });
    setGuardando(false); if (r === true) onCerrar(); else setErr(String(r));
  };

  const inp = { background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '6px 8px', fontSize: 14 };
  return (
    <div style={{ background: '#161616', border: `1px solid ${c.blue}`, borderRadius: 12, padding: 12, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>{persona?.nombre} · {fechaCorta(fecha)}</b>
        {asueto && <span style={{ fontSize: 11, fontWeight: 800, color: c.purple }}>Asueto · {asueto.nombre}</span>}
        <span style={{ flex: 1 }} />
        <button onClick={onCerrar} style={btn('#222')}>Cerrar</button>
      </div>
      <div>{Object.entries(TIPOS).map(([k, v]) => <button key={k} onClick={() => setTipo(k)} style={chip(tipo === k)}>{v.t}</button>)}</div>
      {tipo === 'trabaja' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, margin: '4px 0 8px' }}>
            Entra <input type="time" value={ent} onChange={e => setEnt(e.target.value)} style={inp} />
            Sale <input type="time" value={sal} onChange={e => setSal(e.target.value)} style={inp} />
            <span style={{ color: c.dim }}>= <b style={{ color: c.text }}>{fh(h)}</b> trabajadas</span>
          </div>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 3 }}>Almuerzo</div>
          <div>
            {[0, 30, 45, 60].map(m => <button key={m} onClick={() => setAlm(m)} style={chip(alm === m)}>{m ? `${m} min` : 'Sin almuerzo'}</button>)}
            <input type="number" min="0" max="180" step="5" value={[0, 30, 45, 60].includes(alm) ? '' : alm} placeholder="Otro"
                   onChange={e => setAlm(Math.max(0, Math.min(180, Number(e.target.value) || 0)))} style={{ ...inp, width: 70 }} /> <span style={{ fontSize: 12, color: c.dim }}>min</span>
          </div>
          {alm > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, marginTop: 6 }}>
              Sale a almorzar a las <input type="time" step="900" value={almIni} onChange={e => setAlmIniTocado(e.target.value)} style={inp} />
              <span style={{ color: c.dim }}>→ de <b style={{ color: c.text }}>{f12(almIni)}</b> a <b style={{ color: c.text }}>{f12(finAlm(almIni, alm))}</b></span>
              {!almIniTocado && <span style={{ fontSize: 11, color: c.yellow }}>sugerida: a la mitad del turno</span>}
            </div>
          )}
          <div style={{ fontSize: 12, color: c.dim, margin: '8px 0 3px' }}>Horas extra de este día</div>
          <div>
            {[0, 1, 2, 3].map(n => <button key={n} onClick={() => setExt(n)} style={chip(ext === n)}>{n ? `+${n} h` : 'Sin extra'}</button>)}
            <input type="number" min="0" max="16" step="0.5" value={[0, 1, 2, 3].includes(ext) ? '' : ext} placeholder="1.5"
                   onChange={e => setExt(Math.round((Number(e.target.value) || 0) * 2) / 2)} style={{ ...inp, width: 70 }} /> <span style={{ fontSize: 12, color: c.dim }}>h</span>
          </div>
          {ext > 0 && <input value={mot} onChange={e => setMot(e.target.value)} placeholder="Motivo (opcional): faltó alguien, se llenó el local"
                             style={{ ...inp, width: '100%', marginTop: 6, fontSize: 13 }} />}
        </>
      )}
      {['vacacion', 'incapacidad', 'permiso', 'falta'].includes(tipo) && (
        <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional): constancia del ISSS, motivo del permiso"
               style={{ ...inp, width: '100%', marginTop: 4, fontSize: 13 }} />
      )}
      {err && <div style={{ color: '#fca5a5', fontSize: 12.5, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button disabled={guardando} onClick={ok} style={btn('#2563eb')}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        {t && <button onClick={async () => { setGuardando(true); const l = await onGuardar({ tipo: 'borrar' }); setGuardando(false); if (l === true) onCerrar(); else setErr(String(l)); }} style={btn('#222')}>Vaciar casilla</button>}
      </div>
    </div>
  );
}

function Resumen({ pin, semana, setSemana, irA }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState({});
  const cargar = useCallback(async () => {
    const { data, error: e } = await db.rpc('horario_resumen', { p_pin: pin, p_semana: semana });
    if (e) setError(e.message); else setR(data);
  }, [pin, semana]);
  useEffect(() => { cargar(); }, [cargar]);

  const extra = async (id, ap) => {
    const { error: e } = await db.rpc('horario_extra_revisar', { p_pin: pin, p_turno: id, p_aprobar: ap });
    if (e) setError(e.message); else setHecho(h => ({ ...h, [id]: ap ? 'Aprobada · va a planilla' : 'Rechazada · no se paga' }));
  };

  const sucs = r?.sucursales || [];
  // % solo de las sucursales que ya tienen horario (si no, las vacías bajan el promedio)
  const tot = sucs.filter(s => Number(s.costo?.costo || 0) > 0)
    .reduce((a, s) => ({ costo: a.costo + Number(s.costo?.costo || 0), vta: a.vta + Number(s.costo?.ventas_proyectadas || 0), ext: a.ext + Number(s.costo?.extras || 0) }), { costo: 0, vta: 0, ext: 0 });

  return (
    <div style={{ padding: '16px 16px 100px', background: c.bg, minHeight: '100vh', color: c.text }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button style={btn(c.red)}>Resumen de sucursales</button>
        <button onClick={() => irA(sucs[0]?.store_code || 'M001')} style={btn('#222', { color: c.dim })}>Ver planillas</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setSemana(masDias(semana, -7))} style={btn('#222')}>‹</button>
        <b style={{ fontSize: 15 }}>Horarios · semana {fechaCorta(semana)} – {fechaCorta(masDias(semana, 6))}</b>
        <button onClick={() => setSemana(masDias(semana, 7))} style={btn('#222')}>›</button>
      </div>
      {error && <div style={{ background: '#2a1414', color: '#fca5a5', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[['Por aprobar', sucs.filter(s => s.estado === 'enviado').length, c.blue],
          ['Sin entregar', sucs.filter(s => ['sin_entregar', 'borrador'].includes(s.estado)).length, '#fca5a5'],
          ['Horas extra pedidas', fh(tot.ext), c.yellow],
          ['Planilla vs ventas', tot.vta ? `${(tot.costo / tot.vta * 100).toFixed(1)}%` : '—', c.text]].map(([l, v, col]) => (
          <div key={l} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11.5, color: c.dim }}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: col }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
        {sucs.map(s => {
          const e = EST[s.estado] || EST.sin_entregar; const k = s.costo || {};
          const p = k.ventas_proyectadas > 0 ? k.costo / k.ventas_proyectadas * 100 : 0;
          return (
            <div key={s.store_code} onClick={() => irA(s.store_code)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: `1px solid ${c.border}`, cursor: 'pointer', flexWrap: 'wrap' }}>
              <b style={{ minWidth: 170 }}>{s.nombre}</b>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: e.bg, color: e.col }}>{s.estado === 'borrador' ? 'Sin entregar' : e.t.split(' ·')[0]}</span>
              <span style={{ fontSize: 12.5, color: c.dim }}>{fh(k.horas)} · extra <b style={{ color: c.yellow }}>{fh(k.extras)}</b></span>
              <span style={{ flex: 1 }} />
              <b style={{ color: p > (k.meta_pct || 13) ? '#E24B4A' : p > (k.meta_verde_pct || 12) ? '#EF9F27' : '#86efac' }}>{p ? `${p.toFixed(1)}%` : '—'}</b>
              <span style={{ fontSize: 12, color: c.dim }}>Abrir ›</span>
            </div>
          );
        })}
      </div>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
        <b style={{ fontSize: 14 }}>Horas extra por revisar</b>
        <div style={{ fontSize: 11.5, color: c.dim, marginBottom: 6 }}>Comparadas con la marcación de salida. Solo lo aprobado se paga.</div>
        {(r?.extras || []).length === 0 && <div style={{ color: c.dim, fontSize: 13, padding: '6px 0' }}>No hay extras pendientes.</div>}
        {(r?.extras || []).map(x => {
          const cuadra = x.salida_marcada && x.salida_programada && x.salida_marcada >= String(x.salida_programada).slice(0, 5);
          return (
            <div key={x.turno_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${c.border}`, flexWrap: 'wrap', fontSize: 13 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <b>{x.persona}</b> · {STORES[x.store_code] || x.store_code} · {fechaCorta(x.fecha)} <b style={{ color: c.yellow }}>+{fh(x.horas)}</b>
                <div style={{ fontSize: 12, color: c.dim }}>
                  {x.motivo || 'Sin motivo'} · <span style={{ color: !x.salida_marcada ? c.dim : cuadra ? '#86efac' : '#fca5a5' }}>
                    {x.salida_marcada ? `marcó salida ${f12(x.salida_marcada)} (programada ${f12(x.salida_programada)})` : 'sin marcación de salida'}
                  </span>
                </div>
              </div>
              {hecho[x.turno_id] ? <span style={{ fontSize: 12, color: c.green }}>{hecho[x.turno_id]}</span> : (
                <>
                  <button onClick={() => extra(x.turno_id, true)} style={btn('#16a34a')}>Aprobar</button>
                  <button onClick={() => extra(x.turno_id, false)} style={btn('#3a1a1a')}>Rechazar</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
