import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { n, fmtDate } from '../../config';
import { useToast } from '../../hooks/useToast';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', blue: '#60a5fa', purple: '#a855f7',
  orange: '#fb923c', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555',
};

const TIPOS = {
  falta:         { label: '⏰ Falta / Tardanza',      color: c.yellow },
  comportamiento:{ label: '😤 Comportamiento',         color: c.orange },
  seguridad:     { label: '🦺 Seguridad / Higiene',   color: c.blue   },
  robo:          { label: '💸 Robo / Pérdida',        color: c.red    },
  otro:          { label: '📋 Otro',                  color: c.textDim},
};

const CATEGORIAS = {
  falta:         ['tardanza','falta injustificada','falta justificada','salida anticipada'],
  comportamiento:['insubordinación','agresión','insolencia','actitud negativa','incumplimiento órdenes'],
  seguridad:     ['no uso de uniforme','protocolo higiene','seguridad alimentaria','equipo de protección'],
  robo:          ['quiebre de equipo','dinero faltante','producto','sospecha de robo'],
  otro:          ['otro'],
};

const NIVEL_COLORS = {
  verbal:    c.green,
  escrita:   c.yellow,
  suspension:c.orange,
  despido:   c.red,
};

const NIVEL_LABELS = {
  verbal:    '🗣 Verbal',
  escrita:   '📝 Escrita',
  suspension:'⛔ Suspensión',
  despido:   '🚫 Despido',
};

// ── Lógica progresiva de amonestación ────────────────────────
function sugerirNivel(historialAmonestaciones, tipoIncidente) {
  const ahora = new Date();
  const hace3m = new Date(ahora); hace3m.setMonth(ahora.getMonth() - 3);
  const hace12m = new Date(ahora); hace12m.setFullYear(ahora.getFullYear() - 1);

  const delMismoTipo12m = historialAmonestaciones.filter(a => {
    const fecha = new Date(a.created_at);
    return fecha >= hace12m;
  });

  if (delMismoTipo12m.length === 0) return 'verbal';
  if (delMismoTipo12m.length === 1) return 'escrita';
  if (delMismoTipo12m.length === 2) return 'suspension';
  return 'despido';
}

// ── Genera HTML del acta ──────────────────────────────────────
function generarHTMLActa(incidente, amonestacion, empNombre, empCargo, sucNombre) {
  const tipo = NIVEL_LABELS[amonestacion.tipo] || amonestacion.tipo;
  const tipoInc = TIPOS[incidente.tipo_incidente]?.label || incidente.tipo_incidente;
  const hoy = new Date().toLocaleDateString('es-SV', { day:'2-digit', month:'long', year:'numeric' });
  const isSuspension = amonestacion.tipo === 'suspension';
  const isDespido = amonestacion.tipo === 'despido';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Acta de Amonestación — ${empNombre}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #222; padding: 40px; max-width: 680px; margin: 0 auto; font-size: 13px; line-height: 1.6; }
    .logo { font-size: 20px; font-weight: 900; color: #e63946; letter-spacing: -1px; margin-bottom: 4px; }
    .logo span { color: #222; }
    .header { border-bottom: 3px solid #e63946; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .titulo { font-size: 16px; font-weight: 800; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 24px; color: #333; }
    .seccion { margin-bottom: 20px; }
    .seccion-titulo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #888; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 10px; }
    .row { display: flex; gap: 24px; margin-bottom: 6px; }
    .field { flex: 1; }
    .field label { font-size: 11px; color: #888; display: block; }
    .field span { font-weight: 600; font-size: 13px; }
    .descripcion { background: #f9f9f9; border-left: 3px solid #e63946; padding: 12px 16px; border-radius: 0 6px 6px 0; font-style: italic; color: #444; margin: 10px 0; }
    .advertencia { background: #fff3f3; border: 1px solid #e63946; border-radius: 6px; padding: 12px 16px; margin: 20px 0; font-size: 12px; color: #c0392b; }
    .firmas { display: flex; gap: 40px; margin-top: 48px; }
    .firma-box { flex: 1; text-align: center; }
    .firma-linea { border-top: 1px solid #333; margin-top: 60px; padding-top: 6px; font-size: 12px; }
    .firma-cargo { font-size: 11px; color: #888; margin-top: 2px; }
    .footer { margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px; font-size: 11px; color: #aaa; text-align: center; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-weight: 700; font-size: 12px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">🍔 Freakie<span> Dogs</span></div>
      <div style="font-size:11px;color:#888;">Recursos Humanos</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#666;">
      San Salvador, ${hoy}<br>
      <strong style="color:#e63946;">DOCUMENTO CONFIDENCIAL</strong>
    </div>
  </div>

  <div class="titulo">
    ${isDespido ? 'Carta de Despido' : `Acta de Amonestación ${tipo}`}
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Datos del Empleado</div>
    <div class="row">
      <div class="field"><label>Nombre completo</label><span>${empNombre}</span></div>
      <div class="field"><label>Cargo</label><span>${empCargo || '—'}</span></div>
    </div>
    <div class="row">
      <div class="field"><label>Sucursal</label><span>${sucNombre || '—'}</span></div>
      <div class="field"><label>Fecha del incidente</label><span>${fmtDate(incidente.fecha_incidente)}</span></div>
    </div>
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Descripción del Incidente</div>
    <div class="row">
      <div class="field"><label>Tipo</label><span>${tipoInc}</span></div>
      <div class="field"><label>Categoría</label><span>${incidente.categoria || '—'}</span></div>
    </div>
    <div class="descripcion">${incidente.descripcion}</div>
    ${incidente.testigos?.length ? `<div style="font-size:12px;color:#666;margin-top:8px;">Testigos: ${incidente.testigos.join(', ')}</div>` : ''}
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Resolución Disciplinaria</div>
    <p>En virtud de los hechos descritos, y conforme a la política interna de Freakie Dogs, se determina la siguiente medida disciplinaria:</p>
    <div style="text-align:center;margin:16px 0;">
      <span class="badge" style="background:${NIVEL_COLORS[amonestacion.tipo]};color:#111;font-size:14px;padding:6px 20px;">
        ${tipo.toUpperCase()}
      </span>
    </div>
    ${amonestacion.razon ? `<div class="descripcion">${amonestacion.razon}</div>` : ''}
    ${isSuspension ? `<p style="margin-top:8px;"><strong>Días de suspensión sin goce de sueldo: ${amonestacion.dias_suspension || 1}</strong></p>` : ''}
    ${isDespido ? `<p style="margin-top:8px;color:#c0392b;"><strong>Esta carta constituye notificación oficial de terminación de relación laboral.</strong></p>` : ''}
  </div>

  <div class="advertencia">
    ⚠️ ${isDespido
      ? 'La empresa procederá con el proceso de liquidación conforme a la ley salvadoreña.'
      : 'Se le informa que la acumulación de amonestaciones puede resultar en medidas disciplinarias más severas, incluyendo suspensión o despido.'
    }
  </div>

  <div class="firmas">
    <div class="firma-box">
      <div class="firma-linea">${empNombre}</div>
      <div class="firma-cargo">Empleado(a) — Firma de recibido</div>
    </div>
    <div class="firma-box">
      <div class="firma-linea">Recursos Humanos</div>
      <div class="firma-cargo">Representante RRHH — Freakie Dogs</div>
    </div>
  </div>

  <div class="footer">
    Documento generado el ${new Date().toLocaleDateString('es-SV')} · Freakie Dogs ERP v2 · CONFIDENCIAL
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

// ── Componente principal ──────────────────────────────────────
const FORM_INIT = {
  empleado_id: '', tipo_incidente: 'falta', categoria: '',
  descripcion: '', fecha_incidente: new Date(Date.now()-6*3600*1000).toISOString().split('T')[0],
  testigos: '',
};

const AMON_INIT = { tipo: 'verbal', razon: '', dias_suspension: 1 };

export default function Amonestaciones({ user, onBack }) {
  const { show } = useToast();
  const [screen, setScreen]           = useState(0); // 0=dashboard, 1=historial empleado
  const [empleados, setEmpleados]     = useState([]);
  const [sucursales, setSucursales]   = useState([]);
  const [incidentes, setIncidentes]   = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [empHistorial, setEmpHistorial] = useState({ incidentes: [], amonestaciones: [] });
  const [loading, setLoading]         = useState(true);
  const [loadingHist, setLoadingHist] = useState(false);
  const [guardando, setGuardando]     = useState(false);

  // Modales
  const [modalInc, setModalInc]       = useState(false);
  const [formInc, setFormInc]         = useState(FORM_INIT);
  const [modalAmon, setModalAmon]     = useState(null); // incidente a amonestar
  const [formAmon, setFormAmon]       = useState(AMON_INIT);
  const [nivelSugerido, setNivelSugerido] = useState('verbal');

  const [busqueda, setBusqueda]       = useState('');
  const [filtroTipo, setFiltroTipo]   = useState('todos');

  // ── Carga inicial ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: emps }, { data: sucs }, { data: incs }] = await Promise.all([
        db.from('empleados').select('id, nombre_completo, cargo, sucursal_id').eq('activo', true).order('nombre_completo'),
        db.from('sucursales').select('id, nombre, store_code').order('nombre'),
        db.from('incidentes_disciplinarios')
          .select('*, empleados(nombre_completo, cargo, sucursal_id), amonestaciones(id, tipo, estado)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      setEmpleados(emps || []);
      setSucursales(sucs || []);
      setIncidentes(incs || []);
      setLoading(false);
    })();
  }, []);

  const sucMap = useMemo(() => {
    const m = {};
    sucursales.forEach(s => { m[s.id] = s; });
    return m;
  }, [sucursales]);

  const empMap = useMemo(() => {
    const m = {};
    empleados.forEach(e => { m[e.id] = e; });
    return m;
  }, [empleados]);

  // ── Abrir historial de empleado ──
  const abrirHistorial = useCallback(async (empId) => {
    const emp = empMap[empId];
    if (!emp) return;
    setSelectedEmp(emp);
    setScreen(1);
    setLoadingHist(true);
    const [{ data: incs }, { data: amons }] = await Promise.all([
      db.from('incidentes_disciplinarios')
        .select('*, amonestaciones(*)')
        .eq('empleado_id', empId)
        .order('fecha_incidente', { ascending: false }),
      db.from('amonestaciones')
        .select('*')
        .eq('empleado_id', empId)
        .order('created_at', { ascending: false }),
    ]);
    setEmpHistorial({ incidentes: incs || [], amonestaciones: amons || [] });
    setLoadingHist(false);
  }, [empMap]);

  // ── Guardar incidente ──
  const guardarIncidente = async () => {
    if (!formInc.empleado_id || !formInc.descripcion.trim()) {
      show('⚠️ Empleado y descripción son requeridos'); return;
    }
    setGuardando(true);
    try {
      const testigos = formInc.testigos.split(',').map(t => t.trim()).filter(Boolean);
      const { data, error } = await db.from('incidentes_disciplinarios').insert({
        empleado_id:     formInc.empleado_id,
        sucursal_id:     empMap[formInc.empleado_id]?.sucursal_id || null,
        tipo_incidente:  formInc.tipo_incidente,
        categoria:       formInc.categoria || null,
        descripcion:     formInc.descripcion,
        fecha_incidente: formInc.fecha_incidente,
        testigos:        testigos.length ? testigos : null,
      }).select('*, empleados(nombre_completo, cargo, sucursal_id), amonestaciones(id, tipo, estado)').single();

      if (error) throw error;
      setIncidentes(prev => [data, ...prev]);
      show('✅ Incidente registrado');
      setModalInc(false);
      setFormInc(FORM_INIT);

      // Si estamos en historial del mismo empleado, recargar
      if (selectedEmp?.id === formInc.empleado_id) abrirHistorial(formInc.empleado_id);
    } catch (e) { show('Error: ' + e.message); }
    finally { setGuardando(false); }
  };

  // ── Preparar modal de amonestación ──
  const abrirModalAmon = async (incidente) => {
    // Calcular nivel sugerido
    const { data: prevAmons } = await db.from('amonestaciones')
      .select('created_at, tipo')
      .eq('empleado_id', incidente.empleado_id)
      .order('created_at', { ascending: false });

    const nivel = sugerirNivel(prevAmons || [], incidente.tipo_incidente);
    setNivelSugerido(nivel);
    setFormAmon({ ...AMON_INIT, tipo: nivel });
    setModalAmon(incidente);
  };

  // ── Guardar amonestación ──
  const guardarAmonestacion = async () => {
    if (!modalAmon) return;
    setGuardando(true);
    try {
      const nivelNum = { verbal:1, escrita:2, suspension:3, despido:4 }[formAmon.tipo] || 1;
      const { error } = await db.from('amonestaciones').insert({
        incidente_id:    modalAmon.id,
        empleado_id:     modalAmon.empleado_id,
        tipo:            formAmon.tipo,
        nivel:           nivelNum,
        razon:           formAmon.razon || null,
        dias_suspension: formAmon.tipo === 'suspension' ? n(formAmon.dias_suspension) : null,
        creada_por:      null,
      });
      if (error) throw error;
      show(`✅ Amonestación ${NIVEL_LABELS[formAmon.tipo]} registrada`);

      // Generar acta automáticamente
      const empInfo = empMap[modalAmon.empleado_id] || modalAmon.empleados;
      const sucInfo = empInfo?.sucursal_id ? sucMap[empInfo.sucursal_id] : null;
      const html = generarHTMLActa(modalAmon, formAmon, empInfo?.nombre_completo || '', empInfo?.cargo || '', sucInfo?.nombre || '');
      const w = window.open('', '_blank', 'width=720,height=950');
      w.document.write(html); w.document.close();

      setModalAmon(null);
      setFormAmon(AMON_INIT);

      // Recargar incidentes
      const { data: updated } = await db.from('incidentes_disciplinarios')
        .select('*, empleados(nombre_completo, cargo, sucursal_id), amonestaciones(id, tipo, estado)')
        .order('created_at', { ascending: false }).limit(50);
      if (updated) setIncidentes(updated);
      if (selectedEmp) abrirHistorial(selectedEmp.id);
    } catch (e) { show('Error: ' + e.message); }
    finally { setGuardando(false); }
  };

  // ── Estadísticas ──
  const stats = useMemo(() => {
    const hoy = new Date();
    const hace30 = new Date(hoy); hace30.setDate(hoy.getDate() - 30);
    const delMes = incidentes.filter(i => new Date(i.created_at) >= hace30);
    const pendFirma = incidentes.filter(i => i.amonestaciones?.some(a => a.estado === 'pendiente_firma'));
    const sinAmon = incidentes.filter(i => !i.amonestaciones?.length);
    return { total: incidentes.length, delMes: delMes.length, pendFirma: pendFirma.length, sinAmon: sinAmon.length };
  }, [incidentes]);

  // ── Filtros dashboard ──
  const incidentesFiltrados = useMemo(() => {
    return incidentes.filter(i => {
      const nombreEmp = i.empleados?.nombre_completo?.toLowerCase() || '';
      const matchBusq = !busqueda || nombreEmp.includes(busqueda.toLowerCase());
      const matchTipo = filtroTipo === 'todos' || i.tipo_incidente === filtroTipo;
      return matchBusq && matchTipo;
    });
  }, [incidentes, busqueda, filtroTipo]);

  // ── RENDER ────────────────────────────────────────────────────

  // Pantalla 1: Historial empleado
  if (screen === 1 && selectedEmp) {
    const totalAmons = empHistorial.amonestaciones.length;
    const ultimoNivel = empHistorial.amonestaciones[0]?.tipo;
    return (
      <div style={{ padding: '16px 12px', maxWidth: 760, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <button onClick={() => setScreen(0)} style={{ background: 'none', border: 'none', color: c.red, fontSize: 18, cursor: 'pointer' }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: c.text }}>{selectedEmp.nombre_completo}</div>
            <div style={{ fontSize: 12, color: c.textDim }}>{selectedEmp.cargo} · {sucMap[selectedEmp.sucursal_id]?.nombre || '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ultimoNivel && (
              <span style={{ background: NIVEL_COLORS[ultimoNivel], color: '#111', padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                {NIVEL_LABELS[ultimoNivel]}
              </span>
            )}
            <button
              onClick={() => { setFormInc({ ...FORM_INIT, empleado_id: selectedEmp.id }); setModalInc(true); }}
              style={{ background: c.red, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >+ Incidente</button>
          </div>
        </div>

        {/* Resumen */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Incidentes', val: empHistorial.incidentes.length, color: c.orange },
            { label: 'Amonestaciones', val: totalAmons, color: c.red },
            { label: 'Último nivel', val: ultimoNivel ? NIVEL_LABELS[ultimoNivel] : 'Ninguno', color: ultimoNivel ? NIVEL_COLORS[ultimoNivel] : c.textDim },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 11, color: c.textDim }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Timeline */}
        {loadingHist ? (
          <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando historial…</div>
        ) : empHistorial.incidentes.length === 0 ? (
          <div style={{ textAlign: 'center', color: c.textOff, padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ color: c.textDim }}>Sin incidentes registrados</div>
          </div>
        ) : (
          <div>
            {empHistorial.incidentes.map(inc => {
              const tipoInfo = TIPOS[inc.tipo_incidente] || TIPOS.otro;
              const amons = inc.amonestaciones || [];
              return (
                <div key={inc.id} style={{
                  background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
                  padding: 16, marginBottom: 12, borderLeft: `4px solid ${tipoInfo.color}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color: tipoInfo.color, fontSize: 13, fontWeight: 700 }}>{tipoInfo.label}</span>
                        {inc.categoria && <span style={{ background: '#2a2a2a', color: c.textDim, padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{inc.categoria}</span>}
                        <span style={{ fontSize: 11, color: c.textOff }}>{fmtDate(inc.fecha_incidente)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: c.text, marginBottom: 6 }}>{inc.descripcion}</div>
                      {inc.testigos?.length > 0 && (
                        <div style={{ fontSize: 11, color: c.textDim }}>Testigos: {inc.testigos.join(', ')}</div>
                      )}
                    </div>
                    {amons.length === 0 && (
                      <button
                        onClick={() => abrirModalAmon(inc)}
                        style={{ background: c.red, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 10 }}
                      >Amonestar</button>
                    )}
                  </div>
                  {amons.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {amons.map(a => (
                        <span key={a.id} style={{
                          background: NIVEL_COLORS[a.tipo], color: '#111', padding: '3px 10px',
                          borderRadius: 6, fontSize: 11, fontWeight: 700,
                        }}>{NIVEL_LABELS[a.tipo]}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Pantalla 0: Dashboard
  return (
    <div style={{ padding: '16px 12px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {onBack && <button onClick={onBack} style={{ background: 'none', border: 'none', color: c.red, fontSize: 18, cursor: 'pointer' }}>←</button>}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>⚖️ Amonestaciones</div>
          <div style={{ fontSize: 13, color: c.textDim }}>Registro disciplinario de empleados</div>
        </div>
        <button
          onClick={() => { setFormInc(FORM_INIT); setModalInc(true); }}
          style={{ background: c.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >+ Nuevo Incidente</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total incidentes', val: stats.total,      color: c.text    },
          { label: 'Últimos 30 días', val: stats.delMes,      color: c.orange  },
          { label: 'Sin amonestación', val: stats.sinAmon,    color: c.yellow  },
          { label: 'Pend. firma',      val: stats.pendFirma,  color: c.red     },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 110 }}>
            <div style={{ fontSize: 11, color: c.textDim }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 2 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar empleado…"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ background: c.card, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 13, flex: 1, minWidth: 200 }}
        />
        <select
          value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value)}
          style={{ background: c.card, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 13 }}
        >
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Lista incidentes */}
      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando…</div>
      ) : incidentesFiltrados.length === 0 ? (
        <div style={{ textAlign: 'center', color: c.textOff, padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div>No hay incidentes registrados</div>
        </div>
      ) : (
        incidentesFiltrados.map(inc => {
          const tipoInfo = TIPOS[inc.tipo_incidente] || TIPOS.otro;
          const amons = inc.amonestaciones || [];
          const emp = inc.empleados;
          const suc = sucMap[emp?.sucursal_id];
          return (
            <div key={inc.id} style={{
              background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
              padding: '12px 16px', marginBottom: 10, borderLeft: `4px solid ${tipoInfo.color}`,
              cursor: 'pointer',
            }} onClick={() => emp && abrirHistorial(inc.empleado_id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{emp?.nombre_completo || '—'}</span>
                    <span style={{ fontSize: 12, color: c.textDim }}>{suc?.store_code || '—'}</span>
                    <span style={{ color: tipoInfo.color, fontSize: 12, fontWeight: 600 }}>{tipoInfo.label}</span>
                    {inc.categoria && <span style={{ background: '#252525', color: c.textDim, padding: '1px 7px', borderRadius: 4, fontSize: 11 }}>{inc.categoria}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: c.textDim, marginBottom: 4 }}>
                    {inc.descripcion.length > 100 ? inc.descripcion.slice(0, 100) + '…' : inc.descripcion}
                  </div>
                  <div style={{ fontSize: 11, color: c.textOff }}>{fmtDate(inc.fecha_incidente)}</div>
                </div>
                <div style={{ marginLeft: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  {amons.length === 0 ? (
                    <span style={{ background: '#2a2a2a', color: c.yellow, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Sin amonestación</span>
                  ) : (
                    amons.map(a => (
                      <span key={a.id} style={{ background: NIVEL_COLORS[a.tipo], color: '#111', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                        {NIVEL_LABELS[a.tipo]}
                      </span>
                    ))
                  )}
                  {amons.length === 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); abrirModalAmon(inc); }}
                      style={{ background: c.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >Amonestar</button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* ── Modal Nuevo Incidente ── */}
      {modalInc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#1a1a1a', border: `1px solid ${c.border}`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text, marginBottom: 20 }}>📋 Registrar Incidente</div>

            {[
              { label: 'Empleado *', content: (
                <select value={formInc.empleado_id} onChange={e => setFormInc(p => ({ ...p, empleado_id: e.target.value }))}
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  <option value="">Seleccionar empleado…</option>
                  {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
                </select>
              )},
              { label: 'Fecha del incidente *', content: (
                <input type="date" value={formInc.fecha_incidente} onChange={e => setFormInc(p => ({ ...p, fecha_incidente: e.target.value }))}
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              )},
              { label: 'Tipo de incidente', content: (
                <select value={formInc.tipo_incidente} onChange={e => setFormInc(p => ({ ...p, tipo_incidente: e.target.value, categoria: '' }))}
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              )},
              { label: 'Categoría', content: (
                <select value={formInc.categoria} onChange={e => setFormInc(p => ({ ...p, categoria: e.target.value }))}
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  <option value="">Seleccionar…</option>
                  {(CATEGORIAS[formInc.tipo_incidente] || []).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              )},
              { label: 'Descripción detallada *', content: (
                <textarea value={formInc.descripcion} onChange={e => setFormInc(p => ({ ...p, descripcion: e.target.value }))}
                  rows={3} placeholder="Describe el incidente con detalle…"
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, resize: 'vertical' }} />
              )},
              { label: 'Testigos (separar por coma)', content: (
                <input type="text" value={formInc.testigos} onChange={e => setFormInc(p => ({ ...p, testigos: e.target.value }))}
                  placeholder="Ej: Juan Pérez, Ana López"
                  style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              )},
            ].map(({ label, content }) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>{label}</label>
                {content}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={() => setModalInc(false)} style={{ flex: 1, background: '#2a2a2a', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 0', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={guardarIncidente} disabled={guardando} style={{ flex: 2, background: c.red, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {guardando ? 'Guardando…' : '✓ Registrar incidente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Amonestación ── */}
      {modalAmon && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#1a1a1a', border: `1px solid ${c.border}`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text, marginBottom: 4 }}>⚖️ Crear Amonestación</div>
            <div style={{ fontSize: 12, color: c.textDim, marginBottom: 20 }}>
              {empMap[modalAmon.empleado_id]?.nombre_completo || modalAmon.empleados?.nombre_completo}
            </div>

            {/* Nivel sugerido */}
            <div style={{ background: '#111', borderRadius: 8, padding: '10px 14px', marginBottom: 16, border: `1px solid ${c.border}` }}>
              <div style={{ fontSize: 11, color: c.textDim, marginBottom: 4 }}>Nivel sugerido por historial</div>
              <span style={{ background: NIVEL_COLORS[nivelSugerido], color: '#111', padding: '3px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                {NIVEL_LABELS[nivelSugerido]}
              </span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>Tipo de amonestación</label>
              <select value={formAmon.tipo} onChange={e => setFormAmon(p => ({ ...p, tipo: e.target.value }))}
                style={{ width: '100%', background: '#111', color: NIVEL_COLORS[formAmon.tipo], border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700 }}>
                {Object.entries(NIVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            {formAmon.tipo === 'suspension' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>Días de suspensión (sin goce de sueldo)</label>
                <input type="number" min="1" max="30" value={formAmon.dias_suspension}
                  onChange={e => setFormAmon(p => ({ ...p, dias_suspension: e.target.value }))}
                  style={{ width: '100%', background: '#111', color: c.orange, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>Razón / Justificación</label>
              <textarea value={formAmon.razon} onChange={e => setFormAmon(p => ({ ...p, razon: e.target.value }))}
                rows={3} placeholder="Motivo de la amonestación…"
                style={{ width: '100%', background: '#111', color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalAmon(null)} style={{ flex: 1, background: '#2a2a2a', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 0', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={guardarAmonestacion} disabled={guardando} style={{ flex: 2, background: NIVEL_COLORS[formAmon.tipo], color: '#111', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {guardando ? 'Guardando…' : '✓ Confirmar + Generar Acta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
