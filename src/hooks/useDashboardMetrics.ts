import { useEffect, useState } from 'react';
import { kaeru } from '@/lib/supabase';

// ============================================================
// useDashboardMetrics v2 (v0.14.0)
// Agrega: comparativo mes-vs-mes, utilidad neta, sparkline 30 días,
// breakdown por canal con %, próximos eventos calendarizados.
// ============================================================

export interface DashboardMetrics {
  ultimoDia: {
    fecha: string | null;
    total: number;
    mesa: number;
    peya: number;
    tickets: number;
  };
  mtd: {
    total: number;
    dias_operados: number;
    promedio_diario: number;
    tickets: number;
    mesa: number;
    peya: number;
    pct_mesa: number;
    pct_peya: number;
  };
  mesAnterior: {
    mes: string;             // 'YYYY-MM'
    total: number;
    dias_operados: number;
    promedio_diario: number;
    delta_total_pct: number; // % cambio MTD vs mes anterior completo
    delta_avg_pct: number;
  };
  utilidad: {
    mes: string;
    ventas_total: number;
    ingreso_neto: number;
    cogs: number;
    planilla: number;
    renta: number;
    depreciacion: number;
    utilidad_neta: number;
    margen_pct: number;
    delta_pct: number;       // vs mes anterior
  };
  hoy: {
    tickets: number;
    total: number;
    ticket_promedio: number;
  };
  propinasSemana: {
    total: number;
    desde: string | null;
    hasta: string | null;
  };
  ultimos7: Array<{ fecha: string; mesa: number; peya: number; total: number }>;
  sparkline30: number[];     // Total venta por día últimos 30
  topProductos: Array<{ codigo: string; nombre: string; vendidos: number; revenue: number }>;
  proximosEventos: Array<{ fecha: string; titulo: string; emoji: string; tipo: 'planilla' | 'fiscal' | 'cierre' }>;
  loading: boolean;
  error: string | null;
}

const empty: DashboardMetrics = {
  ultimoDia: { fecha: null, total: 0, mesa: 0, peya: 0, tickets: 0 },
  mtd: { total: 0, dias_operados: 0, promedio_diario: 0, tickets: 0, mesa: 0, peya: 0, pct_mesa: 0, pct_peya: 0 },
  mesAnterior: { mes: '', total: 0, dias_operados: 0, promedio_diario: 0, delta_total_pct: 0, delta_avg_pct: 0 },
  utilidad: { mes: '', ventas_total: 0, ingreso_neto: 0, cogs: 0, planilla: 0, renta: 0, depreciacion: 0, utilidad_neta: 0, margen_pct: 0, delta_pct: 0 },
  hoy: { tickets: 0, total: 0, ticket_promedio: 0 },
  propinasSemana: { total: 0, desde: null, hasta: null },
  ultimos7: [],
  sparkline30: [],
  topProductos: [],
  proximosEventos: [],
  loading: true,
  error: null
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

const startOfWeekMonday = (d: Date) => {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
};

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function calcProximosEventos(now: Date): DashboardMetrics['proximosEventos'] {
  const eventos: DashboardMetrics['proximosEventos'] = [];
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const dia = now.getDate();

  // Cierre POS BAC: cada día a las 22:00 → si pasaron las 22h, mañana
  const hora = now.getHours();
  const cierreFecha = hora >= 22
    ? new Date(yyyy, mm, dia + 1).toISOString().slice(0, 10)
    : now.toISOString().slice(0, 10);
  eventos.push({ fecha: cierreFecha, titulo: 'Cierre POS BAC', emoji: '🔒', tipo: 'cierre' });

  // Planilla días 1 y 16
  if (dia < 1) eventos.push({ fecha: `${yyyy}-${String(mm + 1).padStart(2, '0')}-01`, titulo: 'Planilla 1Q', emoji: '👥', tipo: 'planilla' });
  if (dia < 16) eventos.push({ fecha: `${yyyy}-${String(mm + 1).padStart(2, '0')}-16`, titulo: 'Planilla 2Q', emoji: '👥', tipo: 'planilla' });
  // Próximo día 1 del mes siguiente
  const proxMes1 = new Date(yyyy, mm + 1, 1);
  eventos.push({ fecha: fmtDate(proxMes1), titulo: 'Planilla 1Q (mes próx)', emoji: '👥', tipo: 'planilla' });

  // F-14 IVA: día 10 del mes siguiente
  const f14 = new Date(yyyy, mm + 1, 10);
  eventos.push({ fecha: fmtDate(f14), titulo: 'F-14 IVA mensual MH', emoji: '🏛', tipo: 'fiscal' });

  // Liquidación PeYa: próximo viernes
  const proxViernes = new Date(now);
  const daysToFriday = (5 - now.getDay() + 7) % 7 || 7;
  proxViernes.setDate(now.getDate() + daysToFriday);
  eventos.push({ fecha: fmtDate(proxViernes), titulo: 'Liquidación PeYa', emoji: '🛵', tipo: 'cierre' });

  // Propinas martes
  const proxMartes = new Date(now);
  const daysToTuesday = (2 - now.getDay() + 7) % 7 || 7;
  proxMartes.setDate(now.getDate() + daysToTuesday);
  eventos.push({ fecha: fmtDate(proxMartes), titulo: 'Pago propinas', emoji: '💵', tipo: 'cierre' });

  return eventos.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 6);
}

export function useDashboardMetrics(): DashboardMetrics {
  const [data, setData] = useState<DashboardMetrics>(empty);

  useEffect(() => {
    let cancel = false;

    async function load() {
      try {
        const now = new Date();
        const hoyStr = fmtDate(now);
        const mtdStart = `${ymOf(now)}-01`;
        const mesActual = ymOf(now);

        // Mes anterior (rangos)
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // último día del mes anterior
        const mesAnt = ymOf(prevMonth);
        const prevStart = `${mesAnt}-01`;
        const prevEnd = fmtDate(prevMonthEnd);

        const hace7 = new Date(now); hace7.setDate(now.getDate() - 6);
        const hace30 = new Date(now); hace30.setDate(now.getDate() - 29);
        const lunes = startOfWeekMonday(now);
        const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);

        // ─── Queries en paralelo ─────────────────────────────────
        const [
          lastDayRes,
          mtdRes,
          prevMonthRes,
          hoyRes,
          tipRes,
          weekRes,
          last30Res,
          topRes,
          rentMesRes,
          rentPrevRes
        ] = await Promise.all([
          kaeru.from('ventas').select('fecha_hora').neq('estado', 'anulada').order('fecha_hora', { ascending: false }).limit(1),
          kaeru.from('ventas').select('total,canal,fecha_hora').neq('estado', 'anulada').gte('fecha_hora', `${mtdStart}T00:00:00`),
          kaeru.from('ventas').select('total,fecha_hora').neq('estado', 'anulada').gte('fecha_hora', `${prevStart}T00:00:00`).lte('fecha_hora', `${prevEnd}T23:59:59`),
          kaeru.from('ventas').select('total').neq('estado', 'anulada').gte('fecha_hora', `${hoyStr}T00:00:00`).lt('fecha_hora', `${hoyStr}T23:59:59`),
          kaeru.from('ventas').select('propina').neq('estado', 'anulada').gte('fecha_hora', `${fmtDate(lunes)}T00:00:00`).lt('fecha_hora', `${fmtDate(domingo)}T23:59:59`),
          kaeru.from('ventas').select('fecha_hora,total,canal').neq('estado', 'anulada').gte('fecha_hora', `${fmtDate(hace7)}T00:00:00`),
          kaeru.from('ventas').select('fecha_hora,total').neq('estado', 'anulada').gte('fecha_hora', `${fmtDate(hace30)}T00:00:00`),
          kaeru.from('venta_detalles').select('cantidad,subtotal,producto_id,productos:producto_id(codigo,nombre),ventas:venta_id!inner(fecha_hora,estado)').gte('ventas.fecha_hora', `${mtdStart}T00:00:00`).neq('ventas.estado', 'anulada').limit(5000),
          kaeru.from('v_rentabilidad_mensual').select('*').eq('mes', mesActual).maybeSingle(),
          kaeru.from('v_rentabilidad_mensual').select('utilidad_neta,ventas_total').eq('mes', mesAnt).maybeSingle()
        ]);

        // ─── ÚLTIMO DÍA ────────────────────────────────────────────
        const ultimaFecha = (lastDayRes.data?.[0] as any)?.fecha_hora?.slice(0, 10) ?? null;
        let ultimoDia = { fecha: null as string | null, total: 0, mesa: 0, peya: 0, tickets: 0 };
        if (ultimaFecha) {
          const { data: rows } = await kaeru.from('ventas').select('total,canal').neq('estado', 'anulada')
            .gte('fecha_hora', `${ultimaFecha}T00:00:00`).lt('fecha_hora', `${ultimaFecha}T23:59:59`);
          const r = (rows || []) as any[];
          ultimoDia = {
            fecha: ultimaFecha,
            total: r.reduce((s, x) => s + Number(x.total || 0), 0),
            mesa:  r.filter((x) => x.canal === 'mesa').reduce((s, x) => s + Number(x.total || 0), 0),
            peya:  r.filter((x) => x.canal === 'peya').reduce((s, x) => s + Number(x.total || 0), 0),
            tickets: r.length
          };
        }

        // ─── MTD + breakdown canal ────────────────────────────────
        const mtdR = (mtdRes.data || []) as any[];
        const diasUnicos = new Set(mtdR.map((x) => x.fecha_hora.slice(0, 10)));
        const mtdMesa = mtdR.filter((x) => x.canal === 'mesa').reduce((s, x) => s + Number(x.total || 0), 0);
        const mtdPeya = mtdR.filter((x) => x.canal === 'peya').reduce((s, x) => s + Number(x.total || 0), 0);
        const mtdTotal = mtdR.reduce((s, x) => s + Number(x.total || 0), 0);
        const mtd = {
          total: mtdTotal,
          dias_operados: diasUnicos.size,
          promedio_diario: diasUnicos.size ? mtdTotal / diasUnicos.size : 0,
          tickets: mtdR.length,
          mesa: mtdMesa, peya: mtdPeya,
          pct_mesa: mtdTotal > 0 ? (mtdMesa / mtdTotal) * 100 : 0,
          pct_peya: mtdTotal > 0 ? (mtdPeya / mtdTotal) * 100 : 0
        };

        // ─── MES ANTERIOR ──────────────────────────────────────────
        const prevR = (prevMonthRes.data || []) as any[];
        const prevDias = new Set(prevR.map((x) => x.fecha_hora.slice(0, 10)));
        const prevTotal = prevR.reduce((s, x) => s + Number(x.total || 0), 0);
        const prevAvg = prevDias.size ? prevTotal / prevDias.size : 0;
        const mesAnterior = {
          mes: mesAnt,
          total: prevTotal,
          dias_operados: prevDias.size,
          promedio_diario: prevAvg,
          delta_total_pct: prevTotal > 0 ? ((mtdTotal - prevTotal) / prevTotal) * 100 : 0,
          delta_avg_pct:   prevAvg   > 0 ? ((mtd.promedio_diario - prevAvg) / prevAvg) * 100 : 0
        };

        // ─── HOY ───────────────────────────────────────────────────
        const hoyR = (hoyRes.data || []) as any[];
        const hoyTotal = hoyR.reduce((s, x) => s + Number(x.total || 0), 0);
        const hoy = { tickets: hoyR.length, total: hoyTotal, ticket_promedio: hoyR.length ? hoyTotal / hoyR.length : 0 };

        // ─── PROPINAS SEMANA ──────────────────────────────────────
        const propinasSemana = {
          total: ((tipRes.data || []) as any[]).reduce((s, x) => s + Number(x.propina || 0), 0),
          desde: fmtDate(lunes), hasta: fmtDate(domingo)
        };

        // ─── ULTIMOS 7 DÍAS ───────────────────────────────────────
        const buckets7: Record<string, { fecha: string; mesa: number; peya: number; total: number }> = {};
        for (let i = 0; i < 7; i++) {
          const d = new Date(hace7); d.setDate(hace7.getDate() + i);
          const k = fmtDate(d);
          buckets7[k] = { fecha: k, mesa: 0, peya: 0, total: 0 };
        }
        ((weekRes.data || []) as any[]).forEach((r) => {
          const k = r.fecha_hora.slice(0, 10);
          if (!buckets7[k]) buckets7[k] = { fecha: k, mesa: 0, peya: 0, total: 0 };
          const t = Number(r.total || 0);
          buckets7[k].total += t;
          if (r.canal === 'peya') buckets7[k].peya += t; else buckets7[k].mesa += t;
        });
        const ultimos7 = Object.values(buckets7).sort((a, b) => a.fecha.localeCompare(b.fecha));

        // ─── SPARKLINE 30 DÍAS ────────────────────────────────────
        const buckets30: Record<string, number> = {};
        for (let i = 0; i < 30; i++) {
          const d = new Date(hace30); d.setDate(hace30.getDate() + i);
          buckets30[fmtDate(d)] = 0;
        }
        ((last30Res.data || []) as any[]).forEach((r) => {
          const k = r.fecha_hora.slice(0, 10);
          if (buckets30[k] !== undefined) buckets30[k] += Number(r.total || 0);
        });
        const sparkline30 = Object.keys(buckets30).sort().map((k) => buckets30[k]);

        // ─── TOP PRODUCTOS ────────────────────────────────────────
        const acc: Record<string, { codigo: string; nombre: string; vendidos: number; revenue: number }> = {};
        ((topRes.data || []) as any[]).forEach((r) => {
          const p = r.productos; if (!p) return;
          const key = p.codigo;
          if (!acc[key]) acc[key] = { codigo: p.codigo, nombre: p.nombre, vendidos: 0, revenue: 0 };
          acc[key].vendidos += Number(r.cantidad || 0);
          acc[key].revenue  += Number(r.subtotal || 0);
        });
        const topProductos = Object.values(acc).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        // ─── UTILIDAD MES ─────────────────────────────────────────
        const rentMes  = (rentMesRes.data  as any) || null;
        const rentPrev = (rentPrevRes.data as any) || null;
        const utilNeta = Number(rentMes?.utilidad_neta || 0);
        const utilPrev = Number(rentPrev?.utilidad_neta || 0);
        const utilidad = {
          mes: mesActual,
          ventas_total:  Number(rentMes?.ventas_total  || 0),
          ingreso_neto:  Number(rentMes?.ingreso_neto  || 0),
          cogs:          Number(rentMes?.cogs_estimado || 0),
          planilla:      Number(rentMes?.planilla_neta || 0) + Number(rentMes?.planilla_aportes || 0),
          renta:         Number(rentMes?.renta || 0),
          depreciacion:  Number(rentMes?.depreciacion || 0),
          utilidad_neta: utilNeta,
          margen_pct:    Number(rentMes?.ventas_total || 0) > 0 ? (utilNeta / Number(rentMes.ventas_total)) * 100 : 0,
          delta_pct:     Math.abs(utilPrev) > 0 ? ((utilNeta - utilPrev) / Math.abs(utilPrev)) * 100 : 0
        };

        if (!cancel) setData({
          ultimoDia, mtd, mesAnterior, utilidad,
          hoy, propinasSemana,
          ultimos7, sparkline30,
          topProductos,
          proximosEventos: calcProximosEventos(now),
          loading: false, error: null
        });
      } catch (e: any) {
        if (!cancel) setData({ ...empty, loading: false, error: String(e?.message || e) });
      }
    }

    load();
    return () => { cancel = true; };
  }, []);

  return data;
}
