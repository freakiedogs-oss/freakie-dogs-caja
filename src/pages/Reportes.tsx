import { useEffect, useMemo, useState } from 'react';
import PageShell, { LoadingCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { formatUSD, formatDate } from '@/lib/utils';

// ============================================================
// /reportes — Libro de Ventas + Libro de Compras (formato MH)
// ------------------------------------------------------------
// Libro Ventas:
//   - Facturas (01) consumidor final → consolidado diario
//   - CCF (03) → línea por documento con NIT cliente
// Libro Compras:
//   - CCF (03) recibidos → IVA crédito fiscal
//   - Facturas (01) recibidas → gasto sin crédito fiscal
// ============================================================

type Tab = 'ventas' | 'compras' | 'f14';

interface VentaRow {
  id: string;
  fecha_hora: string;
  tipo_dte: string;
  subtotal: number;
  iva: number;
  total: number;
  numero_orden: number | null;
  codigo_generacion: string | null;
  canal: string;
}

interface CompraRow {
  id: string;
  fecha_emision: string | null;
  tipo_dte: string | null;
  numero_control: string | null;
  emisor_nit: string | null;
  emisor_nombre: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estado: string;
}

// MH tipo_dte → label corto (usado en CSV export y tablas)
const TIPO_DTE_COMPRA: Record<string, string> = {
  factura: '01 Factura',
  ccf: '03 CCF',
  nota_credito: '05 NC',
  nota_debito: '06 ND',
  factura_exportacion: '11 Export',
  sujeto_excluido: '14 Suj.Excl',
  comprobante_retencion: '20 Retención'
};

function getMesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number);
  const desde = `${y}-${String(m).padStart(2, '0')}-01`;
  const ultimo = new Date(y, m, 0).getDate();
  const hasta = `${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
  return { desde, hasta };
}

function descargarCSV(filename: string, rows: (string | number)[][]) {
  // Formato MH: ";" como separador, encabezado en row 0
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function Reportes() {
  const [tab, setTab] = useState<Tab>('ventas');
  const [mes, setMes] = useState<string>(getMesActual());

  return (
    <PageShell
      kanji="報"
      titulo="Reportes"
      subtitulo="Libros de Ventas y Compras formato MH El Salvador"
      badge={{ label: mes, variant: 'kaeru' }}
      actions={
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="ki-input"
          style={{ maxWidth: 180 }}
        />
      }
    >
      {/* Tabs */}
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setTab('ventas')}
          className={`btn btn-sm ${tab === 'ventas' ? 'btn-kaeru' : 'btn-outline'}`}
        >
          📒 Libro Ventas
        </button>
        <button
          onClick={() => setTab('compras')}
          className={`btn btn-sm ${tab === 'compras' ? 'btn-kaeru' : 'btn-outline'}`}
        >
          📕 Libro Compras
        </button>
        <button
          onClick={() => setTab('f14')}
          className={`btn btn-sm ${tab === 'f14' ? 'btn-kaeru' : 'btn-outline'}`}
        >
          🏛 F-14 IVA mensual
        </button>
      </div>

      {tab === 'ventas'  && <LibroVentas mes={mes} />}
      {tab === 'compras' && <LibroCompras mes={mes} />}
      {tab === 'f14'     && <F14Mensual mes={mes} />}
    </PageShell>
  );
}

// ============================================================
// LIBRO DE VENTAS
// ============================================================
function LibroVentas({ mes }: { mes: string }) {
  const [data, setData] = useState<VentaRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { desde, hasta } = rangoMes(mes);
      const { data: rows } = await kaeru
        .from('ventas')
        .select('id,fecha_hora,tipo_dte,subtotal,iva,total,numero_orden,codigo_generacion,canal')
        .gte('fecha_hora', `${desde}T00:00:00`)
        .lte('fecha_hora', `${hasta}T23:59:59`)
        .eq('estado', 'cerrada')
        .order('fecha_hora');
      if (cancel) return;
      setData((rows || []) as unknown as VentaRow[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mes]);

  // Agrupar facturas (01) por día
  const consolidadoDiario = useMemo(() => {
    const map = new Map<string, { fecha: string; cantidad: number; subtotal: number; iva: number; total: number }>();
    for (const v of data) {
      if (v.tipo_dte !== 'factura') continue;
      const fecha = v.fecha_hora.slice(0, 10);
      if (!map.has(fecha)) map.set(fecha, { fecha, cantidad: 0, subtotal: 0, iva: 0, total: 0 });
      const row = map.get(fecha)!;
      row.cantidad += 1;
      row.subtotal += Number(v.subtotal || 0);
      row.iva += Number(v.iva || 0);
      row.total += Number(v.total || 0);
    }
    return Array.from(map.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [data]);

  // CCFs detalle línea por línea
  const ccfs = useMemo(() => data.filter((v) => v.tipo_dte === 'ccf'), [data]);

  // Totales
  const totalFacturas = consolidadoDiario.reduce((s, r) => s + r.total, 0);
  const totalCCF = ccfs.reduce((s, c) => s + Number(c.total || 0), 0);
  const totalIVAFacturas = consolidadoDiario.reduce((s, r) => s + r.iva, 0);
  const totalIVACCF = ccfs.reduce((s, c) => s + Number(c.iva || 0), 0);
  const debitoFiscal = totalIVAFacturas + totalIVACCF;

  function exportarCSV() {
    const rows: (string | number)[][] = [
      ['LIBRO DE VENTAS — KAERU CHAN — ' + mes, '', '', '', '', '', ''],
      ['NIT: 0623-010725-109-7  ·  NRC: 366756-0', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['Fecha', 'Tipo', 'Documento', 'NIT Cliente', 'Subtotal', 'IVA', 'Total']
    ];
    for (const r of consolidadoDiario) {
      rows.push([
        r.fecha,
        '01 Factura (consol.)',
        `Resumen ${r.cantidad} fact.`,
        'Consumidor Final',
        r.subtotal.toFixed(2),
        r.iva.toFixed(2),
        r.total.toFixed(2)
      ]);
    }
    for (const c of ccfs) {
      rows.push([
        c.fecha_hora.slice(0, 10),
        '03 CCF',
        c.codigo_generacion || c.numero_orden || '',
        '', // NIT cliente (no lo tenemos guardado aún)
        Number(c.subtotal || 0).toFixed(2),
        Number(c.iva || 0).toFixed(2),
        Number(c.total || 0).toFixed(2)
      ]);
    }
    rows.push(['', '', '', 'TOTALES:', (consolidadoDiario.reduce((s, r) => s + r.subtotal, 0) + ccfs.reduce((s, c) => s + Number(c.subtotal || 0), 0)).toFixed(2), debitoFiscal.toFixed(2), (totalFacturas + totalCCF).toFixed(2)]);

    descargarCSV(`libro_ventas_kaeru_${mes}.csv`, rows);
  }

  if (loading) return <LoadingCard />;
  if (data.length === 0) return <EmptyCard message={`Sin ventas cerradas en ${mes}`} />;

  return (
    <>
      {/* KPIs */}
      <div className="card-grid card-grid-4">
        <div className="card">
          <div className="card-title">Facturas (01)</div>
          <div className="metric-xl text-kaeru">{formatUSD(totalFacturas)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{consolidadoDiario.reduce((s, r) => s + r.cantidad, 0)} docs</div>
        </div>
        <div className="card">
          <div className="card-title">CCF (03)</div>
          <div className="metric-xl text-purple">{formatUSD(totalCCF)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{ccfs.length} docs</div>
        </div>
        <div className="card">
          <div className="card-title">Débito fiscal (IVA)</div>
          <div className="metric-xl">{formatUSD(debitoFiscal)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>13% sobre gravadas</div>
        </div>
        <div className="card">
          <div className="card-title">Total ventas</div>
          <div className="metric-xl text-kaeru">{formatUSD(totalFacturas + totalCCF)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{data.length} transacciones</div>
        </div>
      </div>

      {/* Action: Export */}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={exportarCSV} className="btn btn-kaeru btn-sm">
          📥 Exportar CSV (formato MH)
        </button>
      </div>

      {/* Consolidado Diario (Facturas) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Resumen diario — Facturas consumidor final (01)</div>
          <span className="badge badge-muted">{consolidadoDiario.length} días</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}># Docs</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th style={{ textAlign: 'right' }}>IVA 13%</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {consolidadoDiario.map((r) => (
                <tr key={r.fecha}>
                  <td style={{ fontWeight: 700 }}>{formatDate(r.fecha)}</td>
                  <td style={{ textAlign: 'right' }}>{r.cantidad}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(r.subtotal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(r.iva)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(r.total)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--accent-kaeru)' }}>
                <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL FACTURAS</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(consolidadoDiario.reduce((s, r) => s + r.subtotal, 0))}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-purple)' }}>{formatUSD(totalIVAFacturas)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(totalFacturas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* CCFs detalle */}
      {ccfs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Detalle CCF (03) — emitidos a empresas</div>
            <span className="badge badge-purple">{ccfs.length} CCFs</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Documento</th>
                  <th>Canal</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>IVA</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ccfs.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.fecha_hora.slice(0, 10))}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{c.codigo_generacion?.slice(0, 8) || c.numero_orden || '—'}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 10 }}>{c.canal}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(c.subtotal)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(c.iva)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Notas formato MH</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          • <strong>Facturas (01)</strong> consumidor final se consolidan por día (un solo registro)<br />
          • <strong>CCF (03)</strong> requieren línea individual con NIT del cliente<br />
          • <strong>Débito fiscal</strong> = IVA total del mes a declarar a MH<br />
          • Periodo: día 1 al último del mes seleccionado<br />
          • CSV exportado en formato MH (separador `;`, encoding UTF-8 BOM)
        </div>
      </div>
    </>
  );
}

// ============================================================
// LIBRO DE COMPRAS
// ============================================================
function LibroCompras({ mes }: { mes: string }) {
  const [data, setData] = useState<CompraRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { desde, hasta } = rangoMes(mes);
      const { data: rows } = await kaeru
        .from('compras_dte')
        .select('id,fecha_emision,tipo_dte,numero_control,emisor_nit,emisor_nombre,subtotal,iva,total,estado')
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta)
        .not('estado', 'in', '("rechazada","duplicada")')
        .order('fecha_emision');
      if (cancel) return;
      setData((rows || []) as unknown as CompraRow[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mes]);

  // Separar por tipo: CCF (crédito fiscal) vs Factura/Sujeto excluido (gasto)
  const ccfs = useMemo(() => data.filter((c) => c.tipo_dte === 'ccf'), [data]);
  const facturas = useMemo(() => data.filter((c) => c.tipo_dte === 'factura'), [data]);
  const sujetoExcluido = useMemo(() => data.filter((c) => c.tipo_dte === 'sujeto_excluido'), [data]);
  const otros = useMemo(() => data.filter((c) => !['ccf', 'factura', 'sujeto_excluido'].includes(c.tipo_dte || '')), [data]);

  const totalCCF = ccfs.reduce((s, c) => s + Number(c.total || 0), 0);
  const totalFacturas = facturas.reduce((s, c) => s + Number(c.total || 0), 0);
  const totalSujetoExcluido = sujetoExcluido.reduce((s, c) => s + Number(c.total || 0), 0);
  const creditoFiscal = ccfs.reduce((s, c) => s + Number(c.iva || 0), 0);

  function exportarCSV() {
    const rows: (string | number)[][] = [
      ['LIBRO DE COMPRAS — KAERU CHAN — ' + mes, '', '', '', '', '', '', ''],
      ['NIT: 0623-010725-109-7  ·  NRC: 366756-0', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
      ['Fecha', 'Tipo', 'Documento', 'NIT Proveedor', 'Nombre', 'Subtotal', 'IVA', 'Total']
    ];
    // CCFs primero (los que dan crédito fiscal)
    for (const c of [...ccfs, ...facturas, ...sujetoExcluido, ...otros]) {
      rows.push([
        c.fecha_emision || '',
        TIPO_DTE_COMPRA[c.tipo_dte || ''] || c.tipo_dte || '',
        c.numero_control || '',
        c.emisor_nit || '',
        c.emisor_nombre || '',
        Number(c.subtotal || 0).toFixed(2),
        Number(c.iva || 0).toFixed(2),
        Number(c.total || 0).toFixed(2)
      ]);
    }
    const totalSub = data.reduce((s, c) => s + Number(c.subtotal || 0), 0);
    const totalIVA = data.reduce((s, c) => s + Number(c.iva || 0), 0);
    const totalGen = data.reduce((s, c) => s + Number(c.total || 0), 0);
    rows.push(['', '', '', '', 'TOTALES:', totalSub.toFixed(2), totalIVA.toFixed(2), totalGen.toFixed(2)]);
    rows.push(['', '', '', '', 'Crédito fiscal (solo CCF):', '', creditoFiscal.toFixed(2), '']);

    descargarCSV(`libro_compras_kaeru_${mes}.csv`, rows);
  }

  if (loading) return <LoadingCard />;
  if (data.length === 0) return <EmptyCard message={`Sin compras DTE en ${mes}`} />;

  return (
    <>
      {/* KPIs */}
      <div className="card-grid card-grid-4">
        <div className="card">
          <div className="card-title">CCF (crédito fiscal)</div>
          <div className="metric-xl text-kaeru">{formatUSD(totalCCF)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{ccfs.length} docs</div>
        </div>
        <div className="card">
          <div className="card-title">Crédito fiscal</div>
          <div className="metric-xl text-purple">{formatUSD(creditoFiscal)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>IVA deducible</div>
        </div>
        <div className="card">
          <div className="card-title">Facturas (gasto)</div>
          <div className="metric-xl">{formatUSD(totalFacturas + totalSujetoExcluido)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{facturas.length + sujetoExcluido.length} docs</div>
        </div>
        <div className="card">
          <div className="card-title">Total compras</div>
          <div className="metric-xl text-kaeru">{formatUSD(data.reduce((s, c) => s + Number(c.total || 0), 0))}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{data.length} DTEs</div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={exportarCSV} className="btn btn-kaeru btn-sm">
          📥 Exportar CSV (formato MH)
        </button>
      </div>

      {/* CCFs detalle */}
      {ccfs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">CCF recibidos (03) — con crédito fiscal</div>
            <span className="badge badge-kaeru">{ccfs.length} CCFs</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Documento</th>
                  <th>NIT</th>
                  <th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>IVA</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ccfs.map((c) => (
                  <tr key={c.id}>
                    <td>{c.fecha_emision && formatDate(c.fecha_emision)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{c.numero_control?.slice(-10) || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{c.emisor_nit}</td>
                    <td style={{ fontSize: 11 }}>{c.emisor_nombre || '?'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(c.subtotal)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(c.iva)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(c.total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--accent-kaeru)' }}>
                  <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL CCF</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(ccfs.reduce((s, c) => s + Number(c.subtotal || 0), 0))}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-purple)' }}>{formatUSD(creditoFiscal)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(totalCCF)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Facturas + Sujeto Excluido (sin crédito fiscal) */}
      {(facturas.length > 0 || sujetoExcluido.length > 0) && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Facturas / Sujeto excluido — gasto sin crédito fiscal</div>
            <span className="badge badge-muted">{facturas.length + sujetoExcluido.length} docs</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Documento</th>
                  <th>NIT</th>
                  <th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...facturas, ...sujetoExcluido].sort((a, b) => (a.fecha_emision || '').localeCompare(b.fecha_emision || '')).map((c) => (
                  <tr key={c.id}>
                    <td>{c.fecha_emision && formatDate(c.fecha_emision)}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 10 }}>{TIPO_DTE_COMPRA[c.tipo_dte || ''] || c.tipo_dte}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{c.numero_control?.slice(-10) || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{c.emisor_nit}</td>
                    <td style={{ fontSize: 11 }}>{c.emisor_nombre || '?'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {otros.length > 0 && (
        <div className="card" style={{ borderColor: 'rgba(231,76,60,0.3)' }}>
          <div className="card-title" style={{ color: 'var(--state-warning)', marginBottom: 8 }}>⚠ {otros.length} DTEs con tipo no clasificado</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {otros.map((o) => o.tipo_dte || '?').join(', ')}
          </div>
        </div>
      )}

      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Notas formato MH</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          • <strong>CCF (03)</strong> da derecho a crédito fiscal — restar del débito al pagar IVA<br />
          • <strong>Facturas (01)</strong> y <strong>sujeto excluido (14)</strong> son gasto puro, sin crédito fiscal<br />
          • <strong>Crédito fiscal del mes:</strong> {formatUSD(creditoFiscal)} — se resta del débito fiscal de ventas<br />
          • Periodo: día 1 al último del mes seleccionado<br />
          • DTEs en estado <em>rechazada</em> o <em>duplicada</em> se excluyen del libro
        </div>
      </div>
    </>
  );
}

// ============================================================
// F-14 — Declaración mensual de IVA (Hacienda El Salvador)
// ------------------------------------------------------------
// Llama al RPC kaeru.calc_f14(p_mes) que retorna fila única con:
//   - Débito fiscal (IVA de ventas factura + CCF)
//   - Crédito fiscal (IVA de compras CCF)
//   - Remanente anterior (saldo a favor acumulado)
//   - IVA del mes = débito - crédito - NC
//   - Saldo neto = IVA mes - remanente
// ============================================================
interface F14Row {
  mes: string;
  ventas_gravadas_subtotal: number;
  ventas_factura_subtotal: number;
  ventas_factura_iva: number;
  ventas_ccf_subtotal: number;
  ventas_ccf_iva: number;
  ventas_exportacion_subtotal: number;
  notas_credito_iva: number;
  debito_fiscal: number;
  compras_ccf_subtotal: number;
  credito_fiscal: number;
  compras_sin_cf_total: number;
  remanente_anterior: number;
  iva_a_pagar_mes: number;
  saldo_neto: number;
  resultado: string;
}

function F14Mensual({ mes }: { mes: string }) {
  const [data, setData] = useState<F14Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: rows, error: err } = await kaeru.rpc('calc_f14', { p_mes: mes });
      if (cancel) return;
      if (err) {
        setError(err.message);
        setData(null);
      } else {
        setData((Array.isArray(rows) && rows.length > 0 ? rows[0] : null) as F14Row | null);
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mes]);

  function exportarCSV() {
    if (!data) return;
    const rows: (string | number)[][] = [
      ['F-14 DECLARACIÓN MENSUAL IVA — KAERU CHAN', '', ''],
      ['NIT: 0623-010725-109-7  ·  NRC: 366756-0', '', ''],
      ['Mes', data.mes, ''],
      ['', '', ''],
      ['SECCIÓN A — VENTAS Y DÉBITO FISCAL', 'Subtotal', 'IVA'],
      ['Ventas a consumidor final (Factura 01)', data.ventas_factura_subtotal.toFixed(2), data.ventas_factura_iva.toFixed(2)],
      ['Ventas a contribuyente (CCF 03)',        data.ventas_ccf_subtotal.toFixed(2),     data.ventas_ccf_iva.toFixed(2)],
      ['Exportaciones (11)',                     data.ventas_exportacion_subtotal.toFixed(2), '0.00'],
      ['(−) Notas de crédito',                   '',                                       (-data.notas_credito_iva).toFixed(2)],
      ['DÉBITO FISCAL TOTAL',                    '',                                       data.debito_fiscal.toFixed(2)],
      ['', '', ''],
      ['SECCIÓN B — COMPRAS Y CRÉDITO FISCAL', 'Subtotal', 'IVA'],
      ['Compras con CCF',                        data.compras_ccf_subtotal.toFixed(2),    data.credito_fiscal.toFixed(2)],
      ['Compras sin CCF (gasto puro)',           data.compras_sin_cf_total.toFixed(2),    '0.00'],
      ['CRÉDITO FISCAL TOTAL',                   '',                                       data.credito_fiscal.toFixed(2)],
      ['', '', ''],
      ['SECCIÓN C — CÁLCULO', '', 'USD'],
      ['IVA del mes (débito − crédito − NC)',    '',                                       data.iva_a_pagar_mes.toFixed(2)],
      ['(−) Remanente meses anteriores',         '',                                       (-data.remanente_anterior).toFixed(2)],
      ['SALDO NETO',                             '',                                       data.saldo_neto.toFixed(2)],
      ['RESULTADO',                              '',                                       data.resultado]
    ];
    const csv = rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `F14_kaeru_${mes}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingCard />;
  if (error) {
    return (
      <div className="card">
        <div className="card-title text-danger">Error al calcular F-14</div>
        <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Si dice "function calc_f14 does not exist", aplicá la migración{' '}
          <code>20260521_f14_iva_mensual.sql</code> a Supabase.
        </div>
      </div>
    );
  }
  if (!data) return <EmptyCard message={`Sin movimientos en ${mes} para calcular F-14`} />;

  const aPagar = data.saldo_neto > 0;
  const aFavor = data.saldo_neto < 0;

  return (
    <>
      {/* KPI resultado destacado */}
      <div className="card" style={{
        borderLeft: `4px solid ${aPagar ? 'var(--state-danger, #e74c3c)' : aFavor ? 'var(--accent-kaeru)' : 'var(--text-muted)'}`,
        marginBottom: 12
      }}>
        <div className="row-between">
          <div>
            <div className="card-title">Resultado F-14 · {data.mes}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{data.resultado}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="metric-xl" style={{ color: aPagar ? 'var(--state-danger)' : aFavor ? 'var(--accent-kaeru)' : 'var(--text-primary)' }}>
              {formatUSD(Math.abs(data.saldo_neto))}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {aPagar ? 'a pagar a MH' : aFavor ? 'remanente a favor' : 'en cero'}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="card-grid card-grid-4">
        <div className="card">
          <div className="card-title">Débito fiscal</div>
          <div className="metric-xl text-purple">{formatUSD(data.debito_fiscal)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>IVA cobrado a clientes</div>
        </div>
        <div className="card">
          <div className="card-title">Crédito fiscal</div>
          <div className="metric-xl text-kaeru">{formatUSD(data.credito_fiscal)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>IVA pagado a proveedores (CCF)</div>
        </div>
        <div className="card">
          <div className="card-title">Notas de crédito</div>
          <div className="metric-xl">{formatUSD(data.notas_credito_iva)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>se restan del débito</div>
        </div>
        <div className="card">
          <div className="card-title">Remanente anterior</div>
          <div className="metric-xl text-kaeru">{formatUSD(data.remanente_anterior)}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>acumulado meses previos</div>
        </div>
      </div>

      {/* Action */}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={exportarCSV} className="btn btn-kaeru btn-sm">
          📥 Exportar F-14 CSV (formato MH)
        </button>
      </div>

      {/* Sección A — VENTAS */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">SECCIÓN A — Ventas y débito fiscal</div>
          <span className="badge badge-purple">Débito {formatUSD(data.debito_fiscal)}</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th style={{ textAlign: 'right' }}>Subtotal</th>
              <th style={{ textAlign: 'right' }}>IVA 13%</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ventas consumidor final (Factura 01)</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.ventas_factura_subtotal)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(data.ventas_factura_iva)}</td>
            </tr>
            <tr>
              <td>Ventas a contribuyente (CCF 03)</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.ventas_ccf_subtotal)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(data.ventas_ccf_iva)}</td>
            </tr>
            {data.ventas_exportacion_subtotal > 0 && (
              <tr>
                <td>Exportaciones (11) — gravadas al 0%</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.ventas_exportacion_subtotal)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>$0.00</td>
              </tr>
            )}
            {data.notas_credito_iva > 0 && (
              <tr>
                <td>(−) Notas de crédito (05)</td>
                <td></td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--state-danger)' }}>−{formatUSD(data.notas_credito_iva)}</td>
              </tr>
            )}
            <tr style={{ borderTop: '2px solid var(--accent-purple)' }}>
              <td style={{ fontWeight: 700 }}>DÉBITO FISCAL TOTAL</td>
              <td></td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, fontSize: 16, color: 'var(--accent-purple)' }}>
                {formatUSD(data.debito_fiscal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sección B — COMPRAS */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">SECCIÓN B — Compras y crédito fiscal</div>
          <span className="badge badge-kaeru">Crédito {formatUSD(data.credito_fiscal)}</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th style={{ textAlign: 'right' }}>Subtotal</th>
              <th style={{ textAlign: 'right' }}>IVA crédito fiscal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Compras con CCF (03)</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.compras_ccf_subtotal)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)' }}>{formatUSD(data.credito_fiscal)}</td>
            </tr>
            <tr>
              <td>Compras sin CCF (gasto puro, sin crédito)</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.compras_sin_cf_total)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--text-muted)' }}>$0.00</td>
            </tr>
            <tr style={{ borderTop: '2px solid var(--accent-kaeru)' }}>
              <td style={{ fontWeight: 700 }}>CRÉDITO FISCAL TOTAL</td>
              <td></td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, fontSize: 16, color: 'var(--accent-kaeru)' }}>
                {formatUSD(data.credito_fiscal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sección C — CÁLCULO */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">SECCIÓN C — Cálculo IVA del mes</div>
        </div>
        <table className="table">
          <tbody>
            <tr>
              <td>Débito fiscal</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(data.debito_fiscal)}</td>
            </tr>
            <tr>
              <td>(−) Crédito fiscal</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--state-danger)' }}>−{formatUSD(data.credito_fiscal)}</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border-default)' }}>
              <td style={{ fontWeight: 600 }}>= IVA del mes</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 600 }}>{formatUSD(data.iva_a_pagar_mes)}</td>
            </tr>
            <tr>
              <td>(−) Remanente meses anteriores</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)' }}>−{formatUSD(data.remanente_anterior)}</td>
            </tr>
            <tr style={{ borderTop: `2px solid ${aPagar ? 'var(--state-danger)' : 'var(--accent-kaeru)'}` }}>
              <td style={{ fontWeight: 700, fontSize: 14 }}>SALDO NETO</td>
              <td style={{
                textAlign: 'right',
                fontFamily: 'var(--font-metric)',
                fontWeight: 700,
                fontSize: 18,
                color: aPagar ? 'var(--state-danger)' : aFavor ? 'var(--accent-kaeru)' : 'var(--text-primary)'
              }}>
                {data.saldo_neto < 0 ? '−' : ''}{formatUSD(Math.abs(data.saldo_neto))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Notas F-14 Hacienda El Salvador</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          • <strong>F-14</strong> es la declaración mensual de IVA que se presenta a MH a más tardar el día <strong>10 del mes siguiente</strong><br />
          • <strong>Débito fiscal</strong> = IVA cobrado en facturas (01) + CCFs (03) − notas de crédito (05)<br />
          • <strong>Crédito fiscal</strong> = IVA pagado solamente en CCFs recibidos (03). Facturas y sujeto excluido (14) NO dan crédito.<br />
          • Si <strong>débito &gt; crédito</strong> → pagás la diferencia<br />
          • Si <strong>crédito &gt; débito</strong> → el saldo queda como remanente para el siguiente mes<br />
          • Este reporte se construye desde <code>kaeru.calc_f14('{mes}')</code>. Validá contra el cálculo de tu contador antes de presentar.
        </div>
      </div>
    </>
  );
}
