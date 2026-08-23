import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n } from '../../config';

// ══════════════════════════════════════════════════════════════
// ÓRDENES DE PRODUCCIÓN — tab de aprobación (ítem 5 del plan de inventario)
// Ciclo: generar_ordenes_produccion(fecha) crea borradores desde
// min_max_calculados() → el jefe aprueba (ajustando tandas) → asigna
// responsable (CM001) → al completar llama registrar_produccion con las
// tandas aprobadas y guarda produccion_id en la orden.
// La UI solo LEE y TRANSICIONA órdenes (update directo, guard por estado);
// crearlas es trabajo exclusivo del RPC generador.
// ══════════════════════════════════════════════════════════════

// Mismos colores/helpers que ProduccionDiaria — duplicados a propósito:
// importarlos desde ese archivo crearía un import circular (él importa este tab).
const C = {
  bg: '#0f1117',
  card: '#1a1d28',
  border: '#2a2d3a',
  accent: '#e63946',
  green: '#22c55e',
  greenSoft: '#22c55e18',
  greenBorder: '#22c55e44',
  blue: '#3b82f6',
  blueSoft: '#3b82f618',
  blueBorder: '#3b82f644',
  yellow: '#f59e0b',
  yellowSoft: '#f59e0b18',
  yellowBorder: '#f59e0b44',
  red: '#ef4444',
  redSoft: '#ef444418',
  purple: '#a855f7',
  text: '#e8e8ed',
  textMuted: '#8b8d9a',
  textDim: '#5a5c6a',
};
const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #2a2d3a', background: '#12141e', color: '#e8e8ed', fontSize: 13, boxSizing: 'border-box', outline: 'none' };
const initials = (nombre, apellido) => {
  const n1 = (nombre || '?')[0]?.toUpperCase() || '?';
  const n2 = (apellido || '')[0]?.toUpperCase() || '';
  return n1 + n2;
};
const empColors = ['#e63946', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#ef4444'];
const empColor = (id) => empColors[((id || '').charCodeAt(5) || 0) % empColors.length];

// Solo estos roles aparecen en el picker de responsable (patrón de ProduccionDiaria)
const ROLES_PRODUCCION = ['produccion', 'jefe_casa_matriz', 'despachador'];

// Estados según el CHECK de ordenes_produccion — no inventar otros
const ESTADOS = {
  borrador:   { label: 'Borrador',   icon: '📝', color: C.yellow },
  aprobada:   { label: 'Aprobada',   icon: '👍', color: C.blue },
  asignada:   { label: 'Asignada',   icon: '👤', color: C.purple },
  completada: { label: 'Completada', icon: '✅', color: C.green },
  cancelada:  { label: 'Cancelada',  icon: '🚫', color: C.red },
};
const ORDEN_ESTADOS = ['borrador', 'aprobada', 'asignada', 'completada', 'cancelada'];

// Número compacto: sin decimales de relleno, '—' si no hay dato
const f = (v, dec = 1) => (v === null || v === undefined) ? '—' : String(parseFloat(n(v).toFixed(dec)));

const CONFIANZA = {
  alta:  { color: C.green,  soft: C.greenSoft,  border: C.greenBorder },
  media: { color: C.yellow, soft: C.yellowSoft, border: C.yellowBorder },
  baja:  { color: C.red,    soft: C.redSoft,    border: '#ef444444' },
};

export default function OrdenesProduccionTab({ user, canEdit, empleadosCM }) {
  const [fecha, setFecha] = useState(today());
  const [ordenes, setOrdenes] = useState([]);
  const [loadingOrd, setLoadingOrd] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState(null);       // orden con acción en curso
  const [expandedId, setExpandedId] = useState(null); // "¿por qué?" abierto
  const [tandasEdit, setTandasEdit] = useState({});   // ajuste de tandas por orden
  const [pickerId, setPickerId] = useState(null);     // picker de responsable abierto
  const [searchEmp, setSearchEmp] = useState('');
  const [cancelId, setCancelId] = useState(null);     // formulario de cancelación abierto
  const [motivo, setMotivo] = useState('');
  const [confirmId, setConfirmId] = useState(null);   // confirmación de completar

  // ── Cargar órdenes de la fecha ──
  const cargarOrdenes = useCallback(async () => {
    setLoadingOrd(true);
    try {
      const { data, error: qErr } = await db.from('ordenes_produccion')
        .select(`*,
          receta:recetas!ordenes_produccion_receta_id_fkey(id,nombre,rendimiento,unidad_rendimiento),
          producto:catalogo_productos!ordenes_produccion_producto_id_fkey(id,nombre,unidad_medida),
          responsable:usuarios_erp!ordenes_produccion_responsable_id_fkey(id,nombre,apellido),
          aprobador:usuarios_erp!ordenes_produccion_aprobada_por_fkey(id,nombre,apellido),
          produccion:produccion_diaria!ordenes_produccion_produccion_id_fkey(id,lote,costo_total)`)
        .eq('fecha', fecha)
        .order('created_at', { ascending: true });
      if (qErr) throw qErr;
      const orden = (o) => ORDEN_ESTADOS.indexOf(o.estado);
      setOrdenes((data || []).sort((a, b) => orden(a) - orden(b) || (a.receta?.nombre || '').localeCompare(b.receta?.nombre || '')));
    } catch (err) {
      console.error('Error cargando órdenes:', err);
      setError(err.message || 'Error cargando órdenes de producción');
    }
    setLoadingOrd(false);
  }, [fecha]);

  useEffect(() => { cargarOrdenes(); }, [cargarOrdenes]);

  // ── Generar sugerencias (borradores) para la fecha ──
  const generar = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: gErr } = await db.rpc('generar_ordenes_produccion', { p_fecha: fecha });
      if (gErr) throw gErr;
      setSuccess(
        `${n(data?.creadas)} orden(es) nueva(s) · ${n(data?.omitidas_existentes)} ya existían · ` +
        `${n(data?.sin_necesidad)} receta(s) sin necesidad de producir`
      );
      await cargarOrdenes();
    } catch (err) {
      console.error('Error generando órdenes:', err);
      setError(err.message || 'Error generando sugerencias');
    }
    setGenerating(false);
  };

  // ── Update con guard de estado: si la orden ya cambió en otra sesión,
  //    NO pisa nada y lo dice con honestidad ──
  const updateOrden = async (id, patch, desdeEstados) => {
    const { data, error: uErr } = await db.from('ordenes_produccion')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('estado', desdeEstados)
      .select('id');
    if (uErr) throw uErr;
    if (!data || data.length === 0) {
      throw new Error('La orden ya cambió de estado (¿otra sesión?). Se recargó la lista.');
    }
  };

  const conAccion = async (id, fn) => {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      await fn();
    } catch (err) {
      console.error('Error en acción de orden:', err);
      setError(err.message || 'Error procesando la orden');
    }
    setBusyId(null);
    cargarOrdenes();
  };

  // ── Acciones ──
  const aprobar = (o) => conAccion(o.id, async () => {
    const tandas = n(tandasEdit[o.id] !== undefined ? tandasEdit[o.id] : o.tandas_sugeridas);
    if (tandas <= 0) throw new Error('Las tandas aprobadas deben ser mayores a 0');
    await updateOrden(o.id, {
      tandas_aprobadas: tandas,
      estado: 'aprobada',
      aprobada_por: user?.id || null,
    }, ['borrador']);
    setSuccess(`Orden de ${o.receta?.nombre} aprobada: ${tandas} tanda(s)`);
  });

  const asignar = (o, emp) => conAccion(o.id, async () => {
    await updateOrden(o.id, {
      responsable_id: emp.id,
      estado: 'asignada',
    }, ['aprobada', 'asignada']);
    setPickerId(null);
    setSearchEmp('');
    setSuccess(`${o.receta?.nombre} asignada a ${emp.nombre} ${emp.apellido}`);
  });

  const cancelar = (o) => conAccion(o.id, async () => {
    if (!motivo.trim()) throw new Error('Escribí el motivo de la cancelación');
    await updateOrden(o.id, {
      estado: 'cancelada',
      notas: [o.notas, `Cancelada: ${motivo.trim()}`].filter(Boolean).join(' · '),
    }, ['borrador', 'aprobada', 'asignada']);
    setCancelId(null);
    setMotivo('');
    setSuccess(`Orden de ${o.receta?.nombre} cancelada`);
  });

  // Completar = registrar la producción REAL (mueve inventario vía kardex)
  // y recién después marcar la orden. Si el segundo paso falla, se avisa que
  // la producción SÍ quedó registrada — nunca se simula un estado.
  const completar = (o) => conAccion(o.id, async () => {
    const tandas = n(o.tandas_aprobadas) || n(o.tandas_sugeridas);
    if (tandas <= 0) throw new Error('La orden no tiene tandas válidas');
    if (!o.responsable_id) throw new Error('Asigná un responsable antes de completar');

    const { data: rp, error: rpErr } = await db.rpc('registrar_produccion', {
      p_receta_id: o.receta_id,
      p_cantidad: tandas,
      p_turno: null,
      p_notas: `Orden de producción del ${fmtDate(o.fecha)}` + (o.notas ? ` · ${o.notas}` : ''),
      p_responsable_id: o.responsable_id,
      p_usuario_id: user?.id || null,
      p_usuario_nombre: `${user?.nombre || ''} ${user?.apellido || ''}`.trim() || null,
      p_fecha: o.fecha,
    });
    if (rpErr) throw new Error(rpErr.message || JSON.stringify(rpErr));

    setConfirmId(null);
    try {
      await updateOrden(o.id, { estado: 'completada', produccion_id: rp?.produccion_id || null }, ['asignada']);
    } catch (err) {
      throw new Error(`⚠️ La producción SÍ quedó registrada (lote ${rp?.lote}) pero la orden no se pudo marcar completada: ${err.message}`);
    }

    const unidades = rp?.unidades_producidas
      ? ` = ${f(rp.unidades_producidas, 2)} ${o.receta?.unidad_rendimiento || 'unidades'}`
      : '';
    if (rp?.aviso) {
      // El servidor avisa cuando consumió insumos sin dar de alta el producto:
      // eso se muestra como error, no se esconde detrás de una palomita verde.
      setError(`⚠️ Lote ${rp.lote}: ${rp.aviso}`);
    } else {
      setSuccess(
        `Lote ${rp?.lote} registrado — ${tandas} tanda(s) de ${o.receta?.nombre}${unidades}. ` +
        `Costo $${n(rp?.costo_total).toFixed(2)}. Insumos descontados (kardex).`
      );
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Sub-componentes ──
  const Alert = ({ type, msg, onDismiss }) => {
    if (!msg) return null;
    const isErr = type === 'error';
    return (
      <div style={{
        background: isErr ? C.redSoft : C.greenSoft,
        border: `1px solid ${isErr ? '#ef444444' : C.greenBorder}`,
        color: isErr ? '#fca5a5' : '#86efac',
        padding: '12px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>{isErr ? '⚠️' : '✅'}</span>
        <span style={{ flex: 1 }}>{msg}</span>
        {onDismiss && (
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
        )}
      </div>
    );
  };

  const EstadoChip = ({ estado }) => {
    const e = ESTADOS[estado] || { label: estado, icon: '❔', color: C.textDim };
    return (
      <span style={{
        background: e.color + '18', border: `1px solid ${e.color}44`, color: e.color,
        padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        {e.icon} {e.label}
      </span>
    );
  };

  // OJO: las tarjetas/paneles con inputs se renderizan como FUNCIONES
  // (renderX(o)), no como componentes anidados <X/>: un componente definido
  // adentro del render se remonta en cada tecleo y el input pierde el foco.

  // El "porqué" de las tandas: min_max_calculados congelado en detalle_calculo
  const renderPorQue = (o) => {
    const d = o.detalle_calculo || {};
    const conf = CONFIANZA[d.confianza] || CONFIANZA.baja;
    const Fila = ({ label, valor, sub }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: `1px solid ${C.bg}` }}>
        <div>
          <div style={{ fontSize: 12, color: C.text }}>{label}</div>
          {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>{valor}</div>
      </div>
    );
    const faltante = Math.max(0, n(d.maximo) - n(d.stock_total));
    return (
      <div style={{ background: C.bg, borderRadius: 10, padding: '8px 12px', marginTop: 10, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 6px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted }}>CÁLCULO DE LA SUGERENCIA</span>
          <span style={{
            marginLeft: 'auto', background: conf.soft, border: `1px solid ${conf.border}`, color: conf.color,
            padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
          }}>
            confianza {d.confianza || '?'} · {f(d.n_senales, 0)} señal(es)
          </span>
        </div>
        <Fila label="Consumo diario estimado" valor={`${f(d.consumo_diario, 2)} /día`}
          sub={`venta ${f(d.venta_diaria, 2)} · pedidos ${f(d.pedidos_diarios, 2)} · caída en conteo ${f(d.conteo_caida_diaria, 2)}`} />
        <Fila label="Stock actual" valor={f(d.stock_total, 2)}
          sub={`Casa Matriz ${f(d.stock_cm, 2)} + sucursales ${f(d.stock_sucursales, 2)}`} />
        <Fila label="Mínimo / Máximo" valor={`${f(d.minimo, 2)} / ${f(d.maximo, 2)}`}
          sub={`cobertura ${f(d.dias_cobertura, 1)} día(s) · factor máx ×${f(d.factor_maximo, 2)}`} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0 2px' }}>
          <div style={{ fontSize: 12, color: C.yellow }}>
            Para llegar al máximo faltan {f(faltante, 2)} → con tandas de {f(d.rendimiento, 2)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.yellow, flexShrink: 0, marginLeft: 8 }}>
            {f(o.tandas_sugeridas, 2)} tanda(s)
          </div>
        </div>
      </div>
    );
  };

  // Picker de responsable — mismo patrón (grid + buscador) que ProduccionDiaria
  const renderPicker = (o) => {
    const filtrados = (empleadosCM || [])
      .filter(e => ROLES_PRODUCCION.includes(e.rol))
      .filter(e => !searchEmp || `${e.nombre} ${e.apellido}`.toLowerCase().includes(searchEmp.toLowerCase()));
    return (
      <div style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: 12, marginTop: 10, background: C.bg }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input type="text" value={searchEmp} onChange={e => setSearchEmp(e.target.value)}
            placeholder="🔍 Buscar responsable..." style={{ ...inp, fontSize: 13 }} />
          <button onClick={() => { setPickerId(null); setSearchEmp(''); }}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, cursor: 'pointer', padding: '6px 10px', fontSize: 12, flexShrink: 0 }}>
            Cerrar
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
          {filtrados.map(e => {
            const color = empColor(e.id);
            return (
              <button key={e.id} onClick={() => asignar(o, e)} disabled={busyId === o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10,
                  background: C.card, border: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: color + '22', border: `1.5px solid ${color}66`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color,
                }}>
                  {initials(e.nombre, e.apellido)}
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.nombre}</div>
                  <div style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.apellido}</div>
                </div>
              </button>
            );
          })}
        </div>
        {filtrados.length === 0 && (
          <div style={{ textAlign: 'center', padding: 12, color: C.textDim, fontSize: 12 }}>
            No se encontró "{searchEmp}"
          </div>
        )}
      </div>
    );
  };

  const btn = (color, solid = false) => ({
    flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 12,
    background: solid ? color : color + '18',
    border: `1px solid ${solid ? color : color + '44'}`,
    color: solid ? '#fff' : color,
  });

  // ── Tarjeta de orden ──
  const renderOrden = (o) => {
    const est = ESTADOS[o.estado] || { color: C.textDim };
    const tandas = o.estado === 'borrador' ? n(o.tandas_sugeridas) : (n(o.tandas_aprobadas) || n(o.tandas_sugeridas));
    const rend = n(o.receta?.rendimiento);
    const unidades = rend > 0 ? tandas * rend : null;
    const busy = busyId === o.id;
    const respColor = o.responsable ? empColor(o.responsable.id) : C.textDim;

    return (
      <div key={o.id} style={{
        background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${est.color}`,
        borderRadius: 12, padding: '12px 14px', marginBottom: 10, opacity: o.estado === 'cancelada' ? 0.65 : 1,
      }}>
        {/* Encabezado */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{o.receta?.nombre || 'Receta desconocida'}</div>
            {o.producto?.nombre && (
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>→ {o.producto.nombre}</div>
            )}
          </div>
          <EstadoChip estado={o.estado} />
        </div>

        {/* Tandas */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ background: C.yellowSoft, border: `1px solid ${C.yellowBorder}`, color: C.yellow, padding: '3px 10px', borderRadius: 8, fontSize: 12 }}>
            Sugeridas: <strong>{f(o.tandas_sugeridas, 2)}</strong>
          </span>
          {o.tandas_aprobadas !== null && (
            <span style={{ background: C.blueSoft, border: `1px solid ${C.blueBorder}`, color: C.blue, padding: '3px 10px', borderRadius: 8, fontSize: 12 }}>
              Aprobadas: <strong>{f(o.tandas_aprobadas, 2)}</strong>
            </span>
          )}
          {unidades !== null && o.estado !== 'cancelada' && (
            <span style={{ fontSize: 11, color: C.textDim }}>
              ≈ {f(unidades, 2)} {o.receta?.unidad_rendimiento || 'unidades'}
            </span>
          )}
        </div>

        {/* Responsable / aprobador */}
        {(o.responsable || o.aprobador) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {o.responsable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: respColor + '14', border: `1px solid ${respColor}44`, borderRadius: 8, padding: '4px 8px' }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                  background: respColor + '33', color: respColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {initials(o.responsable.nombre, o.responsable.apellido)}
                </div>
                <span style={{ fontSize: 11, color: respColor, fontWeight: 600 }}>
                  Produce: {o.responsable.nombre} {o.responsable.apellido}
                </span>
              </div>
            )}
            {o.aprobador && (
              <span style={{ fontSize: 10, color: C.textDim, alignSelf: 'center' }}>
                Aprobó: {o.aprobador.nombre} {o.aprobador.apellido}
              </span>
            )}
          </div>
        )}

        {/* Resultado (completada) */}
        {o.estado === 'completada' && o.produccion && (
          <div style={{ background: C.greenSoft, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: '6px 10px', marginTop: 8, fontSize: 12, color: '#86efac' }}>
            🏷️ {o.produccion.lote} · Costo ${n(o.produccion.costo_total).toFixed(2)}
          </div>
        )}

        {/* Notas / motivo de cancelación */}
        {o.notas && (
          <div style={{ fontSize: 11, color: o.estado === 'cancelada' ? '#fca5a5' : C.textMuted, marginTop: 8, fontStyle: 'italic' }}>
            📝 {o.notas}
          </div>
        )}

        {/* ¿Por qué estas tandas? */}
        <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
          style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, cursor: 'pointer', padding: 0, marginTop: 10, fontWeight: 600 }}>
          {expandedId === o.id ? '▾ Ocultar cálculo' : '▸ ¿Por qué estas tandas?'}
        </button>
        {expandedId === o.id && renderPorQue(o)}

        {/* Acciones por estado */}
        {canEdit && o.estado === 'borrador' && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>
              Tandas a aprobar (podés ajustar la sugerencia)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" step="0.5" min="0.5"
                value={tandasEdit[o.id] !== undefined ? tandasEdit[o.id] : n(o.tandas_sugeridas)}
                onChange={e => setTandasEdit(t => ({ ...t, [o.id]: e.target.value }))}
                style={{ ...inp, width: 90, textAlign: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }} />
              <button onClick={() => aprobar(o)} disabled={busy} style={btn(C.green, true)}>
                {busy ? '⏳' : '👍 Aprobar'}
              </button>
              <button onClick={() => { setCancelId(cancelId === o.id ? null : o.id); setMotivo(''); }} disabled={busy} style={{ ...btn(C.red), flex: '0 0 auto' }}>
                🚫
              </button>
            </div>
          </div>
        )}

        {canEdit && o.estado === 'aprobada' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => { setPickerId(pickerId === o.id ? null : o.id); setSearchEmp(''); }} disabled={busy} style={btn(C.purple, true)}>
              👤 Asignar responsable
            </button>
            <button onClick={() => { setCancelId(cancelId === o.id ? null : o.id); setMotivo(''); }} disabled={busy} style={{ ...btn(C.red), flex: '0 0 auto' }}>
              🚫
            </button>
          </div>
        )}

        {canEdit && o.estado === 'asignada' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setConfirmId(confirmId === o.id ? null : o.id)} disabled={busy} style={btn(C.green, true)}>
              ✅ Marcar completada
            </button>
            <button onClick={() => { setPickerId(pickerId === o.id ? null : o.id); setSearchEmp(''); }} disabled={busy} style={{ ...btn(C.purple), flex: '0 0 auto' }}>
              👤
            </button>
            <button onClick={() => { setCancelId(cancelId === o.id ? null : o.id); setMotivo(''); }} disabled={busy} style={{ ...btn(C.red), flex: '0 0 auto' }}>
              🚫
            </button>
          </div>
        )}

        {/* Confirmación de completar: registra producción real y mueve kardex */}
        {canEdit && confirmId === o.id && o.estado === 'asignada' && (
          <div style={{ background: C.greenSoft, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>
              Se va a registrar la producción de <strong>{f(tandas, 2)} tanda(s)</strong> de{' '}
              <strong>{o.receta?.nombre}</strong> a nombre de{' '}
              <strong>{o.responsable ? `${o.responsable.nombre} ${o.responsable.apellido}` : '—'}</strong>.
              Esto descuenta insumos y da de alta el producto (kardex).
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => completar(o)} disabled={busy} style={btn(C.green, true)}>
                {busy ? '⏳ Registrando...' : 'Sí, registrar producción'}
              </button>
              <button onClick={() => setConfirmId(null)} disabled={busy} style={{ ...btn(C.textDim), flex: '0 0 auto' }}>
                No
              </button>
            </div>
          </div>
        )}

        {/* Picker de responsable */}
        {canEdit && pickerId === o.id && ['aprobada', 'asignada'].includes(o.estado) && renderPicker(o)}

        {/* Cancelación con motivo obligatorio */}
        {canEdit && cancelId === o.id && ['borrador', 'aprobada', 'asignada'].includes(o.estado) && (
          <div style={{ background: C.redSoft, border: '1px solid #ef444444', borderRadius: 10, padding: 12, marginTop: 10 }}>
            <label style={{ fontSize: 11, color: '#fca5a5', display: 'block', marginBottom: 4 }}>
              Motivo de la cancelación (obligatorio)
            </label>
            <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: sin insumos, ya se produjo ayer..." style={{ ...inp, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => cancelar(o)} disabled={busy || !motivo.trim()} style={btn(C.red, true)}>
                {busy ? '⏳' : '🚫 Cancelar orden'}
              </button>
              <button onClick={() => { setCancelId(null); setMotivo(''); }} disabled={busy} style={{ ...btn(C.textDim), flex: '0 0 auto' }}>
                Volver
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Conteos por estado ──
  const conteos = ORDEN_ESTADOS
    .map(e => ({ estado: e, count: ordenes.filter(o => o.estado === e).length }))
    .filter(c => c.count > 0);

  const esHoy = fecha === today();

  // ══════ RENDER ══════
  return (
    <>
      <Alert type="error" msg={error} onDismiss={() => setError(null)} />
      <Alert type="success" msg={success} onDismiss={() => setSuccess(null)} />

      {/* Fecha + generar */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>Fecha de las órdenes</label>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
        {canEdit ? (
          <button onClick={generar} disabled={generating}
            style={{
              width: '100%', padding: '13px', borderRadius: 10, border: 'none', cursor: generating ? 'not-allowed' : 'pointer',
              background: generating ? C.textDim : C.accent, color: '#fff', fontWeight: 700, fontSize: 14,
            }}>
            {generating ? '⏳ Analizando consumo y stock...' : esHoy ? '⚡ Generar sugerencias de hoy' : `⚡ Generar sugerencias (${fmtDate(fecha)})`}
          </button>
        ) : (
          <div style={{ fontSize: 12, color: C.textDim, textAlign: 'center' }}>
            🔒 Solo producción, jefe casa matriz, ejecutivo o admin pueden gestionar órdenes.
          </div>
        )}
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 8 }}>
          Analiza consumo diario (venta + pedidos + caída en conteo) contra stock y min/max por receta.
          No duplica: si ya hay orden viva de una receta para la fecha, la salta.
        </div>
      </div>

      {/* Conteos por estado */}
      {conteos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {conteos.map(c => {
            const e = ESTADOS[c.estado];
            return (
              <span key={c.estado} style={{
                background: e.color + '14', border: `1px solid ${e.color}44`, color: e.color,
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              }}>
                {c.count} {e.label.toLowerCase()}{c.count !== 1 ? 's' : ''}
              </span>
            );
          })}
        </div>
      )}

      {/* Lista */}
      {loadingOrd ? (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 24, fontSize: 13 }}>Cargando órdenes...</div>
      ) : ordenes.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 30, fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          No hay órdenes para el {fmtDate(fecha)}.
          {canEdit && <div style={{ marginTop: 4 }}>Generá las sugerencias con el botón de arriba.</div>}
        </div>
      ) : (
        ordenes.map(o => renderOrden(o))
      )}
    </>
  );
}
