import { useState, useEffect, useCallback } from 'react'
import { db as supabase } from '../../supabase'
import { today, fmtDate, n } from '../../config'

const colors = { bg: '#1a1a2e', card: '#16213e', accent: '#e63946', gold: '#ffd60a', green: '#4ade80', blue: '#60a5fa' }

const SUCURSALES = [
  { code: '', nombre: 'Todas las sucursales' },
  { code: 'CM001', nombre: 'Casa Matriz' },
  { code: 'M001',  nombre: 'Cafetalón' },
  { code: 'S001',  nombre: 'Soyapango' },
  { code: 'S002',  nombre: 'Usulután' },
  { code: 'S003',  nombre: 'Lourdes' },
  { code: 'S004',  nombre: 'Venecia' },
  { code: 'S005',  nombre: 'Driver Thru Lourdes' },
  { code: 'S006',  nombre: 'Metro Centro' },
  { code: 'S007',  nombre: 'Plaza Integración' },
  { code: 'S008',  nombre: 'Plaza Olímpica' },
]

const ESTADO_CRUCE_LABEL = {
  pendiente:  { label: 'Pendiente',    color: '#f59e0b' },
  cruzado:    { label: 'Cruzado ✓',   color: '#4ade80' },
  ticket_cf:  { label: 'Ticket CF',   color: '#60a5fa' },
  sin_dte:    { label: 'Sin DTE',     color: '#9ca3af' },
  ignorar:    { label: 'No aplica',   color: '#4b5563' },
}

const fmt$ = (v) => `$${n(v).toFixed(2)}`

// ── Iniciar desde hace 30 días
const hace30 = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

export default function FinanzasGastosView({ user }) {
  const [tab, setTab] = useState('egresos')

  // Filtros globales
  const [filtroSucursal, setFiltroSucursal] = useState('')
  const [filtroDesde, setFiltroDesde]       = useState(hace30)
  const [filtroHasta, setFiltroHasta]       = useState(today)
  const [filtroMotivo, setFiltroMotivo]     = useState('')

  // Tab 1 — Egresos
  const [egresos, setEgresos]     = useState([])
  const [resumen, setResumen]     = useState([])
  const [loading, setLoading]     = useState(false)
  const [editEgreso, setEditEgreso] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [motivos, setMotivos]     = useState([])

  // Tab 2 — Conciliación
  const [pendientes, setPendientes]   = useState([])
  const [selEgreso, setSelEgreso]     = useState(null)
  const [dtesCand, setDtesCand]       = useState([])
  const [loadCand, setLoadCand]       = useState(false)
  const [matchMap, setMatchMap]       = useState({})   // egreso_id → {confianza, dte, diffPct, diffDias, candidatos}
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [expandido, setExpandido]     = useState(new Set()) // egresos con panel manual abierto
  const [confirmandoBulk, setConfirmandoBulk] = useState(false)

  // Tab 4 — Recepciones CM
  const [recepciones, setRecepciones]     = useState([])
  const [matchMapRec, setMatchMapRec]     = useState({}) // recepcion_id → {confianza, dte, score}
  const [loadingRec, setLoadingRec]       = useState(false)
  const [regRecepcion, setRegRecepcion]   = useState(null) // recepcion abierta en mini-form
  const [regForm, setRegForm]             = useState({ monto: '', notas: '', categoria_gasto_id: '' })
  const [savingRec, setSavingRec]         = useState(false)
  const [expandidoRec, setExpandidoRec]   = useState(new Set())
  const [dtesCandRec, setDtesCandRec]     = useState([])

  // Tab 3 — Registrar Sin DTE
  const [proveedores, setProveedores] = useState([])
  const [formSDte, setFormSDte] = useState({
    proveedor_id: '', proveedor_nombre: '', fecha: today(),
    monto_total: '', tipo: 'foto_dte_pendiente', forma_pago: 'efectivo',
    sucursal_code: user.store_code || '', descripcion: '',
    categoria_gasto_id: '1-Insumo Cocina', notas: '',
  })
  const [savingSDte, setSavingSDte] = useState(false)
  const [msgSDte, setMsgSDte]       = useState('')

  // ── Cargar catálogos al montar
  useEffect(() => {
    const load = async () => {
      const [{ data: cats }, { data: mots }, { data: provs }] = await Promise.all([
        supabase.from('categorias_gasto').select('id,nombre,grupo').order('grupo').order('orden'),
        supabase.from('motivos_egreso').select('id,nombre').eq('activo', true).order('orden'),
        supabase.from('proveedores').select('id,nombre,nit').eq('activo', true).order('nombre'),
      ])
      setCategorias(cats || [])
      setMotivos(mots || [])
      setProveedores(provs || [])
    }
    load()
  }, [])

  // ── Tab 1: cargar egresos
  const cargarEgresos = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('egresos_cierre')
      .select(`
        id, motivo_nombre, motivo_id, monto, persona_recibe,
        foto_url, comentario, categoria_gasto_id, estado_cruce,
        compras_dte_id, created_at,
        ventas_diarias!inner(fecha, store_code)
      `)
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
      .order('created_at', { ascending: false })

    if (filtroSucursal) q = q.eq('ventas_diarias.store_code', filtroSucursal)
    if (filtroMotivo)   q = q.eq('motivo_nombre', filtroMotivo)

    const { data } = await q
    const rows = data || []
    setEgresos(rows)

    // Resumen por motivo
    const res = {}
    rows.forEach(r => {
      if (!res[r.motivo_nombre]) res[r.motivo_nombre] = { motivo: r.motivo_nombre, n: 0, monto: 0, con_foto: 0, sin_cat: 0 }
      res[r.motivo_nombre].n++
      res[r.motivo_nombre].monto += n(r.monto)
      if (r.foto_url) res[r.motivo_nombre].con_foto++
      if (!r.categoria_gasto_id) res[r.motivo_nombre].sin_cat++
    })
    setResumen(Object.values(res).sort((a,b) => b.monto - a.monto))
    setLoading(false)
  }, [filtroDesde, filtroHasta, filtroSucursal, filtroMotivo])

  useEffect(() => { if (tab === 'egresos') cargarEgresos() }, [tab, cargarEgresos])

  // ── Tab 2: cargar pendientes de cruce
  const cargarPendientes = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('egresos_cierre')
      .select('id, motivo_nombre, monto, foto_url, comentario, created_at, ventas_diarias!inner(fecha, store_code)')
      .eq('motivo_nombre', 'Gasto con Factura')
      .eq('estado_cruce', 'pendiente')
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
      .order('created_at', { ascending: false })
    setPendientes(data || [])
    setLoading(false)
  }, [filtroDesde, filtroHasta])

  useEffect(() => { if (tab === 'conciliar') cargarPendientes() }, [tab, cargarPendientes])

  // ── Calcular matches en batch para todos los pendientes
  const calcularMatches = useCallback(async (lista) => {
    if (!lista || lista.length === 0) return
    setLoadingMatches(true)
    const fechas = lista.map(p => p.ventas_diarias?.fecha).filter(Boolean)
    if (!fechas.length) { setLoadingMatches(false); return }
    const minFecha = new Date(Math.min(...fechas.map(f => new Date(f + 'T12:00:00'))))
    const maxFecha = new Date(Math.max(...fechas.map(f => new Date(f + 'T12:00:00'))))
    minFecha.setDate(minFecha.getDate() - 8)
    maxFecha.setDate(maxFecha.getDate() + 4)
    const { data: dtes } = await supabase
      .from('compras_dte')
      .select('id, proveedor_nombre, fecha_emision, monto_total, tipo_dte, numero_control')
      .eq('cruzado', false)
      .gte('fecha_emision', minFecha.toISOString().split('T')[0])
      .lte('fecha_emision', maxFecha.toISOString().split('T')[0])
    const pool = dtes || []
    const usados = new Set()
    const newMap = {}
    // Ordenar por monto desc para que montos grandes tengan prioridad en la asignación
    const sorted = [...lista].sort((a,b) => n(b.monto) - n(a.monto))
    for (const eg of sorted) {
      const fecha = eg.ventas_diarias?.fecha
      const monto = n(eg.monto)
      if (!fecha || !monto) { newMap[eg.id] = { confianza: 'ninguna', dte: null }; continue }
      const egDate = new Date(fecha + 'T12:00:00')
      const scored = pool
        .filter(d => !usados.has(d.id))
        .map(d => {
          const diffPct = Math.abs(n(d.monto_total) - monto) / monto
          const diffDias = Math.abs((new Date(d.fecha_emision + 'T12:00:00') - egDate) / 86400000)
          return { dte: d, diffPct, diffDias }
        })
        .filter(x => x.diffPct <= 0.12 && x.diffDias <= 7)
        .sort((a,b) => (a.diffPct * 3 + a.diffDias * 0.5) - (b.diffPct * 3 + b.diffDias * 0.5))
      if (scored.length === 0) {
        newMap[eg.id] = { confianza: 'ninguna', dte: null, candidatos: 0 }
      } else {
        const best = scored[0]
        let confianza
        if (best.diffPct <= 0.03 && best.diffDias <= 1) confianza = 'alta'
        else if (best.diffPct <= 0.08 && best.diffDias <= 3) confianza = 'media'
        else confianza = 'baja'
        newMap[eg.id] = { confianza, dte: best.dte, diffPct: best.diffPct, diffDias: best.diffDias, candidatos: scored.length }
        if (confianza === 'alta') usados.add(best.dte.id)
      }
    }
    setMatchMap(newMap)
    setLoadingMatches(false)
  }, [])

  useEffect(() => { if (pendientes.length) calcularMatches(pendientes) }, [pendientes, calcularMatches])

  // Confirmar un match sugerido (1-click)
  const confirmarMatch = async (egresoId) => {
    const m = matchMap[egresoId]
    if (!m?.dte) return
    await Promise.all([
      supabase.from('egresos_cierre').update({ estado_cruce: 'cruzado', compras_dte_id: m.dte.id }).eq('id', egresoId),
      supabase.from('compras_dte').update({ cruzado: true }).eq('id', m.dte.id),
    ])
    setPendientes(p => p.filter(x => x.id !== egresoId))
    setMatchMap(prev => { const n = {...prev}; delete n[egresoId]; return n })
  }

  // Confirmar TODOS los matches de alta confianza
  const confirmarTodosVerdes = async () => {
    setConfirmandoBulk(true)
    const verdes = pendientes.filter(p => matchMap[p.id]?.confianza === 'alta')
    await Promise.all(verdes.flatMap(eg => {
      const dteId = matchMap[eg.id].dte.id
      return [
        supabase.from('egresos_cierre').update({ estado_cruce: 'cruzado', compras_dte_id: dteId }).eq('id', eg.id),
        supabase.from('compras_dte').update({ cruzado: true }).eq('id', dteId),
      ]
    }))
    const verdeIds = new Set(verdes.map(v => v.id))
    setPendientes(p => p.filter(x => !verdeIds.has(x.id)))
    setMatchMap(prev => { const n = {...prev}; verdes.forEach(v => delete n[v.id]); return n })
    setConfirmandoBulk(false)
  }

  // Toggle panel manual de candidatos
  const toggleExpandido = async (egreso) => {
    const newSet = new Set(expandido)
    if (newSet.has(egreso.id)) { newSet.delete(egreso.id); setExpandido(newSet); return }
    newSet.add(egreso.id)
    setExpandido(newSet)
    await buscarCandidatos(egreso)
  }

  // Buscar DTEs candidatos para un egreso
  const buscarCandidatos = async (egreso) => {
    setSelEgreso(egreso)
    setLoadCand(true)
    const fecha = egreso.ventas_diarias?.fecha || egreso.created_at?.split('T')[0]
    const montoMin = n(egreso.monto) * 0.88
    const montoMax = n(egreso.monto) * 1.12
    const desde = new Date(fecha + 'T12:00:00')
    desde.setDate(desde.getDate() - 7)
    const hasta = new Date(fecha + 'T12:00:00')
    hasta.setDate(hasta.getDate() + 3)

    const { data } = await supabase
      .from('compras_dte')
      .select('id, proveedor_nombre, fecha_emision, monto_total, tipo_dte, numero_control')
      .gte('monto_total', montoMin)
      .lte('monto_total', montoMax)
      .gte('fecha_emision', desde.toISOString().split('T')[0])
      .lte('fecha_emision', hasta.toISOString().split('T')[0])
      .eq('cruzado', false)
      .order('fecha_emision', { ascending: false })
      .limit(15)

    setDtesCand(data || [])
    setLoadCand(false)
  }

  const cruzarConDte = async (dteId, egresoIdOverride) => {
    const egresoId = egresoIdOverride || selEgreso?.id
    if (!egresoId) return
    await Promise.all([
      supabase.from('egresos_cierre').update({ estado_cruce: 'cruzado', compras_dte_id: dteId }).eq('id', egresoId),
      supabase.from('compras_dte').update({ cruzado: true, recepcion_candidata_id: null }).eq('id', dteId),
    ])
    setPendientes(p => p.filter(x => x.id !== egresoId))
    setMatchMap(prev => { const n = {...prev}; delete n[egresoId]; return n })
    setSelEgreso(null)
    setDtesCand([])
    setExpandido(prev => { const n = new Set(prev); n.delete(egresoId); return n })
  }

  const marcarTicketCF = async (egresoId) => {
    await supabase.from('egresos_cierre').update({ estado_cruce: 'ticket_cf' }).eq('id', egresoId)
    setPendientes(p => p.filter(x => x.id !== egresoId))
    if (selEgreso?.id === egresoId) { setSelEgreso(null); setDtesCand([]) }
  }

  const revertirPendiente = async (egresoId) => {
    await supabase.from('egresos_cierre').update({ estado_cruce: 'pendiente', compras_dte_id: null }).eq('id', egresoId)
    cargarPendientesCruce()
  }

  // ── Editar egreso (categoría + estado_cruce)
  const guardarEgreso = async () => {
    if (!editEgreso) return
    await supabase.from('egresos_cierre')
      .update({ categoria_gasto_id: editEgreso.categoria_gasto_id, estado_cruce: editEgreso.estado_cruce })
      .eq('id', editEgreso.id)
    setEgresos(e => e.map(x => x.id === editEgreso.id ? { ...x, ...editEgreso } : x))
    setResumen(prev => {
      // recalcular sin_cat
      const rows = egresos.map(x => x.id === editEgreso.id ? { ...x, ...editEgreso } : x)
      const res = {}
      rows.forEach(r => {
        if (!res[r.motivo_nombre]) res[r.motivo_nombre] = { motivo: r.motivo_nombre, n: 0, monto: 0, sin_cat: 0 }
        res[r.motivo_nombre].n++
        res[r.motivo_nombre].monto += n(r.monto)
        if (!r.categoria_gasto_id) res[r.motivo_nombre].sin_cat++
      })
      return Object.values(res).sort((a,b) => b.monto - a.monto)
    })
    setEditEgreso(null)
  }

  // ── Tab 4: Recepciones CM
  const cargarRecepciones = useCallback(async () => {
    setLoadingRec(true)
    const { data } = await supabase
      .from('recepciones')
      .select(`
        id, fecha, proveedor, tipo_recepcion, estado, foto_dte_url, dte_codigo, notas, compras_dte_id, compras_sin_dte_id,
        recepcion_items(cantidad_recibida, precio_unitario)
      `)
      .is('compras_dte_id', null)
      .is('compras_sin_dte_id', null)
      .order('fecha', { ascending: false })
    // Calcular monto_estimado = Σ(cantidad_recibida × precio_unitario) por recepción
    const rows = (data || []).map(r => ({
      ...r,
      monto_estimado: (r.recepcion_items || []).reduce(
        (sum, it) => sum + (n(it.cantidad_recibida) * n(it.precio_unitario)), 0
      )
    }))
    setRecepciones(rows)
    setLoadingRec(false)
    if (rows.length) calcularMatchesRec(rows)
  }, [])

  useEffect(() => { if (tab === 'recepciones') cargarRecepciones() }, [tab, cargarRecepciones])

  // Normalizar nombre proveedor para comparación
  const normProv = (s) => (s || '').toLowerCase()
    .replace(/s\.?\s*a\.?\s*de\s*c\.?\s*v\.?/gi, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()

  // Score de similitud entre dos nombres de proveedor (0-1)
  const provScore = (a, b) => {
    const na = normProv(a), nb = normProv(b)
    if (!na || !nb) return 0
    const words = na.split(' ').filter(w => w.length > 3)
    if (!words.length) return 0
    return words.filter(w => nb.includes(w)).length / words.length
  }

  // dte_codigo (ej: "5537") vs numero_control del DTE email
  const dteCodigoMatch = (codigo, numeroControl) => {
    if (!codigo || !numeroControl) return false
    const last = numeroControl.slice(-codigo.length)
    return last === codigo || numeroControl.endsWith(codigo.padStart(15, '0'))
  }

  const calcularMatchesRec = useCallback(async (lista) => {
    if (!lista?.length) return
    const fechas = lista.map(r => r.fecha).filter(Boolean)
    const minF = new Date(Math.min(...fechas.map(f => new Date(f + 'T12:00:00'))))
    const maxF = new Date(Math.max(...fechas.map(f => new Date(f + 'T12:00:00'))))
    minF.setDate(minF.getDate() - 5)
    maxF.setDate(maxF.getDate() + 3)
    const { data: dtes } = await supabase
      .from('compras_dte')
      .select('id, proveedor_nombre, fecha_emision, monto_total, tipo_dte, numero_control')
      .eq('cruzado', false)
      .gte('fecha_emision', minF.toISOString().split('T')[0])
      .lte('fecha_emision', maxF.toISOString().split('T')[0])
    const pool = dtes || []
    const usados = new Set()
    const newMap = {}
    // Priorizar recepciones con mayor monto para evitar colisiones
    const sorted = [...lista].sort((a, b) => n(b.monto_estimado) - n(a.monto_estimado))
    for (const rec of sorted) {
      const recDate = new Date(rec.fecha + 'T12:00:00')
      const hasMonto = rec.monto_estimado > 0
      const scored = pool
        .filter(d => !usados.has(d.id))
        .map(d => {
          const diffDias = Math.abs((new Date(d.fecha_emision + 'T12:00:00') - recDate) / 86400000)
          const ps = provScore(rec.proveedor, d.proveedor_nombre)
          const codigoOk = dteCodigoMatch(rec.dte_codigo, d.numero_control)
          // Matching por monto cuando hay estimado (±15% — más tolerante que Tab2 por precios desactualizados)
          let diffPct = 1, montoOk = false
          if (hasMonto && rec.monto_estimado > 0) {
            diffPct = Math.abs(n(d.monto_total) - rec.monto_estimado) / rec.monto_estimado
            montoOk = diffPct <= 0.15
          }
          // Score compuesto: código > monto > nombre > fecha
          const score = (codigoOk ? 4 : 0) + (montoOk ? 2.5 - diffPct * 5 : 0) + ps * 2 - diffDias * 0.3
          return { dte: d, score, diffDias, ps, codigoOk, diffPct, montoOk }
        })
        .filter(x => {
          if (x.diffDias > 7) return false
          // Aceptar si código coincide, nombre similar, monto similar, o nombre+fecha razonables
          return x.codigoOk || (hasMonto && x.montoOk && x.ps >= 0.2) || x.ps >= 0.4
        })
        .sort((a, b) => b.score - a.score)
      if (!scored.length) {
        newMap[rec.id] = { confianza: 'ninguna', dte: null }
      } else {
        const best = scored[0]
        let confianza
        if (best.codigoOk && (best.ps >= 0.3 || best.montoOk)) confianza = 'alta'
        else if (hasMonto && best.montoOk && best.diffPct <= 0.05 && best.diffDias <= 2) confianza = 'alta'
        else if (hasMonto && best.montoOk && best.diffDias <= 4 && best.ps >= 0.3) confianza = 'media'
        else if (best.ps >= 0.6 && best.diffDias <= 3) confianza = 'media'
        else confianza = 'baja'
        newMap[rec.id] = {
          confianza, dte: best.dte, score: best.score, diffDias: best.diffDias,
          diffPct: best.diffPct, montoOk: best.montoOk, candidatos: scored.length
        }
        if (confianza === 'alta') usados.add(best.dte.id)
      }
    }
    setMatchMapRec(newMap)
  }, [])

  const cruzarRecepcionConDte = async (recepcionId, dteId) => {
    await Promise.all([
      supabase.from('recepciones').update({ compras_dte_id: dteId }).eq('id', recepcionId),
      supabase.from('compras_dte').update({ cruzado: true }).eq('id', dteId),
    ])
    setRecepciones(r => r.filter(x => x.id !== recepcionId))
    setMatchMapRec(prev => { const n = {...prev}; delete n[recepcionId]; return n })
    setExpandidoRec(prev => { const n = new Set(prev); n.delete(recepcionId); return n })
  }

  const buscarDtesCandRec = async (rec) => {
    setDtesCandRec([])
    const recDate = new Date(rec.fecha + 'T12:00:00')
    const desde = new Date(recDate); desde.setDate(desde.getDate() - 7)
    const hasta = new Date(recDate); hasta.setDate(hasta.getDate() + 4)
    let q = supabase
      .from('compras_dte')
      .select('id, proveedor_nombre, fecha_emision, monto_total, tipo_dte, numero_control')
      .eq('cruzado', false)
      .gte('fecha_emision', desde.toISOString().split('T')[0])
      .lte('fecha_emision', hasta.toISOString().split('T')[0])
    // Si hay monto estimado, filtrar por rango ±20% para reducir lista
    if (rec.monto_estimado > 0) {
      q = q.gte('monto_total', rec.monto_estimado * 0.80)
           .lte('monto_total', rec.monto_estimado * 1.20)
    }
    const { data } = await q.order('fecha_emision', { ascending: false }).limit(20)
    setDtesCandRec(data || [])
  }

  const registrarSinDteDesdeRecepcion = async (rec) => {
    if (!regForm.monto) return
    setSavingRec(true)
    const { data: sinDte, error } = await supabase.from('compras_sin_dte').insert({
      fecha: rec.fecha,
      proveedor_nombre: rec.proveedor,
      monto_total: parseFloat(regForm.monto),
      tipo: 'foto_dte_pendiente',
      forma_pago: 'efectivo',
      descripcion: regForm.notas || `Recepción bodega - DTE #${rec.dte_codigo || '?'}`,
      categoria_gasto_id: regForm.categoria_gasto_id || null,
      recibido_en: 'casa_matriz',
      foto_url: rec.foto_dte_url,
    }).select('id').single()
    if (!error && sinDte) {
      await supabase.from('recepciones').update({ compras_sin_dte_id: sinDte.id }).eq('id', rec.id)
      setRecepciones(r => r.filter(x => x.id !== rec.id))
    }
    setSavingRec(false)
    setRegRecepcion(null)
    setRegForm({ monto: '', notas: '', categoria_gasto_id: '' })
  }

  // ── Tab 3: Guardar compra sin DTE
  const guardarSinDte = async () => {
    setSavingSDte(true)
    setMsgSDte('')
    const suc = SUCURSALES.find(s => s.code === formSDte.sucursal_code)

    const { error } = await supabase.from('compras_sin_dte').insert({
      fecha:             formSDte.fecha,
      proveedor_id:      formSDte.proveedor_id || null,
      proveedor_nombre:  formSDte.proveedor_nombre,
      monto_total:       parseFloat(formSDte.monto_total) || 0,
      tipo:              formSDte.tipo,
      forma_pago:        formSDte.forma_pago,
      descripcion:       formSDte.descripcion,
      categoria_gasto_id: formSDte.categoria_gasto_id || null,
      notas:             formSDte.notas,
      recibido_en:       formSDte.sucursal_code === 'CM001' ? 'casa_matriz' : 'sucursal',
    })

    setSavingSDte(false)
    if (error) { setMsgSDte('❌ Error: ' + error.message) }
    else {
      setMsgSDte('✅ Compra registrada correctamente')
      setFormSDte(f => ({ ...f, proveedor_id: '', proveedor_nombre: '', monto_total: '', descripcion: '', notas: '' }))
    }
  }

  // ── Estilos base
  const st = {
    wrap:  { minHeight: '100vh', background: colors.bg, color: '#f0f0f0', padding: '16px' },
    card:  { background: colors.card, borderRadius: 12, padding: 16, marginBottom: 12 },
    input: { background: '#0f172a', border: '1px solid #334', color: '#f0f0f0', borderRadius: 8, padding: '8px 10px', width: '100%', fontSize: 13 },
    btn:   (bg='#e63946') => ({ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }),
    label: { fontSize: 11, color: '#888', marginBottom: 4, display: 'block' },
    row:   { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'flex-end' },
    th:    { padding: '10px 8px', textAlign: 'left', fontSize: 12, color: '#888', borderBottom: '1px solid #2a2a3e' },
    td:    { padding: '10px 8px', fontSize: 12, borderBottom: '1px solid #1e1e30', verticalAlign: 'top' },
  }

  const totalEgresos = egresos.reduce((s,r) => s + n(r.monto), 0)
  const sinCategoria = egresos.filter(r => !r.categoria_gasto_id).length

  return (
    <div style={st.wrap}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: colors.accent }}>💸 Gastos de Caja</div>
        <div style={{ fontSize: 12, color: '#888' }}>Control y conciliación de egresos · Finanzas</div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'egresos',     label: '📊 Egresos de Caja' },
          { key: 'conciliar',   label: '🔗 Conciliar DTEs' },
          { key: 'recepciones', label: '📦 Recepciones CM' },
          { key: 'sin-dte',     label: '📥 Registrar Sin DTE' },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key)}
            style={{ ...st.btn(tab === t.key ? colors.accent : '#1e293b'), padding: '8px 14px', border: tab === t.key ? 'none' : '1px solid #334' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* FILTROS GLOBALES */}
      <div style={st.card}>
        <div style={st.row}>
          <div style={{ flex: '1 1 150px' }}>
            <span style={st.label}>Sucursal</span>
            <select style={st.input} value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}>
              {SUCURSALES.map(s => <option key={s.code} value={s.code}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <span style={st.label}>Desde</span>
            <input type="date" style={st.input} value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <span style={st.label}>Hasta</span>
            <input type="date" style={st.input} value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} />
          </div>
          {tab === 'egresos' && (
            <div style={{ flex: '1 1 150px' }}>
              <span style={st.label}>Motivo</span>
              <select style={st.input} value={filtroMotivo} onChange={e => setFiltroMotivo(e.target.value)}>
                <option value="">Todos los motivos</option>
                {motivos.map(m => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
              </select>
            </div>
          )}
          <button style={st.btn()} onClick={tab === 'egresos' ? cargarEgresos : tab === 'recepciones' ? cargarRecepciones : cargarPendientes}>
            🔄 Filtrar
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          TAB 1 — EGRESOS DE CAJA
      ═══════════════════════════════════════════════ */}
      {tab === 'egresos' && (
        <>
          {/* Cards resumen */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ ...st.card, flex: '1 1 140px', margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: colors.gold }}>{fmt$(totalEgresos)}</div>
              <div style={{ fontSize: 11, color: '#888' }}>Total egresos ({egresos.length})</div>
            </div>
            <div style={{ ...st.card, flex: '1 1 140px', margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: sinCategoria > 0 ? colors.accent : colors.green }}>{sinCategoria}</div>
              <div style={{ fontSize: 11, color: '#888' }}>Sin categoría P&L</div>
            </div>
            <div style={{ ...st.card, flex: '1 1 140px', margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: colors.blue }}>
                {egresos.filter(r => r.estado_cruce === 'pendiente').length}
              </div>
              <div style={{ fontSize: 11, color: '#888' }}>Pendientes cruce</div>
            </div>
          </div>

          {/* Tabla resumen por motivo */}
          <div style={st.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.gold, marginBottom: 10 }}>Resumen por Motivo</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Motivo','Entradas','Monto','Sin Categoría'].map(h =>
                      <th key={h} style={st.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {resumen.map(r => (
                    <tr key={r.motivo} style={{ cursor: 'pointer' }}
                        onClick={() => setFiltroMotivo(filtroMotivo === r.motivo ? '' : r.motivo)}>
                      <td style={st.td}>
                        <span style={{ fontWeight: 600, color: filtroMotivo === r.motivo ? colors.gold : '#f0f0f0' }}>
                          {r.motivo}
                        </span>
                      </td>
                      <td style={st.td}>{r.n}</td>
                      <td style={{ ...st.td, fontWeight: 700, color: colors.gold }}>{fmt$(r.monto)}</td>
                      <td style={st.td}>
                        {r.sin_cat > 0
                          ? <span style={{ color: colors.accent, fontWeight: 700 }}>⚠️ {r.sin_cat}</span>
                          : <span style={{ color: colors.green }}>✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabla detalle */}
          <div style={st.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0', marginBottom: 10 }}>
              Detalle{filtroMotivo ? ` — ${filtroMotivo}` : ''} ({egresos.length})
              {loading && <span style={{ color: '#888', fontSize: 11, marginLeft: 8 }}>Cargando…</span>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Fecha','Sucursal','Motivo','Persona','Monto','Foto','Categoría P&L','Estado',''].map(h =>
                      <th key={h} style={st.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {egresos.slice(0,200).map(r => {
                    const vd = r.ventas_diarias || {}
                    const ec = ESTADO_CRUCE_LABEL[r.estado_cruce] || ESTADO_CRUCE_LABEL.pendiente
                    const cat = categorias.find(c => c.id === r.categoria_gasto_id)
                    return (
                      <tr key={r.id} style={{ background: !r.categoria_gasto_id ? '#1e1008' : 'transparent' }}>
                        <td style={st.td}>{vd.fecha ? fmtDate(vd.fecha) : '—'}</td>
                        <td style={st.td}>{vd.store_code || '—'}</td>
                        <td style={{ ...st.td, fontWeight: 600 }}>{r.motivo_nombre}</td>
                        <td style={st.td}>{r.persona_recibe || r.comentario?.slice(0,20) || '—'}</td>
                        <td style={{ ...st.td, fontWeight: 700, color: colors.gold }}>{fmt$(r.monto)}</td>
                        <td style={st.td}>
                          {r.foto_url
                            ? <a href={r.foto_url} target="_blank" rel="noreferrer"
                                 style={{ color: colors.blue, fontSize: 16 }}>📷</a>
                            : <span style={{ color: '#555' }}>—</span>}
                        </td>
                        <td style={st.td}>
                          {cat
                            ? <span style={{ background: '#1e293b', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}>{cat.nombre}</span>
                            : <span style={{ color: colors.accent, fontSize: 11 }}>⚠️ Sin categoría</span>}
                        </td>
                        <td style={st.td}>
                          <span style={{ color: ec.color, fontSize: 11, fontWeight: 600 }}>{ec.label}</span>
                        </td>
                        <td style={st.td}>
                          <button onClick={() => setEditEgreso({ ...r })}
                            style={{ ...st.btn('#1e293b'), padding: '4px 8px', fontSize: 11, border: '1px solid #334' }}>
                            ✏️
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════
          TAB 2 — CONCILIAR DTEs (SMART MATCHING)
      ═══════════════════════════════════════════════ */}
      {tab === 'conciliar' && (() => {
        const verdes    = pendientes.filter(p => matchMap[p.id]?.confianza === 'alta')
        const amarillos = pendientes.filter(p => matchMap[p.id]?.confianza === 'media')
        const bajos     = pendientes.filter(p => matchMap[p.id]?.confianza === 'baja')
        const rojos     = pendientes.filter(p => matchMap[p.id]?.confianza === 'ninguna' || !matchMap[p.id])
        const CONF_STYLE = {
          alta:   { icon: '🟢', label: 'Coincidencia exacta', border: '#16a34a', bg: '#052e16', badgeBg: 'rgba(74,222,128,0.15)', badgeColor: '#4ade80' },
          media:  { icon: '🟡', label: 'Sugerido',            border: '#b45309', bg: '#1c1200', badgeBg: 'rgba(251,191,36,0.15)',  badgeColor: '#fbbf24' },
          baja:   { icon: '🟠', label: 'Posible',             border: '#9a3412', bg: '#1c0a00', badgeBg: 'rgba(249,115,22,0.15)',  badgeColor: '#f97316' },
          ninguna:{ icon: '🔴', label: 'Sin match',           border: '#7f1d1d', bg: '#1a0000', badgeBg: 'rgba(230,57,70,0.15)',   badgeColor: '#e63946' },
        }
        const renderDteCand = (dte, egresoId, isSelected) => (
          <div key={dte.id} style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid #2a2a3e', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.gold }}>{fmt$(dte.monto_total)}</div>
              <div style={{ fontSize: 12, color: '#f0f0f0' }}>{dte.proveedor_nombre}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{fmtDate(dte.fecha_emision)} · {dte.tipo_dte} · {dte.numero_control?.slice(-8)}</div>
            </div>
            <button onClick={() => cruzarConDte(dte.id, egresoId)}
              style={{ ...st.btn(colors.green), color:'#000', padding:'6px 12px', fontSize:12, whiteSpace:'nowrap' }}>
              ✓ Cruzar
            </button>
          </div>
        )
        return (
          <div>
            {/* Barra resumen */}
            <div style={{ ...st.card, display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ display:'flex', gap:12, fontSize:13, flexWrap:'wrap' }}>
                <span>🟢 <strong style={{color:'#4ade80'}}>{verdes.length}</strong> exactas</span>
                <span>🟡 <strong style={{color:'#fbbf24'}}>{amarillos.length}</strong> sugeridas</span>
                <span>🟠 <strong style={{color:'#f97316'}}>{bajos.length}</strong> posibles</span>
                <span>🔴 <strong style={{color:'#e63946'}}>{rojos.length}</strong> sin match</span>
              </div>
              {verdes.length > 0 && (
                <button onClick={confirmarTodosVerdes} disabled={confirmandoBulk}
                  style={{ ...st.btn(colors.green), color:'#000', fontSize:13, opacity: confirmandoBulk ? 0.6 : 1 }}>
                  {confirmandoBulk ? 'Confirmando…' : `✓ Confirmar ${verdes.length} exactas de un solo`}
                </button>
              )}
              {loadingMatches && <span style={{color:'#888', fontSize:12}}>⏳ Analizando DTEs…</span>}
              {loading && <span style={{color:'#888', fontSize:12}}>Cargando pendientes…</span>}
            </div>

            {pendientes.length === 0 && !loading && (
              <div style={{ color: colors.green, fontSize: 13, textAlign: 'center', padding: 30 }}>
                ✅ Sin pendientes de cruce en el período
              </div>
            )}

            {/* Cards por cada egreso */}
            {pendientes.map(r => {
              const vd = r.ventas_diarias || {}
              const m = matchMap[r.id]
              const conf = m?.confianza || 'ninguna'
              const cs = CONF_STYLE[conf]
              const isExp = expandido.has(r.id)
              const isSel = selEgreso?.id === r.id

              return (
                <div key={r.id} style={{ background: cs.bg, borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${cs.border}` }}>
                  {/* Fila principal */}
                  <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                    {/* Info egreso */}
                    <div style={{ flex: '1 1 180px' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{vd.fecha ? fmtDate(vd.fecha) : '—'} · {vd.store_code || '—'}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: colors.gold }}>{fmt$(r.monto)}</div>
                      {r.comentario && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{r.comentario.slice(0,50)}</div>}
                    </div>

                    {/* Badge de confianza + match sugerido */}
                    <div style={{ flex: '2 1 240px' }}>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:6, background: cs.badgeBg, borderRadius:6, padding:'3px 8px', marginBottom: m?.dte ? 6 : 0 }}>
                        <span style={{ fontSize:11, fontWeight:700, color: cs.badgeColor }}>{cs.icon} {cs.label}</span>
                        {m?.candidatos > 0 && conf !== 'alta' && (
                          <span style={{ fontSize:10, color:'#888' }}>({m.candidatos} candidato{m.candidatos>1?'s':''})</span>
                        )}
                      </div>
                      {m?.dte && (
                        <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:8, padding:'8px 10px' }}>
                          <div style={{ fontSize:13, fontWeight:700, color: colors.gold }}>{fmt$(m.dte.monto_total)}</div>
                          <div style={{ fontSize:12, color:'#f0f0f0' }}>{m.dte.proveedor_nombre}</div>
                          <div style={{ fontSize:11, color:'#888' }}>
                            {fmtDate(m.dte.fecha_emision)} · {m.dte.tipo_dte}
                            {m.diffPct > 0 && <span style={{color:'#666'}}> · ±{(m.diffPct*100).toFixed(1)}%</span>}
                            {m.diffDias > 0 && <span style={{color:'#666'}}> · {m.diffDias.toFixed(0)}d</span>}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Botones de acción */}
                    <div style={{ display:'flex', flexDirection:'column', gap:5, alignItems:'flex-end' }}>
                      {r.foto_url && (
                        <a href={r.foto_url} target="_blank" rel="noreferrer"
                           style={{ ...st.btn('#1e293b'), padding:'4px 10px', fontSize:11, textDecoration:'none' }}>
                          📷 Ver foto
                        </a>
                      )}
                      {m?.dte && (conf === 'alta' || conf === 'media') && (
                        <button onClick={() => confirmarMatch(r.id)}
                          style={{ ...st.btn(conf==='alta' ? colors.green : '#b45309'), color: conf==='alta' ? '#000':'#fff', padding:'5px 12px', fontSize:12 }}>
                          ✓ {conf==='alta' ? 'Confirmar' : 'Sí, es este'}
                        </button>
                      )}
                      <button onClick={() => toggleExpandido(r)}
                        style={{ ...st.btn('#1e293b'), padding:'4px 10px', fontSize:11, border:'1px solid #334' }}>
                        {isExp ? '▲ Cerrar' : '🔍 Ver DTEs'}
                      </button>
                      <button onClick={e => { e.stopPropagation(); marcarTicketCF(r.id) }}
                        style={{ ...st.btn('#7c3aed'), padding:'4px 10px', fontSize:11 }}>
                        Ticket CF
                      </button>
                    </div>
                  </div>

                  {/* Panel manual expandible */}
                  {isExp && (
                    <div style={{ marginTop: 10, borderTop:'1px solid #333', paddingTop:10 }}>
                      <div style={{ fontSize:12, color:'#888', marginBottom:8 }}>
                        DTEs disponibles — {fmt$(r.monto)} ±12% · ±7 días
                      </div>
                      {isSel && loadCand && <div style={{color:'#888',fontSize:12}}>Buscando…</div>}
                      {isSel && !loadCand && dtesCand.length === 0 && (
                        <div style={{color:'#888',fontSize:12,textAlign:'center',padding:12}}>
                          Sin DTEs en ese rango. ¿Es Ticket CF?
                        </div>
                      )}
                      {isSel && dtesCand.map(dte => renderDteCand(dte, r.id, true))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ═══════════════════════════════════════════════
          TAB 4 — RECEPCIONES CM
      ═══════════════════════════════════════════════ */}
      {tab === 'recepciones' && (() => {
        const CONF = {
          alta:   { icon:'🟢', label:'DTE encontrado',  border:'#16a34a', bg:'#052e16', badgeColor:'#4ade80' },
          media:  { icon:'🟡', label:'Probable match',  border:'#b45309', bg:'#1c1200', badgeColor:'#fbbf24' },
          baja:   { icon:'🟠', label:'Posible match',   border:'#9a3412', bg:'#1c0a00', badgeColor:'#f97316' },
          ninguna:{ icon:'🔴', label:'Sin DTE en email',border:'#7f1d1d', bg:'#1a0000', badgeColor:'#e63946' },
        }
        const verdes = recepciones.filter(r => matchMapRec[r.id]?.confianza === 'alta')
        return (
          <div>
            {/* Resumen */}
            <div style={{ ...st.card, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ fontSize:13, color:'#aaa' }}>
                <strong style={{color:'#f0f0f0'}}>{recepciones.length}</strong> recepciones sin cruzar ·{' '}
                🟢 <strong style={{color:'#4ade80'}}>{verdes.length}</strong> con DTE email ·{' '}
                🔴 <strong style={{color:'#e63946'}}>{recepciones.filter(r=>matchMapRec[r.id]?.confianza==='ninguna'||!matchMapRec[r.id]).length}</strong> sin DTE email (registrar monto)
              </div>
              {verdes.length > 0 && (
                <button style={{ ...st.btn(colors.green), color:'#000', fontSize:12 }}
                  onClick={async () => {
                    for (const r of verdes) await cruzarRecepcionConDte(r.id, matchMapRec[r.id].dte.id)
                  }}>
                  ✓ Cruzar {verdes.length} exactas
                </button>
              )}
              {loadingRec && <span style={{color:'#888',fontSize:12}}>Cargando…</span>}
            </div>

            {recepciones.length === 0 && !loadingRec && (
              <div style={{color:colors.green, textAlign:'center', padding:30, fontSize:13}}>✅ Todas las recepciones están cruzadas</div>
            )}

            {recepciones.map(r => {
              const m = matchMapRec[r.id]
              const conf = m?.confianza || 'ninguna'
              const cs = CONF[conf]
              const isExp = expandidoRec.has(r.id)
              const isReg = regRecepcion?.id === r.id
              return (
                <div key={r.id} style={{ background:cs.bg, borderRadius:10, padding:12, marginBottom:10, border:`1px solid ${cs.border}` }}>
                  <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                    {/* Info recepción */}
                    <div style={{ flex:'1 1 180px' }}>
                      <div style={{ fontSize:11, color:'#888' }}>{fmtDate(r.fecha)} · CM001</div>
                      <div style={{ fontSize:15, fontWeight:800, color:'#f0f0f0', marginTop:2 }}>{r.proveedor}</div>
                      {r.monto_estimado > 0 && (
                        <div style={{ fontSize:13, fontWeight:700, color:colors.gold, marginTop:3 }}>
                          {fmt$(r.monto_estimado)}
                          <span style={{ fontSize:10, color:'#888', fontWeight:400 }}> estimado</span>
                        </div>
                      )}
                      {r.dte_codigo && <div style={{ fontSize:11, color:'#888', marginTop:2 }}>DTE #{r.dte_codigo}</div>}
                      {r.notas && <div style={{ fontSize:11, color:'#aaa', marginTop:2 }}>{r.notas.slice(0,50)}</div>}
                    </div>

                    {/* Match sugerido */}
                    <div style={{ flex:'2 1 220px' }}>
                      <div style={{ display:'inline-flex', gap:6, alignItems:'center', background:`rgba(255,255,255,0.05)`, borderRadius:6, padding:'3px 8px', marginBottom: m?.dte ? 6 : 0 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:cs.badgeColor }}>{cs.icon} {cs.label}</span>
                      </div>
                      {m?.dte && (
                        <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:8, padding:'8px 10px' }}>
                          <div style={{ fontSize:13, fontWeight:700, color:colors.gold }}>{fmt$(m.dte.monto_total)}</div>
                          <div style={{ fontSize:12, color:'#f0f0f0' }}>{m.dte.proveedor_nombre}</div>
                          <div style={{ fontSize:11, color:'#888' }}>
                            {fmtDate(m.dte.fecha_emision)} · {m.dte.tipo_dte} · #{m.dte.numero_control?.slice(-6)}
                            {m.diffDias > 0 && <span style={{color:'#666'}}> · {m.diffDias.toFixed(0)}d</span>}
                            {r.monto_estimado > 0 && m.diffPct !== undefined && (
                              <span style={{ color: m.diffPct <= 0.05 ? '#4ade80' : m.diffPct <= 0.12 ? '#fbbf24' : '#f97316' }}>
                                {' '}· Δ{(m.diffPct*100).toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Botones */}
                    <div style={{ display:'flex', flexDirection:'column', gap:5, alignItems:'flex-end' }}>
                      {r.foto_dte_url && (
                        <a href={r.foto_dte_url} target="_blank" rel="noreferrer"
                           style={{ ...st.btn('#1e293b'), padding:'4px 10px', fontSize:11, textDecoration:'none' }}>
                          📷 Ver DTE
                        </a>
                      )}
                      {m?.dte && (conf === 'alta' || conf === 'media') && (
                        <button onClick={() => cruzarRecepcionConDte(r.id, m.dte.id)}
                          style={{ ...st.btn(conf==='alta'?colors.green:'#b45309'), color:conf==='alta'?'#000':'#fff', padding:'5px 12px', fontSize:12 }}>
                          ✓ {conf==='alta'?'Confirmar':'Sí, es este'}
                        </button>
                      )}
                      <button onClick={() => {
                          const newSet = new Set(expandidoRec)
                          if (newSet.has(r.id)) { newSet.delete(r.id) } else { newSet.add(r.id); buscarDtesCandRec(r) }
                          setExpandidoRec(newSet)
                        }}
                        style={{ ...st.btn('#1e293b'), padding:'4px 10px', fontSize:11, border:'1px solid #334' }}>
                        {isExp ? '▲ Cerrar' : '🔍 Ver DTEs'}
                      </button>
                      {conf === 'ninguna' && (
                        <button onClick={() => {
                            setRegRecepcion(r)
                            // Auto-rellenar monto estimado si está disponible
                            setRegForm({ monto: r.monto_estimado > 0 ? r.monto_estimado.toFixed(2) : '', notas:'', categoria_gasto_id:'' })
                          }}
                          style={{ ...st.btn('#7c3aed'), padding:'4px 10px', fontSize:11 }}>
                          📋 Registrar{r.monto_estimado > 0 ? ` ${fmt$(r.monto_estimado)}` : ' monto'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Panel DTEs manuales */}
                  {isExp && (
                    <div style={{ marginTop:10, borderTop:'1px solid #333', paddingTop:10 }}>
                      <div style={{ fontSize:12, color:'#888', marginBottom:8 }}>
                        DTEs disponibles ±7 días{r.monto_estimado > 0 ? ` · ${fmt$(r.monto_estimado * 0.80)}–${fmt$(r.monto_estimado * 1.20)} (±20%)` : ' · todos los montos'}
                      </div>
                      {dtesCandRec.length === 0 && <div style={{color:'#888',fontSize:12}}>Sin DTEs en ese período sin cruzar.</div>}
                      {dtesCandRec.map(dte => (
                        <div key={dte.id} style={{ background:'#0f172a', borderRadius:8, padding:10, marginBottom:6, border:'1px solid #2a2a3e', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:colors.gold }}>{fmt$(dte.monto_total)}</div>
                            <div style={{ fontSize:12, color:'#f0f0f0' }}>{dte.proveedor_nombre}</div>
                            <div style={{ fontSize:11, color:'#888' }}>{fmtDate(dte.fecha_emision)} · #{dte.numero_control?.slice(-6)}</div>
                          </div>
                          <button onClick={() => cruzarRecepcionConDte(r.id, dte.id)}
                            style={{ ...st.btn(colors.green), color:'#000', padding:'6px 12px', fontSize:12, whiteSpace:'nowrap' }}>
                            ✓ Cruzar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mini-form registrar monto */}
                  {isReg && (
                    <div style={{ marginTop:10, borderTop:'1px solid #7c3aed', paddingTop:10, background:'rgba(124,58,237,0.08)', borderRadius:8, padding:12 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#a78bfa', marginBottom:10 }}>
                        📋 Registrar como "DTE físico pendiente email" — {r.proveedor}
                        {r.monto_estimado > 0 && (
                          <span style={{ fontSize:11, color:'#888', fontWeight:400 }}> · estimado {fmt$(r.monto_estimado)}</span>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end' }}>
                        <div style={{ flex:'0 0 130px' }}>
                          <span style={st.label}>Monto total ($) *</span>
                          <input type="number" step="0.01" placeholder="0.00" style={st.input}
                            value={regForm.monto} onChange={e => setRegForm(f => ({...f, monto: e.target.value}))} />
                        </div>
                        <div style={{ flex:'1 1 160px' }}>
                          <span style={st.label}>Categoría P&L</span>
                          <select style={st.input} value={regForm.categoria_gasto_id}
                            onChange={e => setRegForm(f => ({...f, categoria_gasto_id: e.target.value}))}>
                            <option value="">— Sin categoría —</option>
                            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </div>
                        <div style={{ flex:'1 1 160px' }}>
                          <span style={st.label}>Nota (opcional)</span>
                          <input style={st.input} placeholder={`DTE #${r.dte_codigo || '?'}`}
                            value={regForm.notas} onChange={e => setRegForm(f => ({...f, notas: e.target.value}))} />
                        </div>
                        <button onClick={() => registrarSinDteDesdeRecepcion(r)}
                          disabled={!regForm.monto || savingRec}
                          style={{ ...st.btn('#7c3aed'), padding:'8px 14px', fontSize:13, opacity: !regForm.monto ? 0.5 : 1 }}>
                          {savingRec ? 'Guardando…' : '✓ Guardar'}
                        </button>
                        <button onClick={() => setRegRecepcion(null)}
                          style={{ ...st.btn('#1e293b'), padding:'8px 10px', fontSize:12, border:'1px solid #334' }}>
                          ✕
                        </button>
                      </div>
                      <div style={{ fontSize:10, color:'#666', marginTop:8 }}>
                        Queda en P&L como "foto_dte_pendiente". Cuando llegue el JSON por email se cruzará automáticamente.
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ═══════════════════════════════════════════════
          TAB 3 — REGISTRAR SIN DTE
      ═══════════════════════════════════════════════ */}
      {tab === 'sin-dte' && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 360px' }}>
            <div style={st.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.gold, marginBottom: 12 }}>
                Registrar compra sin DTE por email
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
                Para proveedores como <strong style={{ color: '#f0f0f0' }}>Flamo, Unigas, Embotelladora La Cascada</strong> que generan DTE físico que Marco fotografía, o compras completamente informales.
              </div>

              {/* Tipo */}
              <div style={{ marginBottom: 12 }}>
                <span style={st.label}>Tipo de compra</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { v: 'foto_dte_pendiente', label: '📷 Tiene DTE físico (foto)', desc: 'DTE generado, esperando email' },
                    { v: 'sin_dte_formal',     label: '💵 Sin DTE formal',         desc: 'Compra informal sin factura' },
                  ].map(opt => (
                    <button key={opt.v} onClick={() => setFormSDte(f => ({ ...f, tipo: opt.v }))}
                      style={{ ...st.btn(formSDte.tipo === opt.v ? colors.accent : '#1e293b'),
                               flex: 1, border: `1px solid ${formSDte.tipo === opt.v ? colors.accent : '#334'}`, textAlign: 'left', lineHeight: 1.4 }}>
                      <div style={{ fontSize: 12 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.7 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Proveedor */}
              <div style={{ marginBottom: 10 }}>
                <span style={st.label}>Proveedor</span>
                <select style={st.input} value={formSDte.proveedor_id}
                  onChange={e => {
                    const p = proveedores.find(x => x.id === e.target.value)
                    setFormSDte(f => ({ ...f, proveedor_id: e.target.value, proveedor_nombre: p?.nombre || f.proveedor_nombre }))
                  }}>
                  <option value="">— Seleccionar proveedor —</option>
                  {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              {!formSDte.proveedor_id && (
                <div style={{ marginBottom: 10 }}>
                  <span style={st.label}>Nombre proveedor (manual)</span>
                  <input style={st.input} placeholder="Si no está en la lista..." value={formSDte.proveedor_nombre}
                    onChange={e => setFormSDte(f => ({ ...f, proveedor_nombre: e.target.value }))} />
                </div>
              )}

              {/* Fecha + Monto */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <span style={st.label}>Fecha</span>
                  <input type="date" style={st.input} value={formSDte.fecha}
                    onChange={e => setFormSDte(f => ({ ...f, fecha: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={st.label}>Monto total ($)</span>
                  <input type="number" step="0.01" style={st.input} placeholder="0.00" value={formSDte.monto_total}
                    onChange={e => setFormSDte(f => ({ ...f, monto_total: e.target.value }))} />
                </div>
              </div>

              {/* Sucursal + Forma pago */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <span style={st.label}>Sucursal / Sede</span>
                  <select style={st.input} value={formSDte.sucursal_code}
                    onChange={e => setFormSDte(f => ({ ...f, sucursal_code: e.target.value }))}>
                    {SUCURSALES.filter(s => s.code).map(s => <option key={s.code} value={s.code}>{s.nombre}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <span style={st.label}>Forma de pago</span>
                  <select style={st.input} value={formSDte.forma_pago}
                    onChange={e => setFormSDte(f => ({ ...f, forma_pago: e.target.value }))}>
                    <option value="efectivo">💵 Efectivo</option>
                    <option value="transferencia">🏦 Transferencia</option>
                    <option value="credito">📋 Crédito</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>

              {/* Categoría P&L */}
              <div style={{ marginBottom: 10 }}>
                <span style={st.label}>Categoría P&L</span>
                <select style={st.input} value={formSDte.categoria_gasto_id}
                  onChange={e => setFormSDte(f => ({ ...f, categoria_gasto_id: e.target.value }))}>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.grupo} → {c.nombre}</option>)}
                </select>
              </div>

              {/* Descripción */}
              <div style={{ marginBottom: 10 }}>
                <span style={st.label}>Descripción / Items</span>
                <textarea style={{ ...st.input, minHeight: 60, resize: 'vertical' }} placeholder="Gas, agua, productos entregados…"
                  value={formSDte.descripcion} onChange={e => setFormSDte(f => ({ ...f, descripcion: e.target.value }))} />
              </div>

              {/* Notas */}
              <div style={{ marginBottom: 14 }}>
                <span style={st.label}>Notas internas</span>
                <input style={st.input} placeholder="Ej: Foto guardada en WhatsApp de Marco, No. factura 2341…"
                  value={formSDte.notas} onChange={e => setFormSDte(f => ({ ...f, notas: e.target.value }))} />
              </div>

              <button onClick={guardarSinDte} disabled={savingSDte || !formSDte.monto_total}
                style={{ ...st.btn(), width: '100%', opacity: savingSDte || !formSDte.monto_total ? 0.5 : 1 }}>
                {savingSDte ? 'Guardando…' : '💾 Registrar Compra'}
              </button>

              {msgSDte && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8,
                              background: msgSDte.startsWith('✅') ? '#052e16' : '#2d0707',
                              color: msgSDte.startsWith('✅') ? colors.green : colors.accent, fontSize: 13 }}>
                  {msgSDte}
                </div>
              )}
            </div>
          </div>

          {/* Panel derecho: info proveedores sin DTE */}
          <div style={{ flex: '1 1 280px' }}>
            <div style={st.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.blue, marginBottom: 10 }}>
                📋 Proveedores sin DTE por email
              </div>
              {[
                { nombre: 'Flamo SA de CV', tipo: '📷 DTE foto (gas LP)', nota: 'Marco toma foto al recibir' },
                { nombre: 'Unigas de El Salvador', tipo: '📷 DTE foto (gas LP)', nota: 'Marco toma foto al recibir' },
                { nombre: 'Embotelladora La Cascada SA', tipo: '📷 DTE foto (bebidas)', nota: 'Marco toma foto al recibir' },
                { nombre: 'La Constancia LTDA de CV', tipo: '📷 DTE foto (cervezas)', nota: 'Se recibe en sucursal' },
                { nombre: 'Comercializadora Interamericana', tipo: '💵 Posiblemente CF', nota: 'Confirmar con Jose' },
              ].map(p => (
                <div key={p.nombre} style={{ borderBottom: '1px solid #1e1e30', paddingBottom: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#f0f0f0' }}>{p.nombre}</div>
                  <div style={{ fontSize: 11, color: colors.blue }}>{p.tipo}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{p.nota}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
                Cuando el DTE llegue por email, ir a "Conciliar DTEs" para cruzarlo con el egreso de caja correspondiente.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          MODAL EDITAR EGRESO
      ═══════════════════════════════════════════════ */}
      {editEgreso && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: colors.card, borderRadius: 16, padding: 24, width: '90%', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>✏️ Editar Egreso</div>

            <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Motivo</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editEgreso.motivo_nombre} · {fmt$(editEgreso.monto)}</div>

            <div style={{ marginBottom: 10 }}>
              <span style={st.label}>Categoría P&L</span>
              <select style={st.input} value={editEgreso.categoria_gasto_id || ''}
                onChange={e => setEditEgreso(x => ({ ...x, categoria_gasto_id: e.target.value }))}>
                <option value="">— Sin categoría —</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.grupo} → {c.nombre}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <span style={st.label}>Estado de cruce</span>
              <select style={st.input} value={editEgreso.estado_cruce || 'pendiente'}
                onChange={e => setEditEgreso(x => ({ ...x, estado_cruce: e.target.value }))}>
                {Object.entries(ESTADO_CRUCE_LABEL).map(([k,v]) =>
                  <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            {editEgreso.foto_url && (
              <div style={{ marginBottom: 14 }}>
                <a href={editEgreso.foto_url} target="_blank" rel="noreferrer"
                   style={{ color: colors.blue, fontSize: 13 }}>📷 Ver foto adjunta →</a>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardarEgreso} style={{ ...st.btn(), flex: 1 }}>💾 Guardar</button>
              <button onClick={() => setEditEgreso(null)} style={{ ...st.btn('#334'), flex: 1 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
