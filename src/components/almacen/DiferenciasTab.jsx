import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip';
import { n } from '../../config';
import { useToast } from '../../hooks/useToast';

// Dashboard de fugas del inventario.
//
// La idea: separar lo que hoy se ve todo igual. Un faltante puede ser merma
// (se botó), robo, o un error del sistema. El kardex ya los distingue por
// TIPO de movimiento, así que acá se muestran separados:
//   · conteo_fisico → lo que apareció al contar. Acá vive la merma y el robo.
//   · merma         → lo que alguien declaró a propósito que se botó.
//   · ajuste_manual → lo que alguien corrigió a mano. Puede tapar cualquiera
//                     de las dos, por eso se mira con lupa y con su autor.
//
// Y ADEMÁS por CLASE de producto (catalogo_productos.conteo_clase), porque
// mezclarlas escondía las fugas de verdad entre los guantes y las servilletas:
//   · venta           → insumos de comida enlazados a la venta. Un faltante
//                       acá ES una fuga: merma, robo o error. 26 productos.
//   · consumo_interno → limpieza, empaques, papelería. Se GASTAN operando:
//                       un faltante acá es uso normal, no robo. Lo que se
//                       vigila es si una sucursal gasta más de lo que su
//                       volumen de venta justifica (índice de eficiencia).
//                       70 de los 96 productos del conteo son de esta clase.

const CLASES = [
  { id: 'venta',           label: 'Fugas reales',    color: '#e63946' },
  { id: 'consumo_interno', label: 'Consumo interno', color: '#f4a261' },
];

const TIPOS = [
  { id: null,             label: 'Todo',          color: '#8b8794' },
  { id: 'conteo_fisico',  label: 'Conteos',       color: '#f4a261' },
  { id: 'merma',          label: 'Merma',         color: '#e63946' },
  { id: 'ajuste_manual',  label: 'Ajustes',       color: '#4a9eff' },
];

const RANGOS = [
  { d: 7,  label: '7 días'  },
  { d: 30, label: '30 días' },
  { d: 90, label: '90 días' },
];

const usd = (v) => '$' + n(v).toFixed(2);
const fechaCorta = (f) => {
  // El backend manda 'YYYY-MM-DD'. Se parte a mano en vez de usar new Date(f),
  // que en Safari/iOS interpreta la fecha como UTC y la corre un día.
  const [a, m, d] = String(f || '').split('-');
  return d && m ? `${d}/${m}` : (f || '');
};

export default function DiferenciasTab() {
  const { show } = useToast();
  const [dias, setDias]           = useState(30);
  const [sucursales, setSucs]     = useState([]);
  const [sucursal, setSucursal]   = useState(null);
  const [clase, setClase]         = useState('venta');
  const [tipo, setTipo]           = useState(null);
  const [resumen, setResumen]     = useState([]);
  const [detalle, setDetalle]     = useState([]);
  const [eficiencia, setEfic]     = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [verDetalle, setVerDet]   = useState(false);

  useEffect(() => {
    db.from('sucursales').select('id,nombre,store_code').eq('activa', true)
      .order('nombre')
      .then(({ data }) => setSucs(data || []))
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const hasta = new Date();
      const desde = new Date(Date.now() - dias * 86400000);
      const iso = (d) => d.toISOString().slice(0, 10);
      const params = { p_desde: iso(desde), p_hasta: iso(hasta), p_sucursal_id: sucursal };

      const [{ data: res, error: e1 }, { data: det, error: e2 }, { data: efi, error: e3 }] = await Promise.all([
        db.rpc('kardex_diferencias_resumen', params),
        db.rpc('kardex_diferencias_detalle', { ...params, p_tipo: tipo }),
        db.rpc('kardex_consumo_eficiencia', { p_desde: params.p_desde, p_hasta: params.p_hasta }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      // El backend manda `clase` por fila ('venta' si el producto no está
      // clasificado, para no esconder una fuga por omisión); acá solo se filtra.
      setResumen((res || []).filter(r => r.clase === clase && (!tipo || r.tipo === tipo)));
      setDetalle((det || []).filter(d => d.clase === clase));
      setEfic(efi || []);
    } catch (e) {
      show?.('No se pudo cargar el dashboard: ' + e.message, 'error');
    } finally {
      setCargando(false);
    }
  }, [dias, sucursal, clase, tipo, show]);

  useEffect(() => { cargar(); }, [cargar]);

  // Totales del período
  const tot = resumen.reduce((a, r) => ({
    sobrante:     a.sobrante     + n(r.sobrante),
    faltante:     a.faltante     + n(r.faltante),
    sobranteUsd:  a.sobranteUsd  + n(r.sobrante_usd),
    faltanteUsd:  a.faltanteUsd  + n(r.faltante_usd),
    sinCosto:     Math.max(a.sinCosto, n(r.productos_sin_costo)),
  }), { sobrante: 0, faltante: 0, sobranteUsd: 0, faltanteUsd: 0, sinCosto: 0 });

  const netoUsd = tot.sobranteUsd - tot.faltanteUsd;

  // Ranking de sucursales por faltante, que es donde hay que ir a mirar
  const porSucursal = Object.values(
    resumen.reduce((acc, r) => {
      const k = r.sucursal;
      if (!acc[k]) acc[k] = { sucursal: k, faltante: 0, sobrante: 0, faltanteUsd: 0, dias: new Set() };
      acc[k].faltante    += n(r.faltante);
      acc[k].sobrante    += n(r.sobrante);
      acc[k].faltanteUsd += n(r.faltante_usd);
      acc[k].dias.add(r.fecha);
      return acc;
    }, {})
  ).sort((a, b) => (b.faltanteUsd - a.faltanteUsd) || (b.faltante - a.faltante));

  const vacio = !cargando && resumen.length === 0;
  const esConsumo = clase === 'consumo_interno';

  // Índice de eficiencia (solo consumo interno): compara el % del consumo
  // interno de cada sucursal contra el % de su venta. El volumen de venta se
  // aproxima con las libras de carne de hamburguesa que descontó el kardex
  // (método de la auditoría 22-ago). Se mide en UNIDADES y no en dólares
  // porque la mayoría de estos productos aún no tiene precio cargado.
  //   índice 1.00 = gasta exactamente lo que su venta justifica
  //   índice 2.00 = gasta el doble de lo que le toca por volumen
  const efiOrdenada = [...eficiencia].sort((a, b) => n(b.indice) - n(a.indice));

  return (
    <div>
      {/* ── Filtros ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {CLASES.map(c => (
            <button key={c.id} onClick={() => setClase(c.id)}
              style={pill(clase === c.id, c.color)}>{c.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {RANGOS.map(r => (
            <button key={r.d} onClick={() => setDias(r.d)}
              style={pill(dias === r.d, '#e63946')}>{r.label}</button>
          ))}
        </div>

        <select value={sucursal || ''} onChange={e => setSucursal(e.target.value || null)}
          style={{ background: '#1a1a22', color: '#ddd', border: '1px solid #333',
                   borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 4 }}>
          {TIPOS.map(t => (
            <button key={t.label} onClick={() => setTipo(t.id)}
              style={pill(tipo === t.id, t.color)}>{t.label}</button>
          ))}
        </div>

        <InfoTip text={
          'Fugas reales = insumos de comida enlazados a la venta: un faltante ahí es merma, robo o error. ' +
          'Consumo interno = limpieza, empaques y papelería que se GASTAN operando: su faltante es uso normal ' +
          'y lo que se vigila es si una sucursal gasta más de lo que su venta justifica. ' +
          'Faltante = el sistema decía más de lo que había. ' +
          'Sobrante = había más de lo que el sistema decía, casi siempre una entrada que no se registró. ' +
          'Los conteos son lo que aparece al contar; los ajustes manuales son correcciones a mano y ' +
          'conviene revisarlos porque pueden tapar cualquiera de las dos cosas. ' +
          'La clase de cada producto se puede cambiar desde el editor del catálogo (tab Inventario).'
        } />

        <button onClick={cargar} disabled={cargando}
          style={{ marginLeft: 'auto', background: '#222', color: '#aaa', border: '1px solid #333',
                   borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {/* ── Tarjetas de totales ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                    gap: 10, marginBottom: 16 }}>
        <Tarjeta titulo={esConsumo ? 'Consumido' : 'Faltante'} color="#e63946"
          valor={usd(tot.faltanteUsd)} sub={`${n(tot.faltante).toFixed(0)} unidades`} />
        <Tarjeta titulo="Sobrante" color="#2dd4a8"
          valor={usd(tot.sobranteUsd)} sub={`${n(tot.sobrante).toFixed(0)} unidades`} />
        <Tarjeta titulo="Neto" color={netoUsd < 0 ? '#e63946' : '#2dd4a8'}
          valor={usd(Math.abs(netoUsd))}
          sub={netoUsd < 0 ? 'en contra' : 'a favor'} />
      </div>

      {/* Honestidad sobre la valorización: sin esto, un producto caro sin
          precio se vería como $0 y parecería que no pasó nada. */}
      {tot.sinCosto > 0 && (
        <div style={{ background: 'rgba(244,162,97,0.10)', border: '1px solid rgba(244,162,97,0.3)',
                      borderRadius: 8, padding: '8px 12px', marginBottom: 16,
                      fontSize: 12, color: '#f4a261' }}>
          ⚠️ Hay productos sin precio registrado: sus diferencias cuentan en unidades
          pero valen <b>$0.00</b> en los montos de arriba. El monto real es mayor.
        </div>
      )}

      {vacio && (
        <div style={{ textAlign: 'center', padding: '30px 16px', color: '#6b6878', fontSize: 13 }}>
          Todavía no hay diferencias registradas en este período.<br />
          <span style={{ fontSize: 12 }}>
            Se llenan solas conforme se hagan conteos nocturnos e inventarios físicos.
          </span>
        </div>
      )}

      {/* ── Índice de eficiencia por sucursal (solo consumo interno) ──
          El ranking por $ engañaría acá: 60 de los 70 productos de consumo
          interno todavía no tienen precio, así que se compara el reparto del
          consumo (en unidades) contra el reparto de la venta. */}
      {esConsumo && efiOrdenada.length > 0 && (
        <>
          <h3 style={tituloSec}>
            Eficiencia por sucursal
            <span style={{ color: '#6b6878', fontWeight: 400, fontSize: 12 }}> · % del consumo vs % de la venta</span>
            <InfoTip text={
              'Cada sucursal debería gastar consumo interno en proporción a lo que vende. ' +
              'Índice = su % del consumo interno (en unidades) dividido entre su % de la venta ' +
              '(volumen aproximado con las libras de carne de hamburguesa descontadas por el kardex). ' +
              '1.00 = gasta justo lo que su venta justifica; 2.00 = gasta el doble de lo que le toca. ' +
              'Se mide en unidades porque la mayoría de estos productos aún no tiene precio cargado.'
            } />
          </h3>
          <div style={{ marginBottom: 18 }}>
            {efiOrdenada.map(s => {
              const idx = n(s.indice);
              const max = Math.max(n(efiOrdenada[0]?.indice), 1) || 1;
              const color = idx > 1.15 ? '#e63946' : idx < 0.85 ? '#2dd4a8' : '#f4a261';
              return (
                <div key={s.sucursal_id} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ color: '#ddd', fontWeight: 600 }}>{s.sucursal}</span>
                    <span style={{ color, fontWeight: 700 }}>
                      {idx > 0 ? idx.toFixed(2) + '×' : 'sin datos'}
                      <span style={{ color: '#6b6878', fontWeight: 400, marginLeft: 6 }}>
                        {n(s.pct_consumo).toFixed(1)}% del consumo · {n(s.pct_venta).toFixed(1)}% de la venta
                      </span>
                    </span>
                  </div>
                  <div style={{ height: 6, background: '#1a1a22', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                    <div style={{ width: Math.min(100, (idx / max) * 100) + '%', height: '100%', background: color }} />
                    {/* marca del 1.00 = gasto proporcional a la venta */}
                    <div style={{ position: 'absolute', left: Math.min(100, (1 / max) * 100) + '%', top: 0,
                                  width: 1, height: '100%', background: '#6b6878' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Ranking por sucursal (fugas reales: dónde ir a mirar primero) ── */}
      {!esConsumo && porSucursal.length > 0 && (
        <>
          <h3 style={tituloSec}>Por sucursal <span style={{ color: '#6b6878', fontWeight: 400, fontSize: 12 }}>· dónde ir a mirar primero</span></h3>
          <div style={{ marginBottom: 18 }}>
            {porSucursal.map(s => {
              const max = porSucursal[0].faltanteUsd || porSucursal[0].faltante || 1;
              const pct = Math.min(100, ((s.faltanteUsd || s.faltante) / max) * 100);
              return (
                <div key={s.sucursal} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ color: '#ddd', fontWeight: 600 }}>{s.sucursal}</span>
                    <span style={{ color: '#e63946', fontWeight: 700 }}>
                      {usd(s.faltanteUsd)}
                      <span style={{ color: '#6b6878', fontWeight: 400, marginLeft: 6 }}>
                        {s.faltante.toFixed(0)} u · {s.dias.size} día{s.dias.size !== 1 ? 's' : ''}
                      </span>
                    </span>
                  </div>
                  <div style={{ height: 6, background: '#1a1a22', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: pct + '%', height: '100%', background: '#e63946' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Evolución por fecha ── */}
      {resumen.length > 0 && (
        <>
          <h3 style={tituloSec}>Por fecha</h3>
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: '#6b6878', textAlign: 'left' }}>
                  <th style={th}>Fecha</th><th style={th}>Sucursal</th><th style={th}>Tipo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Faltante</th>
                  <th style={{ ...th, textAlign: 'right' }}>Sobrante</th>
                  <th style={{ ...th, textAlign: 'right' }}>Neto</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #222' }}>
                    <td style={td}>{fechaCorta(r.fecha)}</td>
                    <td style={{ ...td, color: '#bbb' }}>{r.sucursal}</td>
                    <td style={td}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        background: (TIPOS.find(t => t.id === r.tipo)?.color || '#666') + '22',
                        color: TIPOS.find(t => t.id === r.tipo)?.color || '#888' }}>
                        {TIPOS.find(t => t.id === r.tipo)?.label || r.tipo}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#e63946' }}>
                      {n(r.faltante) > 0 ? `${usd(r.faltante_usd)} · ${n(r.faltante).toFixed(0)}u` : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#2dd4a8' }}>
                      {n(r.sobrante) > 0 ? `${usd(r.sobrante_usd)} · ${n(r.sobrante).toFixed(0)}u` : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                                 color: n(r.neto_usd) < 0 ? '#e63946' : '#2dd4a8' }}>
                      {usd(r.neto_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Detalle producto por producto ── */}
      {detalle.length > 0 && (
        <>
          <h3 style={{ ...tituloSec, cursor: 'pointer' }} onClick={() => setVerDet(v => !v)}>
            {verDetalle ? '▾' : '▸'} Producto por producto
            <span style={{ color: '#6b6878', fontWeight: 400, fontSize: 12 }}> · {detalle.length} movimientos, del más caro al más barato</span>
          </h3>
          {verDetalle && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: '#6b6878', textAlign: 'left' }}>
                    <th style={th}>Fecha</th><th style={th}>Producto</th><th style={th}>Sucursal</th>
                    <th style={{ ...th, textAlign: 'right' }}>Cant.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th style={th}>Quién</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((d, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #222' }}>
                      <td style={td}>{fechaCorta(d.fecha)}</td>
                      <td style={{ ...td, color: '#ddd' }}>
                        {d.producto}
                        {d.sin_costo && (
                          <span title="Este producto no tiene precio registrado, así que su valor sale en $0"
                                style={{ marginLeft: 5, fontSize: 10, color: '#f4a261' }}>sin precio</span>
                        )}
                      </td>
                      <td style={{ ...td, color: '#999' }}>{d.sucursal}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                                   color: n(d.cantidad) < 0 ? '#e63946' : '#2dd4a8' }}>
                        {n(d.cantidad) > 0 ? '+' : ''}{n(d.cantidad).toFixed(2)} {d.unidad || ''}
                      </td>
                      <td style={{ ...td, textAlign: 'right',
                                   color: n(d.valor_usd) < 0 ? '#e63946' : '#2dd4a8' }}>
                        {usd(d.valor_usd)}
                      </td>
                      <td style={{ ...td, color: d.usuario === '(sin usuario)' ? '#f4a261' : '#999' }}>
                        {d.usuario}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── estilos ──
const pill = (activo, color) => ({
  background: activo ? color : '#1a1a22',
  color: activo ? '#fff' : '#8b8794',
  border: '1px solid ' + (activo ? color : '#333'),
  borderRadius: 8, padding: '6px 11px', fontSize: 12.5,
  fontWeight: activo ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
});
const tituloSec = { fontSize: 13, fontWeight: 800, color: '#ddd', margin: '0 0 10px' };
const th = { padding: '6px 8px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3px' };
const td = { padding: '7px 8px', color: '#aaa' };

function Tarjeta({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: '#14141b', border: '1px solid #262630',
                  borderLeft: '3px solid ' + color, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 10.5, color: '#6b6878', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.4px' }}>{titulo}</div>
      <div style={{ fontSize: 21, fontWeight: 900, color, marginTop: 3 }}>{valor}</div>
      <div style={{ fontSize: 11.5, color: '#6b6878', marginTop: 1 }}>{sub}</div>
    </div>
  );
}
