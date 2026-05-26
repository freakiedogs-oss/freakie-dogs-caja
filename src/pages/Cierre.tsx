import { useState, useEffect, FormEvent } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { formatUSD, formatDate } from '@/lib/utils';

interface CierreCaja {
  id: string;
  fecha: string;
  cerrado_por: string | null;
  fondo_inicial: number | null;
  ventas_efectivo: number | null;
  ventas_tarjeta: number | null;
  ventas_transferencia: number | null;
  ventas_peya: number | null;
  propinas_total: number | null;
  total_esperado: number | null;
  efectivo_contado: number | null;
  diferencia: number | null;
  efectivo_a_depositar: number | null;
  efectivo_a_caja_chica: number | null;
  notas: string | null;
  created_at: string;
}

interface MotivoEgreso { id: string; nombre: string; requiere_persona: boolean; requiere_comentario: boolean; requiere_foto: boolean; }
interface MotivoIngreso { id: string; nombre: string; requiere_evento: boolean; requiere_comentario: boolean; }
interface Egreso { motivo_id: string; motivo_nombre: string; monto: number; persona_recibe: string | null; empleado_id: string | null; comentario: string | null; }
interface Ingreso { motivo_id: string; motivo_nombre: string; monto: number; nombre_evento: string | null; comentario: string | null; }
interface Ajuste { monto: number; de_metodo: string; a_metodo: string; nota: string | null; }
interface Empleado { id: string; nombre: string; apellido: string | null; cargo: string | null; }

const FONDO_FIJO = 200;
const METODOS = [
  { v: 'efectivo', l: 'Efectivo' },
  { v: 'tarjeta_pos_bac', l: 'Tarjeta' },
  { v: 'transferencia', l: 'Transferencia' },
  { v: 'peya', l: 'PeYa' }
];
const MOTIVOS_EMPLEADO = ['Adelanto de Salario', 'Pago de Salario', 'Pago Propina'];
const today = () => new Date().toISOString().slice(0, 10);

export default function Cierre() {
  const { session } = useSession();
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await kaeru
        .from('cierre_caja')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(50);
      if (cancel) return;
      if (e) { setError(e.message); setLoading(false); return; }
      setCierres((data || []) as CierreCaja[]);
      setError(null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const canEdit = session?.rol === 'super_admin' || session?.rol === 'socio_operativo' || session?.rol === 'manager';
  const totalCajaChica = cierres.reduce((s, c) => s + Number(c.efectivo_a_caja_chica || 0), 0);

  return (
    <PageShell
      kanji="締"
      titulo="Cierre de Caja"
      subtitulo={`${cierres.length} cierres · Caja chica acumulada: ${formatUSD(totalCajaChica)}`}
      badge={{ label: 'Live · cierre_caja', variant: 'kaeru' }}
      actions={canEdit ? <button className="btn btn-kaeru" onClick={() => setShowForm(true)}>+ Cerrar día</button> : null}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card"><div className="card-title">Cierres totales</div><div className="metric-xl text-kaeru">{cierres.length}</div></div>
            <div className="card"><div className="card-title">Último cierre</div><div className="metric-md">{cierres[0] ? formatDate(cierres[0].fecha) : '—'}</div><div className="metric-row text-muted">{cierres[0] ? formatUSD(cierres[0].total_esperado) : ''}</div></div>
            <div className="card"><div className="card-title">Caja chica acumulada</div><div className="metric-xl text-purple">{formatUSD(totalCajaChica)}</div></div>
            <div className="card"><div className="card-title">Diferencias acum.</div><div className="metric-xl text-warning">{formatUSD(cierres.reduce((s, c) => s + Number(c.diferencia || 0), 0))}</div></div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Historial de cierres</div></div>
            {cierres.length === 0 ? (
              <EmptyCard message={`Sin cierres. ${canEdit ? 'Click "+ Cerrar día" para registrar el primero.' : 'Espera al manager.'}`} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Fecha</th><th style={{textAlign:'right'}}>Esperado</th><th style={{textAlign:'right'}}>Contado</th><th style={{textAlign:'right'}}>Dif</th><th style={{textAlign:'right'}}>→Banco</th><th style={{textAlign:'right'}}>→Caja chica</th><th style={{textAlign:'right'}}>Propinas</th><th>Notas</th></tr></thead>
                  <tbody>
                    {cierres.map((c) => (
                      <tr key={c.id}>
                        <td style={{fontWeight:600}}>{formatDate(c.fecha)}</td>
                        <td style={{textAlign:'right'}}>{formatUSD(c.total_esperado)}</td>
                        <td style={{textAlign:'right'}}>{formatUSD(c.efectivo_contado)}</td>
                        <td style={{textAlign:'right'}} className={Math.abs(Number(c.diferencia||0))>1?'text-danger':'text-kaeru'}>{formatUSD(c.diferencia)}</td>
                        <td style={{textAlign:'right'}}>{formatUSD(c.efectivo_a_depositar)}</td>
                        <td style={{textAlign:'right'}} className="text-purple">{formatUSD(c.efectivo_a_caja_chica)}</td>
                        <td style={{textAlign:'right'}} className="text-kaeru">{formatUSD(c.propinas_total)}</td>
                        <td className="text-muted" style={{fontSize:11, maxWidth:200}}>{c.notas ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Drawer open={showForm} onClose={() => setShowForm(false)} title="Cerrar día">
        <CierreForm onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); setReloadKey((k) => k + 1); }} />
      </Drawer>
    </PageShell>
  );
}

// ============================================================================
// CIERRE FORM
// ============================================================================
function CierreForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState(today());
  const [fondo, setFondo] = useState(FONDO_FIJO);
  const [ventasEfectivo, setVentasEfectivo] = useState(0);
  const [ventasTarjeta, setVentasTarjeta] = useState(0);
  const [ventasTransferencia, setVentasTransferencia] = useState(0);
  const [ventasPeya, setVentasPeya] = useState(0);
  const [propinas, setPropinas] = useState(0);
  const [efectivoContado, setEfectivoContado] = useState(0);
  const [efectivoBanco, setEfectivoBanco] = useState(0);
  const [efectivoCajaChica, setEfectivoCajaChica] = useState(0);
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(true);

  const [motivosEg, setMotivosEg] = useState<MotivoEgreso[]>([]);
  const [motivosIn, setMotivosIn] = useState<MotivoIngreso[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [egresos, setEgresos] = useState<Egreso[]>([]);
  const [ingresos, setIngresos] = useState<Ingreso[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [showEg, setShowEg] = useState(false);
  const [showIn, setShowIn] = useState(false);
  const [showAj, setShowAj] = useState(false);

  // Cargar motivos + empleados una vez
  useEffect(() => {
    kaeru.from('motivos_egreso').select('*').eq('activo', true).order('orden').then(({data}) => setMotivosEg((data||[]) as MotivoEgreso[]));
    kaeru.from('motivos_ingreso').select('*').eq('activo', true).order('orden').then(({data}) => setMotivosIn((data||[]) as MotivoIngreso[]));
    kaeru.from('empleados').select('id,nombre,apellido,cargo').eq('activo', true).order('nombre').then(({data}) => setEmpleados((data||[]) as Empleado[]));
  }, []);

  // Cargar ventas del día seleccionado
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoadingPrev(true);
      const { data: vs } = await kaeru
        .from('ventas')
        .select('canal, metodo_pago, total, propina')
        .neq('estado', 'anulada')
        .gte('fecha_hora', `${fecha}T00:00:00`)
        .lt('fecha_hora', `${fecha}T23:59:59`);
      if (cancel) return;
      const v = (vs || []) as any[];
      let efv = 0, tar = 0, trf = 0, py = 0, prop = 0;
      v.forEach((x) => {
        const t = Number(x.total || 0);
        prop += Number(x.propina || 0);
        if (x.canal === 'peya') { py += t; return; }
        const m = (x.metodo_pago || '').toLowerCase();
        if (m.includes('efectivo')) efv += t;
        else if (m.includes('tarjeta') || m.includes('pos')) tar += t;
        else if (m.includes('transfer')) trf += t;
        else efv += t;
      });
      setVentasEfectivo(efv); setVentasTarjeta(tar); setVentasTransferencia(trf); setVentasPeya(py); setPropinas(prop);
      setLoadingPrev(false);
    })();
    return () => { cancel = true; };
  }, [fecha]);

  // Cálculos
  // Aplicar ajustes de cruce sobre los métodos de venta
  const ajustesPorMetodo = (metodo: string) => {
    const salidas = ajustes.filter((a) => a.de_metodo === metodo).reduce((s, a) => s + a.monto, 0);
    const entradas = ajustes.filter((a) => a.a_metodo === metodo).reduce((s, a) => s + a.monto, 0);
    return entradas - salidas;
  };
  const efAjust = ventasEfectivo + ajustesPorMetodo('efectivo');
  const tarAjust = ventasTarjeta + ajustesPorMetodo('tarjeta_pos_bac');
  const trfAjust = ventasTransferencia + ajustesPorMetodo('transferencia');
  const pyAjust = ventasPeya + ajustesPorMetodo('peya');

  const totalEsperado = efAjust + tarAjust + trfAjust + pyAjust;
  const totalEg = egresos.reduce((s, e) => s + e.monto, 0);
  const totalIn = ingresos.reduce((s, e) => s + e.monto, 0);

  // Efectivo del día = ventas efectivo (ajustadas) + propinas + ingresos − egresos
  const efectivoEsperadoCaja = fondo + efAjust + propinas + totalIn - totalEg;
  const diferencia = efectivoContado - efectivoEsperadoCaja;
  const efectivoARepartir = efectivoContado - fondo;
  const sinAsignar = efectivoARepartir - efectivoBanco - efectivoCajaChica;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data: cierreNew, error: e1 } = await kaeru.from('cierre_caja').insert({
        fecha, fondo_inicial: fondo,
        ventas_efectivo: efAjust, ventas_tarjeta: tarAjust,
        ventas_transferencia: trfAjust, ventas_peya: pyAjust,
        propinas_total: propinas, total_esperado: totalEsperado,
        efectivo_contado: efectivoContado, diferencia,
        efectivo_a_depositar: efectivoBanco, efectivo_a_caja_chica: efectivoCajaChica,
        notas: notas || null
      }).select('id').single();

      if (e1 || !cierreNew) { setError(e1?.message || 'Error creando cierre'); setSaving(false); return; }
      const cierreId = cierreNew.id;

      // Insertar egresos/ingresos/ajustes vinculados
      if (egresos.length > 0) {
        const { error: eEg } = await kaeru.from('egresos_cierre').insert(
          egresos.map((g) => ({ ...g, cierre_id: cierreId }))
        );
        if (eEg) console.warn('egresos error:', eEg);
      }
      if (ingresos.length > 0) {
        await kaeru.from('ingresos_cierre').insert(ingresos.map((g) => ({ ...g, cierre_id: cierreId })));
      }
      if (ajustes.length > 0) {
        await kaeru.from('ajustes_metodo').insert(ajustes.map((a) => ({ ...a, cierre_id: cierreId })));
      }

      onSaved();
    } catch (e: any) {
      setError(String(e?.message || e));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack-sm">
      {showEg && <ModalEgreso motivos={motivosEg} empleados={empleados} onClose={() => setShowEg(false)} onSave={(g) => { setEgresos((p) => [...p, g]); setShowEg(false); }} />}
      {showIn && <ModalIngreso motivos={motivosIn} onClose={() => setShowIn(false)} onSave={(g) => { setIngresos((p) => [...p, g]); setShowIn(false); }} />}
      {showAj && <ModalAjuste onClose={() => setShowAj(false)} onSave={(a) => { setAjustes((p) => [...p, a]); setShowAj(false); }} />}

      <Field label="Fecha del cierre">
        <input className="ki-input" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>

      {loadingPrev ? (
        <div className="text-muted" style={{ padding: 8, fontSize: 12 }}>● Consultando ventas del día…</div>
      ) : (
        <Section title="Ventas del día (auto desde kaeru.ventas)">
          <Row label="Efectivo" value={ventasEfectivo} onChange={setVentasEfectivo} />
          <Row label="Tarjeta POS BAC" value={ventasTarjeta} onChange={setVentasTarjeta} />
          <Row label="Transferencia" value={ventasTransferencia} onChange={setVentasTransferencia} />
          <Row label="PeYa" value={ventasPeya} onChange={setVentasPeya} />
          <Row label="Propinas (en efectivo)" value={propinas} onChange={setPropinas}
            help="Propinas pagadas en efectivo al mesero durante el día. Se suman al efectivo esperado en caja porque ese dinero entra al cajón con las ventas en efectivo. Después se reparten el martes con la liquidación semanal de propinas (90% al equipo, 10% casa)." />
          <Total label="Total esperado" value={totalEsperado} />
        </Section>
      )}

      {/* Egresos */}
      <Section title={`Egresos del día (${egresos.length})`} action={<button type="button" className="btn btn-outline btn-sm" onClick={() => setShowEg(true)}>+ Agregar</button>}>
        {egresos.length === 0 ? (
          <div className="text-dim" style={{ fontSize: 12, textAlign: 'center', padding: 8 }}>Sin egresos</div>
        ) : egresos.map((e, i) => (
          <LineItem key={i} onDelete={() => setEgresos((p) => p.filter((_, j) => j !== i))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{e.motivo_nombre}</div>
              {e.persona_recibe && <div className="text-muted" style={{ fontSize: 11 }}>→ {e.persona_recibe}</div>}
              {e.comentario && <div className="text-dim" style={{ fontSize: 11 }}>{e.comentario}</div>}
            </div>
            <span className="text-danger" style={{ fontWeight: 700 }}>−{formatUSD(e.monto)}</span>
          </LineItem>
        ))}
        {egresos.length > 0 && <Total label="Total egresos" value={-totalEg} color="danger" />}
      </Section>

      {/* Ingresos */}
      <Section title={`Ingresos del día (${ingresos.length})`} action={<button type="button" className="btn btn-outline btn-sm" onClick={() => setShowIn(true)}>+ Agregar</button>}>
        {ingresos.length === 0 ? (
          <div className="text-dim" style={{ fontSize: 12, textAlign: 'center', padding: 8 }}>Sin ingresos adicionales</div>
        ) : ingresos.map((g, i) => (
          <LineItem key={i} onDelete={() => setIngresos((p) => p.filter((_, j) => j !== i))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{g.motivo_nombre}</div>
              {g.nombre_evento && <div className="text-muted" style={{ fontSize: 11 }}>Evento: {g.nombre_evento}</div>}
              {g.comentario && <div className="text-dim" style={{ fontSize: 11 }}>{g.comentario}</div>}
            </div>
            <span className="text-kaeru" style={{ fontWeight: 700 }}>+{formatUSD(g.monto)}</span>
          </LineItem>
        ))}
        {ingresos.length > 0 && <Total label="Total ingresos" value={totalIn} color="kaeru" />}
      </Section>

      {/* Ajustes */}
      <Section title={`Ajustes cruce método (${ajustes.length})`} action={<button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAj(true)}>+ Agregar</button>}>
        {ajustes.length === 0 ? (
          <div className="text-dim" style={{ fontSize: 12, textAlign: 'center', padding: 8 }}>Sin ajustes</div>
        ) : ajustes.map((a, i) => (
          <LineItem key={i} onDelete={() => setAjustes((p) => p.filter((_, j) => j !== i))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{formatUSD(a.monto)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{methodLabel(a.de_metodo)} → {methodLabel(a.a_metodo)}</div>
              {a.nota && <div className="text-dim" style={{ fontSize: 11 }}>{a.nota}</div>}
            </div>
          </LineItem>
        ))}
      </Section>

      <Field label="Fondo fijo (cambio en caja)">
        <input className="ki-input" type="number" step="0.01" value={fondo} onChange={(e) => setFondo(Number(e.target.value))} />
      </Field>

      <Field label="Efectivo físico contado (incluye fondo)">
        <input className="ki-input" type="number" step="0.01" required value={efectivoContado} onChange={(e) => setEfectivoContado(Number(e.target.value))} />
      </Field>

      <Section title="Resumen de efectivo">
        <Row2 label="Fondo" value={fondo} />
        <Row2 label="(+) Ventas efectivo" value={efAjust} color="kaeru" />
        <Row2 label="(+) Propinas efectivo" value={propinas} color="kaeru" />
        <Row2 label="(+) Ingresos adicionales" value={totalIn} color="kaeru" />
        <Row2 label="(−) Egresos del día" value={-totalEg} color="danger" />
        <div style={{ borderTop: '1px solid var(--border-default)', margin: '8px 0' }} />
        <Row2 label="= Efectivo esperado en caja" value={efectivoEsperadoCaja} bold />
        <Row2 label="Efectivo contado" value={efectivoContado} bold />
        <Row2 label={Math.abs(diferencia) < 0.01 ? '✓ Cuadra' : diferencia > 0 ? 'Sobrante' : 'Faltante'} value={diferencia} color={Math.abs(diferencia) < 1 ? 'kaeru' : 'danger'} bold />
      </Section>

      <Section title="Distribución del efectivo (decisión Yessica)">
        <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
          Efectivo contado − fondo $200 = a repartir entre banco y caja chica.
        </div>
        <Row2 label="A repartir" value={efectivoARepartir} bold />
        <Field label="→ A depositar en banco">
          <input className="ki-input" type="number" step="0.01" value={efectivoBanco} onChange={(e) => setEfectivoBanco(Number(e.target.value))} />
        </Field>
        <Field label="→ A caja chica (proveedores + comida personal)">
          <input className="ki-input" type="number" step="0.01" value={efectivoCajaChica} onChange={(e) => setEfectivoCajaChica(Number(e.target.value))} />
        </Field>
        <Row2 label="Sin asignar" value={sinAsignar} color={Math.abs(sinAsignar) < 0.01 ? 'kaeru' : 'warning'} bold />
      </Section>

      <Field label="Observaciones">
        <textarea className="ki-input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas del día, incidencias..." />
      </Field>

      {error && (
        <div style={{ background: 'rgba(200,80,74,0.1)', border: '1px solid var(--state-danger)', borderRadius: 'var(--r-md)', padding: 10, fontSize: 11, color: 'var(--state-danger)' }}>{error}</div>
      )}

      <div className="row" style={{ marginTop: 16, gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn btn-kaeru" disabled={saving || Math.abs(sinAsignar) > 0.01}>
          {saving ? 'Guardando…' : '✓ Cerrar caja del día'}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// MODAL EGRESO
// ============================================================================
function ModalEgreso({ motivos, empleados, onClose, onSave }: { motivos: MotivoEgreso[]; empleados: Empleado[]; onClose: () => void; onSave: (e: Egreso) => void }) {
  const [motivo, setMotivo] = useState<MotivoEgreso | null>(null);
  const [monto, setMonto] = useState('');
  const [persona, setPersona] = useState('');
  const [empleadoId, setEmpleadoId] = useState<string | null>(null);
  const [showOtra, setShowOtra] = useState(false);
  const [otroNombre, setOtroNombre] = useState('');
  const [comentario, setComentario] = useState('');

  const esEmpleado = motivo && MOTIVOS_EMPLEADO.includes(motivo.nombre);
  const ok = !!motivo && Number(monto) > 0
    && (!motivo.requiere_persona || (esEmpleado ? (empleadoId || (showOtra && otroNombre.trim())) : persona.trim()))
    && (!motivo.requiere_comentario || comentario.trim());

  return (
    <ModalOverlay onClose={onClose} title="Agregar Egreso">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {motivos.map((m) => (
          <button key={m.id} type="button"
            onClick={() => { setMotivo(m); setPersona(''); setEmpleadoId(null); setShowOtra(false); }}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--r-pill)',
              fontSize: 11,
              fontWeight: 600,
              border: motivo?.id === m.id ? '1.5px solid var(--state-danger)' : '1px solid var(--border-default)',
              background: motivo?.id === m.id ? 'rgba(200,80,74,0.15)' : 'var(--bg-elevated)',
              color: motivo?.id === m.id ? 'var(--state-danger)' : 'var(--text-muted)',
              cursor: 'pointer'
            }}>
            {m.nombre}
          </button>
        ))}
      </div>

      {motivo && (
        <>
          <Field label="Monto *">
            <input className="ki-input" type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </Field>

          {motivo.requiere_persona && esEmpleado && (
            <Field label="Empleado *">
              {persona && !showOtra ? (
                <div className="row" style={{ background: 'rgba(95,224,169,0.1)', border: '1px solid var(--accent-kaeru)', borderRadius: 'var(--r-md)', padding: 8 }}>
                  <span className="text-kaeru" style={{ flex: 1, fontWeight: 600 }}>{persona}</span>
                  <button type="button" onClick={() => { setPersona(''); setEmpleadoId(null); }} className="btn btn-ghost btn-sm">×</button>
                </div>
              ) : !showOtra ? (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--r-md)' }}>
                  {empleados.map((emp) => (
                    <div key={emp.id} onClick={() => { setEmpleadoId(emp.id); setPersona(`${emp.nombre} ${emp.apellido || ''}`.trim()); }} style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 13 }}>
                      {emp.nombre} {emp.apellido} <span className="text-dim" style={{ fontSize: 11 }}>· {emp.cargo}</span>
                    </div>
                  ))}
                  <div onClick={() => setShowOtra(true)} style={{ padding: 10, cursor: 'pointer', fontSize: 12, color: 'var(--accent-purple)', borderTop: '1px solid var(--border-default)' }}>
                    + Otra persona (fuera de empleados)
                  </div>
                </div>
              ) : (
                <div>
                  <input className="ki-input" placeholder="Nombre completo" value={otroNombre} onChange={(e) => setOtroNombre(e.target.value)} />
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowOtra(false)}>Volver</button>
                    <button type="button" className="btn btn-kaeru btn-sm" disabled={!otroNombre.trim()} onClick={() => { setPersona(otroNombre.trim()); setShowOtra(false); }}>Confirmar</button>
                  </div>
                </div>
              )}
            </Field>
          )}

          {motivo.requiere_persona && !esEmpleado && (
            <Field label="Persona / Proveedor *">
              <input className="ki-input" value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Nombre" />
            </Field>
          )}

          {motivo.requiere_comentario && (
            <Field label={`Comentario ${motivo.requiere_comentario ? '*' : ''}`}>
              <textarea className="ki-input" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Describe el gasto..." />
            </Field>
          )}

          {motivo.requiere_foto && (
            <div className="text-muted" style={{ fontSize: 11, padding: 8, background: 'var(--bg-inset)', borderRadius: 'var(--r-md)', marginTop: 8 }}>
              📷 Foto requerida — funcionalidad de upload se implementa en Fase 1.1 (placeholder por ahora)
            </div>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-danger" disabled={!ok} onClick={() => motivo && onSave({
          motivo_id: motivo.id, motivo_nombre: motivo.nombre, monto: Number(monto),
          persona_recibe: persona || null, empleado_id: empleadoId, comentario: comentario || null
        })}>Agregar</button>
      </div>
    </ModalOverlay>
  );
}

// ============================================================================
// MODAL INGRESO
// ============================================================================
function ModalIngreso({ motivos, onClose, onSave }: { motivos: MotivoIngreso[]; onClose: () => void; onSave: (i: Ingreso) => void }) {
  const [motivo, setMotivo] = useState<MotivoIngreso | null>(null);
  const [monto, setMonto] = useState('');
  const [evento, setEvento] = useState('');
  const [comentario, setComentario] = useState('');

  const ok = !!motivo && Number(monto) > 0 && (!motivo.requiere_evento || evento.trim()) && (!motivo.requiere_comentario || comentario.trim());

  return (
    <ModalOverlay onClose={onClose} title="Agregar Ingreso">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {motivos.map((m) => (
          <button key={m.id} type="button" onClick={() => setMotivo(m)}
            style={{
              padding: '6px 12px', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 600,
              border: motivo?.id === m.id ? '1.5px solid var(--accent-kaeru)' : '1px solid var(--border-default)',
              background: motivo?.id === m.id ? 'rgba(95,224,169,0.15)' : 'var(--bg-elevated)',
              color: motivo?.id === m.id ? 'var(--accent-kaeru)' : 'var(--text-muted)', cursor: 'pointer'
            }}>{m.nombre}</button>
        ))}
      </div>

      {motivo && (
        <>
          <Field label="Monto *">
            <input className="ki-input" type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </Field>
          {motivo.requiere_evento && (
            <Field label="Nombre del evento *">
              <input className="ki-input" value={evento} onChange={(e) => setEvento(e.target.value)} />
            </Field>
          )}
          {motivo.requiere_comentario && (
            <Field label="Comentario *">
              <textarea className="ki-input" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-kaeru" disabled={!ok} onClick={() => motivo && onSave({
          motivo_id: motivo.id, motivo_nombre: motivo.nombre, monto: Number(monto),
          nombre_evento: evento || null, comentario: comentario || null
        })}>Agregar</button>
      </div>
    </ModalOverlay>
  );
}

// ============================================================================
// MODAL AJUSTE
// ============================================================================
function ModalAjuste({ onClose, onSave }: { onClose: () => void; onSave: (a: Ajuste) => void }) {
  const [monto, setMonto] = useState('');
  const [de, setDe] = useState('efectivo');
  const [a, setA] = useState('tarjeta_pos_bac');
  const [nota, setNota] = useState('');
  const ok = Number(monto) > 0 && de !== a;

  return (
    <ModalOverlay onClose={onClose} title="Ajuste cruce de método">
      <div className="text-muted" style={{ fontSize: 11, marginBottom: 12 }}>
        Cuando un pago se registró con método incorrecto. Ej: cliente pagó con tarjeta pero se registró como efectivo.
      </div>
      <Field label="Monto del ajuste *">
        <input className="ki-input" type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
      </Field>
      <Field label="De método (donde está mal registrado)">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {METODOS.map((m) => (
            <button key={m.v} type="button" onClick={() => setDe(m.v)} className={`btn btn-sm ${de === m.v ? 'btn-danger' : 'btn-outline'}`}>{m.l}</button>
          ))}
        </div>
      </Field>
      <Field label="A método (donde debería estar)">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {METODOS.map((m) => (
            <button key={m.v} type="button" onClick={() => setA(m.v)} className={`btn btn-sm ${a === m.v ? 'btn-kaeru' : 'btn-outline'}`}>{m.l}</button>
          ))}
        </div>
      </Field>
      {de === a && <div className="text-warning" style={{ fontSize: 11, marginTop: 4 }}>Los métodos deben ser diferentes</div>}
      <Field label="Nota">
        <input className="ki-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: cliente pagó con tarjeta pero se registró como efectivo" />
      </Field>

      <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => onSave({ monto: Number(monto), de_metodo: de, a_metodo: a, nota: nota || null })}>Agregar</button>
      </div>
    </ModalOverlay>
  );
}

// ============================================================================
// Helpers UI
// ============================================================================
function ModalOverlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--r-lg)',
        padding: 20, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      <span className="card-title">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ background: 'var(--bg-inset)' }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="card-title">{title}</span>
        {action}
      </div>
      <div className="stack-sm">{children}</div>
    </div>
  );
}

function Row({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div className="row-between">
      <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {help && (
          <span title={help} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 14, borderRadius: '50%',
            border: '1px solid var(--border-default)', color: 'var(--text-muted)',
            fontSize: 9, fontWeight: 700, cursor: 'help', userSelect: 'none'
          }}>ⓘ</span>
        )}
      </span>
      <input type="number" step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-sm)', padding: '4px 8px', color: 'var(--text-primary)', fontSize: 13, width: 110, textAlign: 'right', fontFamily: 'monospace' }} />
    </div>
  );
}

function Total({ label, value, color = 'primary' }: { label: string; value: number; color?: string }) {
  return (
    <div className="row-between" style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
      <span className="card-title">{label}</span>
      <span style={{ fontWeight: 700, fontSize: 14 }} className={color === 'danger' ? 'text-danger' : color === 'kaeru' ? 'text-kaeru' : ''}>
        {formatUSD(value)}
      </span>
    </div>
  );
}

function Row2({ label, value, color = 'primary', bold }: { label: string; value: number; color?: string; bold?: boolean }) {
  return (
    <div className="row-between" style={{ padding: '2px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, fontSize: bold ? 14 : 12 }} className={
        color === 'danger' ? 'text-danger'
        : color === 'kaeru' ? 'text-kaeru'
        : color === 'warning' ? 'text-warning' : ''
      }>{formatUSD(value)}</span>
    </div>
  );
}

function LineItem({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  return (
    <div className="row" style={{ background: 'var(--bg-base)', padding: 8, borderRadius: 'var(--r-sm)', gap: 10 }}>
      {children}
      <button type="button" onClick={onDelete} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}>×</button>
    </div>
  );
}

function methodLabel(v: string) {
  return METODOS.find((m) => m.v === v)?.l ?? v;
}
