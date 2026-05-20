// ConciliarTinderTab — UI tipo Tinder para asignar proveedor a cada egreso de caja
// F2 del plan Tinder Conciliación (17-May-2026).
// Reemplaza la tab "Conciliar DTEs" en FinanzasGastosView.
// Backend: RPC suggest_proveedor_para_egreso + columnas excluir_pl en egresos_cierre.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { db as supabase } from '../../supabase'
import { fmtDate, n } from '../../config'

const colors = {
  bg: '#1a1a2e', card: '#16213e', card2: '#1e2a4a',
  accent: '#e63946', gold: '#ffd60a', green: '#4ade80', blue: '#60a5fa',
  gray: '#9ca3af', border: '#2d3a5f'
}

const fmt$ = (v) => `$${n(v).toFixed(2)}`

// Bypass del proxy /sb/ → va directo a Supabase Storage (bucket cierres-fotos es público).
// Evita el límite de invocaciones del Edge Function de Vercel.
const SUPA_HOST = 'https://btboxlwfqcbrdfrlnwln.supabase.co'
const fotoUrlSafe = (url) => {
  if (!url) return url
  // 1) URL con host vercel.app/sb/ → reemplazar host por Supabase directo
  if (url.includes('/sb/storage/')) {
    return url.replace(/^https?:\/\/[^/]+\/sb\//, SUPA_HOST + '/')
  }
  // 2) URL relativa /sb/storage/... → prefijo con host Supabase directo
  if (url.startsWith('/sb/storage/')) {
    return SUPA_HOST + url.replace(/^\/sb\//, '/')
  }
  // 3) URL ya directa o cualquier otra cosa → tal cual
  return url
}

const RAZON_MAP = {
  dte_perfecto:        { label: '✨ MATCH EXACTO DTE',         cls: 'perfecto' },
  dte_alta:            { label: '⚡ DTE match alta',           cls: 'dte' },
  dte_media:           { label: '⚡ DTE match media',          cls: 'dte' },
  dte_baja:            { label: '⚡ DTE cercano',              cls: 'dte' },
  dte_pendiente_match: { label: '⏳ Sin DTE específico',       cls: 'pendiente' },
  frecuente:           { label: '📊 Frecuente',                cls: 'frec' },
  comentario:          { label: '💬 Comentario',               cls: 'coment' },
  ocr:                 { label: '🔍 OCR',                      cls: 'ocr' },
}

export default function ConciliarTinderTab({ user, filtroSucursal, filtroDesde, filtroHasta }) {
  const [tipo, setTipo] = useState('con')                // 'con' = Gasto con Factura, 'sin' = Gasto sin Factura
  const [pendientes, setPendientes] = useState([])       // cola completa
  const [idx, setIdx] = useState(0)                      // posición actual en la cola
  const [skipped, setSkipped] = useState(new Set())      // ids skipped en esta sesión (queda al final)
  const [loading, setLoading] = useState(false)
  const [card, setCard] = useState(null)                 // egreso actual con sugerencias
  const [loadingCard, setLoadingCard] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [counts, setCounts] = useState({ con: 0, sin: 0 })
  const [asignadosSesion, setAsignadosSesion] = useState(0)
  const [excluidosSesion, setExcluidosSesion] = useState(0)
  const [toast, setToast] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [fotoZoom, setFotoZoom] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResult, setOcrResult] = useState(null)
  // Splits del egreso actual (cuando el usuario hace + Otra factura)
  const [splits, setSplits] = useState([])               // {split_id, proveedor_id, nombre, monto, razon, fuente, dte_match_id}
  const [splitMode, setSplitMode] = useState(false)      // True después de agregar el primer split
  const [splitMontoInput, setSplitMontoInput] = useState('')
  // Crear proveedor nuevo
  const [newProvOpen, setNewProvOpen] = useState(false)
  const [newProvForm, setNewProvForm] = useState({
    nombre: '', categoria: '', subcategoria: '', requiere_recepcion: true
  })
  const [newProvSaving, setNewProvSaving] = useState(false)
  const [categoriasGasto, setCategoriasGasto] = useState([])

  const cargandoCardRef = useRef(false)

  // ── Cargar cola de pendientes
  const cargarCola = useCallback(async () => {
    setLoading(true)
    setIdx(0)
    setCard(null)
    setSkipped(new Set())
    const motivo = tipo === 'con' ? 'Gasto con Factura' : 'Gasto sin Factura'
    const { data, error } = await supabase
      .from('egresos_cierre')
      .select(`
        id, motivo_nombre, monto, persona_recibe, comentario, foto_url, ocr_texto,
        estado_cruce, categoria_gasto_id, proveedor_id,
        ventas_diarias!inner(fecha, store_code)
      `)
      .eq('motivo_nombre', motivo)
      .is('proveedor_id', null)
      .in('estado_cruce', ['pendiente', 'sin_dte', 'ambiguo'])
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
      .order('monto', { ascending: false })
      .limit(500)
    if (error) { console.error('[Tinder] cola:', error); setLoading(false); return }
    if (filtroSucursal) {
      setPendientes((data || []).filter(r => r.ventas_diarias?.store_code === filtroSucursal))
    } else {
      setPendientes(data || [])
    }
    setLoading(false)
  }, [tipo, filtroSucursal, filtroDesde, filtroHasta])

  // ── Contadores por tipo (para badges del toggle)
  const cargarContadores = useCallback(async () => {
    const base = supabase.from('egresos_cierre')
      .select('id, ventas_diarias!inner(fecha)', { count: 'exact', head: true })
      .is('proveedor_id', null)
      .in('estado_cruce', ['pendiente','sin_dte','ambiguo'])
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
    const [{ count: c1 }, { count: c2 }] = await Promise.all([
      base.eq('motivo_nombre', 'Gasto con Factura'),
      supabase.from('egresos_cierre')
        .select('id, ventas_diarias!inner(fecha)', { count: 'exact', head: true })
        .eq('motivo_nombre', 'Gasto sin Factura')
        .is('proveedor_id', null)
        .in('estado_cruce', ['pendiente','sin_dte','ambiguo'])
        .gte('ventas_diarias.fecha', filtroDesde)
        .lte('ventas_diarias.fecha', filtroHasta),
    ])
    setCounts({ con: c1 || 0, sin: c2 || 0 })
  }, [filtroDesde, filtroHasta])

  useEffect(() => { cargarCola() }, [cargarCola])
  useEffect(() => { cargarContadores() }, [cargarContadores])

  // Cargar categorías_gasto una sola vez para el dropdown de "Nuevo proveedor"
  useEffect(() => {
    supabase.from('categorias_gasto')
      .select('id, nombre, grupo')
      .order('grupo').order('orden')
      .then(({ data }) => setCategoriasGasto(data || []))
  }, [])

  // ── Cargar sugerencias de la card actual
  const cargarSugerencias = useCallback(async (egreso) => {
    if (!egreso || cargandoCardRef.current) return
    cargandoCardRef.current = true
    setLoadingCard(true)
    const { data: sugs, error } = await supabase
      .rpc('suggest_proveedor_para_egreso', { p_egreso_id: egreso.id })
    if (error) {
      console.error('[Tinder] suggest:', error)
      setCard({ egreso, sugerencias: [] })
    } else {
      setCard({ egreso, sugerencias: sugs || [] })
    }
    setLoadingCard(false)
    cargandoCardRef.current = false
  }, [])

  // ── Cuando avanza idx o se reorganiza la cola, cargar card
  useEffect(() => {
    if (loading) return
    const cola = pendientes.filter(p => !skipped.has(p.id))
                           .concat(pendientes.filter(p => skipped.has(p.id)))
    const egreso = cola[idx]
    if (egreso && (!card || card.egreso.id !== egreso.id)) {
      setOcrResult(null)  // Reset OCR al cambiar card
      setSplits([])         // Reset splits al cambiar card
      setSplitMode(false)
      setSplitMontoInput('')
      cargarSugerencias(egreso)
    } else if (!egreso) {
      setCard(null)
    }
  }, [idx, pendientes, skipped, loading, card, cargarSugerencias])

  // ── Pre-cargar siguiente card en background (para que sea instantáneo)
  const colaOrdenada = useMemo(() => {
    return pendientes.filter(p => !skipped.has(p.id))
                     .concat(pendientes.filter(p => skipped.has(p.id)))
  }, [pendientes, skipped])

  // ── Mostrar toast
  const showToast = (msg, type='') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  // ── Asignar proveedor (con confirmación si excluye P&L)
  const askAsignar = (sugerencia) => {
    if (!card?.egreso) return
    // Si estamos en splitMode y no hay monto input, prefill con el restante
    if (splitMode && !splitMontoInput) {
      setSplitMontoInput(restanteSplit.toFixed(2))
    }
    setConfirm({ sugerencia, egreso: card.egreso })
  }

  // ── Clasificación de la asignación según fuente del proveedor en P&L
  // 4 escenarios → distintos estados + excluir_pl
  const clasificarAsignacion = (s) => {
    const matchExacto    = !!s.dte_match_id
    const tieneDteProv   = !!s.tiene_dte_proveedor
    const tieneBeesOtro  = !!s.tiene_bees_otro
    if (matchExacto)    return { tipo: 'match',     estado: 'cruzado',             excluye: true,  msg: 'Se cruza con DTE existente · no doble conteo' }
    if (tieneDteProv && !tieneBeesOtro) return { tipo: 'pendiente', estado: 'pendiente_dte', excluye: false, msg: 'Sin DTE específico · queda EN P&L hasta que llegue' }
    if (tieneBeesOtro)  return { tipo: 'agregado',  estado: 'excluido_dte_externo', excluye: true,  msg: 'Ya contabilizado en P&L (BEES/sin_dte/PeYa)' }
    return                    { tipo: 'normal',    estado: 'asignado_directo',     excluye: false, msg: 'Entra al P&L normal' }
  }

  // ── Asignar completo (1:1) o agregar split parcial
  const ejecutarAsignar = async (montoSplitOverride = null) => {
    if (!confirm) return
    const { sugerencia, egreso } = confirm
    const esSplit = montoSplitOverride != null || splitMode
    const montoUsar = montoSplitOverride != null
      ? Number(montoSplitOverride)
      : esSplit ? Number(splitMontoInput) : Number(egreso.monto)

    if (esSplit && (!montoUsar || montoUsar <= 0)) {
      showToast('❌ Monto del split debe ser > 0', 'error')
      return
    }
    setConfirm(null)

    const isMatchExacto = !!sugerencia.dte_match_id

    let result
    if (esSplit) {
      // Agregar split
      const { data, error } = await supabase.rpc('agregar_split_egreso', {
        p_egreso_id: egreso.id,
        p_proveedor_id: sugerencia.catalogo_id,
        p_monto: montoUsar,
        p_dte_match_id: sugerencia.dte_match_id || null,
        p_asignado_por: user?.id || null,
        p_comentario: sugerencia.nombre,
        p_tiene_dte_proveedor: !!sugerencia.tiene_dte_proveedor,
        p_tiene_bees_otro:     !!sugerencia.tiene_bees_otro,
      })
      if (error || !(data?.[0]?.ok)) {
        showToast('❌ ' + (error?.message || data?.[0]?.msg || 'Error'), 'error')
        return
      }
      result = data[0]
      setSplits(prev => [...prev, {
        split_id: result.split_id,
        proveedor_id: sugerencia.catalogo_id,
        nombre: sugerencia.nombre,
        monto: montoUsar,
        estado: result.estado_split,
        excluye: result.excluir_pl_split,
        dte_match_id: sugerencia.dte_match_id,
      }])
      setSplitMontoInput('')
      showToast(result.completo
        ? `✓ Split agregado · Egreso COMPLETO ($${montoUsar.toFixed(2)} de $${Number(egreso.monto).toFixed(2)})`
        : `+ Split $${montoUsar.toFixed(2)} agregado · Faltan $${Number(result.restante).toFixed(2)}`,
        result.completo ? 'ok' : 'info')
      if (result.completo) {
        setAsignadosSesion(x => x + 1)
        setPendientes(prev => prev.filter(p => p.id !== egreso.id))
        setCard(null); setSplits([]); setSplitMode(false)
        setCounts(c => ({ ...c, [tipo]: Math.max(0, c[tipo] - 1) }))
      } else {
        setSplitMode(true)  // Ya empezó split mode
      }
    } else {
      // Asignar completo 1:1 via RPC nueva
      const { data, error } = await supabase.rpc('asignar_egreso_completo', {
        p_egreso_id: egreso.id,
        p_proveedor_id: sugerencia.catalogo_id,
        p_dte_match_id: sugerencia.dte_match_id || null,
        p_asignado_por: user?.id || null,
        p_tiene_dte_proveedor: !!sugerencia.tiene_dte_proveedor,
        p_tiene_bees_otro:     !!sugerencia.tiene_bees_otro,
      })
      if (error || !(data?.[0]?.ok)) {
        showToast('❌ ' + (error?.message || data?.[0]?.msg || 'Error'), 'error')
        return
      }
      const r = data[0]
      const cls = clasificarAsignacion(sugerencia)
      setAsignadosSesion(x => x + 1)
      if (r.excluir_pl) setExcluidosSesion(x => x + 1)
      showToast(`✓ ${sugerencia.nombre} · ${cls.msg}`,
        cls.tipo === 'match' ? 'ok' : cls.tipo === 'pendiente' ? 'info' : cls.tipo === 'agregado' ? 'warn' : 'ok')
      setPendientes(prev => prev.filter(p => p.id !== egreso.id))
      setCard(null); setSplits([]); setSplitMode(false)
      setSearch(''); setSearchResults([])
      setCounts(c => ({ ...c, [tipo]: Math.max(0, c[tipo] - 1) }))
    }
  }

  // ── Cancelar splits parciales y revertir egreso a pendiente
  const cancelarSplits = async () => {
    if (splits.length === 0) { setSplitMode(false); return }
    if (!confirm) {/* noop */}
    for (const s of splits) {
      await supabase.rpc('revertir_split_egreso', { p_split_id: s.split_id })
    }
    setSplits([])
    setSplitMode(false)
    showToast(`↩ ${splits.length} splits revertidos`, 'info')
  }

  const restanteSplit = card?.egreso
    ? Number(card.egreso.monto) - splits.reduce((s, x) => s + Number(x.monto || 0), 0)
    : 0

  // ── Skip (queda al final de la cola)
  const skip = () => {
    if (!card?.egreso) return
    setSkipped(s => new Set([...s, card.egreso.id]))
    setIdx(i => i + 1)
    showToast('⏭ Skipeado · queda al final', 'info')
  }

  // ── Marcar No aplica P&L
  const noAplica = async () => {
    if (!card?.egreso) return
    const { error } = await supabase
      .from('egresos_cierre')
      .update({
        estado_cruce: 'ignorar',
        excluir_pl:   true,
        asignado_por: user?.id || null,
        asignado_at:  new Date().toISOString(),
      })
      .eq('id', card.egreso.id)
    if (error) { showToast('❌ ' + error.message, 'error'); return }
    setAsignadosSesion(x => x + 1)
    setExcluidosSesion(x => x + 1)
    showToast('🚫 No aplica P&L (excluido)', 'info')
    setPendientes(prev => prev.filter(p => p.id !== card.egreso.id))
    setCard(null)
    setCounts(c => ({ ...c, [tipo]: Math.max(0, c[tipo] - 1) }))
  }

  // ── F4 OCR Tesseract.js: leer foto del recibo, extraer texto, buscar match en catálogo
  const runOcr = async () => {
    if (!card?.egreso?.foto_url || ocrLoading) return
    setOcrLoading(true)
    setOcrResult(null)

    try {
      // Lazy load Tesseract desde CDN (no en bundle)
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
          s.onload = resolve
          s.onerror = reject
          document.head.appendChild(s)
        })
      }
      const { data: { text } } = await window.Tesseract.recognize(
        fotoUrlSafe(card.egreso.foto_url), 'spa+eng',
        { logger: m => {} }
      )

      const textoLimpio = (text || '').trim().slice(0, 2000)
      setOcrResult(textoLimpio)

      // Cachear en BD
      await supabase
        .from('egresos_cierre')
        .update({ ocr_texto: textoLimpio })
        .eq('id', card.egreso.id)

      // Buscar matches contra catálogo: extraer NITs y nombres
      const textoUpper = textoLimpio.toUpperCase()
      // NIT pattern: 14 dígitos contiguos o con guiones
      const nitsEncontrados = [...textoUpper.matchAll(/\b\d{4}[-]?\d{6}[-]?\d{3}[-]?\d{1}\b/g)]
        .map(m => m[0].replace(/-/g, ''))

      // Buscar proveedores en catalogo por nombre o normalizado dentro del texto OCR
      const { data: catalogo } = await supabase
        .from('catalogo_contable')
        .select('id, nombre_dte, nombre_normalizado, categoria, subcategoria')
        .eq('activo', true)
        .is('duplicado_de', null)

      const matches = (catalogo || [])
        .map(c => {
          const norm = (c.nombre_normalizado || '').toUpperCase()
          let score = 0
          if (norm.length >= 5 && textoUpper.includes(norm)) score = 25
          else {
            // Match parcial: alguna palabra significativa
            const palabras = norm.split(/\s+/).filter(p => p.length >= 5)
            const hits = palabras.filter(p => textoUpper.includes(p)).length
            if (hits >= 1) score = Math.min(20, hits * 8)
          }
          return { ...c, score }
        })
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      // Refrescar sugerencias inyectando OCR como señal extra al inicio
      // Clasificar cada match OCR via RPC para flags correctos (evita bug del set frontend)
      if (matches.length > 0) {
        const clasificaciones = await Promise.all(matches.map(m =>
          supabase.rpc('clasificar_proveedor_para_egreso', {
            p_egreso_id: card.egreso.id,
            p_proveedor_id: m.id,
          }).then(r => (r.data || [])[0] || {})
        ))
        const ocrSugerencias = matches.map((m, i) => {
          const c = clasificaciones[i] || {}
          return {
            catalogo_id: m.id,
            nombre: m.nombre_dte,
            categoria: m.categoria,
            subcategoria: m.subcategoria,
            score: m.score,
            razones: ['ocr'],
            genera_dte: !!c.tiene_bees_otro,
            tiene_dte_proveedor: !!c.tiene_dte_proveedor,
            tiene_bees_otro:     !!c.tiene_bees_otro,
            dte_match_id:        c.dte_match_id || null,
            dte_proveedor:       c.dte_proveedor || null,
            dte_monto:           c.dte_monto || null,
            dte_fecha:           c.dte_fecha || null,
          }
        })
        setCard(prev => prev ? {
          ...prev,
          sugerencias: [
            ...ocrSugerencias.filter(o => !prev.sugerencias.find(s => s.catalogo_id === o.catalogo_id)),
            ...prev.sugerencias.map(s => {
              const ocrMatch = matches.find(m => m.id === s.catalogo_id)
              if (ocrMatch) {
                return {
                  ...s,
                  score: Number(s.score || 0) + ocrMatch.score,
                  razones: [...(s.razones || []), 'ocr']
                }
              }
              return s
            }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
          ]
        } : prev)
        showToast(`🔍 OCR: ${matches.length} candidato${matches.length>1?'s':''} detectado${matches.length>1?'s':''}`, 'ok')
      } else {
        showToast('🔍 OCR ejecutado · sin coincidencias en catálogo', 'info')
      }
    } catch (err) {
      console.error('[OCR]', err)
      showToast('❌ OCR falló: ' + (err.message || 'error'), 'error')
    } finally {
      setOcrLoading(false)
    }
  }

  // ── Búsqueda en catalogo_contable
  const buscar = async (q) => {
    setSearch(q)
    if (!q || q.length < 2) { setSearchResults([]); return }
    const { data } = await supabase
      .from('catalogo_contable')
      .select('id, nombre_dte, categoria, subcategoria')
      .eq('activo', true)
      .is('duplicado_de', null)
      .ilike('nombre_dte', `%${q}%`)
      .order('nombre_dte')
      .limit(6)
    setSearchResults(data || [])
  }

  // Para mostrar genera_dte en resultados de búsqueda, leer de compras_dte últimos 90d en bulk
  // yaEnPlSet = nombres de proveedores que ya están en P&L por otra fuente
  // (compras_dte 90d, compras_bees Constancia, compras_sin_dte 90d, Delivery Hero).
  // Si asignas un egreso a uno de estos → excluir_pl=TRUE para evitar doble conteo.
  const [generaDteSet, setGeneraDteSet] = useState(new Set())
  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (searchResults.length === 0) return
      const desde90 = new Date(Date.now() - 90*86400000).toISOString().split('T')[0]
      const [dte, bees, sinDte] = await Promise.all([
        supabase.from('compras_dte').select('proveedor_nombre').gte('fecha_emision', desde90),
        supabase.from('compras_bees').select('id').gte('fecha', desde90).limit(1),
        supabase.from('compras_sin_dte').select('proveedor_nombre').gte('fecha', desde90),
      ])
      if (cancel) return
      const set = new Set()
      ;(dte.data || []).forEach(d => set.add((d.proveedor_nombre || '').toUpperCase().trim()))
      ;(sinDte.data || []).forEach(d => set.add((d.proveedor_nombre || '').toUpperCase().trim()))
      // Constancia siempre, si hay registros bees recientes
      if ((bees.data || []).length > 0) {
        set.add('LA CONSTANCIA')
        set.add('LA CONSTANCIA (BEES)')
      }
      // Delivery Hero siempre
      set.add('DELIVERY HERO EL SALVADOR, S.A. DE C.V.')
      setGeneraDteSet(set)
    })()
    return () => { cancel = true }
  }, [searchResults])

  // ── Crear proveedor nuevo (catalogo_contable) y opcionalmente asignar al egreso actual
  const abrirNuevoProveedor = () => {
    // Prefill nombre con lo que esté en el buscador
    setNewProvForm({
      nombre: search || '',
      categoria: '',
      subcategoria: '',
      requiere_recepcion: true,
    })
    setNewProvOpen(true)
  }

  const guardarNuevoProveedor = async () => {
    if (!newProvForm.nombre || newProvForm.nombre.trim().length < 3) {
      showToast('❌ Nombre debe tener al menos 3 caracteres', 'error'); return
    }
    if (!newProvForm.categoria) {
      showToast('❌ Selecciona una categoría P&L', 'error'); return
    }
    setNewProvSaving(true)
    const { data, error } = await supabase.rpc('crear_proveedor_catalogo', {
      p_nombre_dte:         newProvForm.nombre.trim(),
      p_categoria:          newProvForm.categoria,
      p_subcategoria:       newProvForm.subcategoria || null,
      p_requiere_recepcion: newProvForm.requiere_recepcion,
    })
    setNewProvSaving(false)
    if (error || !(data?.[0]?.ok)) {
      showToast('❌ ' + (error?.message || data?.[0]?.msg || 'Error'), 'error'); return
    }
    const r = data[0]
    if (r.ya_existia) {
      showToast(`ℹ Ya existía como "${r.nombre_existente}" (id ${r.catalogo_id}) — se usará el existente`, 'warn')
    } else {
      showToast(`✓ Proveedor creado: ${r.nombre_existente || newProvForm.nombre}`, 'ok')
    }
    setNewProvOpen(false)
    // Asignar inmediato al egreso actual
    await asignarBusqueda({
      id: r.catalogo_id,
      nombre_dte: r.nombre_existente || newProvForm.nombre.trim(),
      categoria: newProvForm.categoria,
      subcategoria: newProvForm.subcategoria || null,
    })
  }

  // ── Asignar desde resultado de búsqueda manual
  // Llama RPC clasificar_proveedor_para_egreso para obtener flags correctos
  // (tiene_dte_proveedor, tiene_bees_otro, dte_match_id) — evita el bug de los
  // sets frontend que fallaban con encodings/normalización de nombres.
  const asignarBusqueda = async (cat) => {
    if (!card?.egreso) return
    const { data, error } = await supabase.rpc('clasificar_proveedor_para_egreso', {
      p_egreso_id: card.egreso.id,
      p_proveedor_id: cat.id,
    })
    if (error) {
      console.error('[clasificar_proveedor]', error)
      showToast('❌ Error clasificando proveedor', 'error')
      return
    }
    const c = (data || [])[0] || {}
    askAsignar({
      catalogo_id: cat.id,
      nombre: cat.nombre_dte,
      categoria: cat.categoria,
      subcategoria: cat.subcategoria,
      score: null,
      razones: c.es_perfecto ? ['dte_perfecto', 'manual']
            : c.dte_match_id ? ['dte_alta', 'manual']
            : c.tiene_dte_proveedor && !c.tiene_bees_otro ? ['dte_pendiente_match', 'manual']
            : ['manual'],
      genera_dte: !!c.tiene_bees_otro,
      tiene_dte_proveedor: !!c.tiene_dte_proveedor,
      tiene_bees_otro:     !!c.tiene_bees_otro,
      dte_match_id:        c.dte_match_id || null,
      dte_proveedor:       c.dte_proveedor || null,
      dte_monto:           c.dte_monto || null,
      dte_fecha:           c.dte_fecha || null,
    })
  }

  // ────────────────────── UI ──────────────────────
  const egresoActual = card?.egreso
  const sugerencias  = card?.sugerencias || []
  const total = pendientes.length
  const completado = total + asignadosSesion === 0 ? 0
                   : (asignadosSesion / (total + asignadosSesion) * 100)

  return (
    <div>
      {/* Header con toggle + KPIs */}
      <div style={S.headerWrap}>
        <div style={S.toggle}>
          <button
            onClick={() => setTipo('con')}
            style={{ ...S.toggleBtn, ...(tipo === 'con' ? S.toggleBtnActive : {}) }}>
            🧾 Con Factura · {counts.con}
          </button>
          <button
            onClick={() => setTipo('sin')}
            style={{ ...S.toggleBtn, ...(tipo === 'sin' ? S.toggleBtnActive : {}) }}>
            📝 Sin Factura · {counts.sin}
          </button>
        </div>
        <div style={S.kpiRow}>
          <KPI label="Pendientes" value={total} color={colors.gold} />
          <KPI label="Asignados sesión" value={asignadosSesion} color={colors.green} />
          <KPI label="Excluidos P&L" value={excluidosSesion} color={colors.accent} />
        </div>
      </div>

      <div style={S.hintBox}>
        💡 Asigna el proveedor correcto. Si ya en P&Ls → <strong>excluido del P&L</strong> automáticamente (evita doble conteo). Si no, queda categorizado y sigue contando en P&L.
      </div>

      {/* Progress */}
      <div style={S.progressText}>
        <span>Tarjeta {idx + 1} de {total} · ({asignadosSesion} asignadas esta sesión)</span>
        <span>{completado.toFixed(1)}% completado</span>
      </div>
      <div style={S.progressBar}>
        <div style={{ ...S.progressFill, width: completado + '%' }} />
      </div>

      {loading && <div style={S.empty}>⏳ Cargando cola…</div>}

      {!loading && total === 0 && (
        <div style={{ ...S.empty, color: colors.green }}>
          ✅ Sin pendientes en este periodo y filtros
        </div>
      )}

      {/* Main grid foto + sugerencias */}
      {!loading && egresoActual && (
        <div style={S.main}>
          {/* Foto + meta */}
          <div style={S.cardFoto}>
            <div style={S.fotoWrap} onClick={() => egresoActual.foto_url && setFotoZoom(true)}>
              {egresoActual.foto_url ? (
                <img src={fotoUrlSafe(egresoActual.foto_url)} alt="recibo"
                     style={S.fotoImg}
                     onError={(e) => { e.target.style.display = 'none' }} />
              ) : (
                <div style={S.fotoEmpty}>
                  <div style={{ fontSize: 56, opacity: 0.4 }}>📭</div>
                  <div>Sin foto · {egresoActual.motivo_nombre}</div>
                  {egresoActual.comentario && (
                    <div style={S.fotoEmptyComent}>
                      <strong style={{ color: colors.gold }}>Comentario:</strong><br/>
                      <em>"{egresoActual.comentario}"</em>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={S.metaEgreso}>
              <div style={S.metaMonto}>{fmt$(egresoActual.monto)}</div>
              <div style={S.metaFecha}>
                {egresoActual.ventas_diarias?.fecha ? fmtDate(egresoActual.ventas_diarias.fecha) : '—'} · {egresoActual.ventas_diarias?.store_code || '—'}
              </div>
              <div style={S.metaRow}>
                <div style={S.metaTag}>{egresoActual.motivo_nombre}</div>
                {egresoActual.persona_recibe && <div style={S.metaTag}>👤 {egresoActual.persona_recibe}</div>}
                <div style={{ ...S.metaTag, ...S.metaTagWarn }}>
                  {egresoActual.estado_cruce || 'pendiente'}
                </div>
              </div>
              {egresoActual.comentario && egresoActual.foto_url && (
                <div style={S.metaComent}>💬 {egresoActual.comentario}</div>
              )}
            </div>
          </div>

          {/* Panel sugerencias */}
          <div style={S.panel}>
            {/* Split panel — visible cuando hay splits parciales */}
            {splitMode && splits.length > 0 && (
              <div style={S.splitPanel}>
                <div style={S.splitHead}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.gold }}>
                    🧾 Splits ({splits.length})
                  </span>
                  <span style={{ fontSize: 12, color: colors.gray }}>
                    {fmt$(Number(egresoActual.monto) - restanteSplit)} de {fmt$(egresoActual.monto)} ·
                    {' '}<strong style={{ color: restanteSplit < 1 ? colors.green : colors.gold }}>
                      Faltan {fmt$(restanteSplit)}
                    </strong>
                  </span>
                </div>
                {splits.map((sp) => (
                  <div key={sp.split_id} style={S.splitRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{sp.nombre}</div>
                      <div style={{ fontSize: 11, color: colors.gray }}>
                        {fmt$(sp.monto)} · {sp.estado}
                        {sp.excluye && <span style={{ color: colors.accent }}> · excluido P&L</span>}
                      </div>
                    </div>
                    <button style={S.btnSplitRemove}
                            onClick={async () => {
                              await supabase.rpc('revertir_split_egreso', { p_split_id: sp.split_id })
                              setSplits(prev => prev.filter(x => x.split_id !== sp.split_id))
                              showToast('↩ Split removido', 'info')
                            }}>
                      ✕
                    </button>
                  </div>
                ))}
                <div style={{ padding: '8px 14px', display: 'flex', gap: 6 }}>
                  <button style={S.btnSplitCancel} onClick={cancelarSplits}>↩ Cancelar todo</button>
                </div>
              </div>
            )}

            <div style={S.panelHead}>
              <div style={S.panelTitle}>
                {splitMode ? '➕ Selecciona el siguiente proveedor' : '💡 Sugerencias'}
              </div>
              <div style={S.panelCounter}>
                {loadingCard ? '…' : `${sugerencias.length} candidatos`}
              </div>
            </div>

            {loadingCard && <div style={S.empty}>Analizando…</div>}

            {!loadingCard && sugerencias.length === 0 && (
              <div style={{ ...S.empty, fontSize: 12 }}>
                Sin sugerencias automáticas. Usa la búsqueda abajo 👇
              </div>
            )}

            {!loadingCard && sugerencias.map((s, i) => {
              const scoreNum = Number(s.score || 0)
              const esPerfecto = (s.razones || []).includes('dte_perfecto')
              const scoreCls = esPerfecto      ? 'perfecto'
                             : scoreNum >= 50  ? 'high'
                             : scoreNum >= 25  ? 'med'
                             : 'low'
              return (
                <div key={s.catalogo_id}
                     style={{ ...S.sugRow, ...(esPerfecto ? S.sugRowPerfecto : {}) }}
                     onClick={() => askAsignar(s)}>
                  <div style={{ ...S.scorePill, ...S.scorePillStyles[scoreCls] }}>
                    {scoreNum > 0 ? Math.round(scoreNum) : '?'}
                  </div>
                  <div style={S.sugInfo}>
                    <div style={S.sugNombre}>{s.nombre}</div>
                    <div style={S.sugMeta}>
                      {s.subcategoria || s.categoria || '—'}
                      {s.dte_proveedor && s.dte_monto && (
                        <span style={{ color: colors.gold }}> · DTE {fmt$(s.dte_monto)} {fmtDate(s.dte_fecha)}</span>
                      )}
                    </div>
                    <div style={S.razones}>
                      {(s.razones || []).map(r => {
                        const m = RAZON_MAP[r]
                        return m ? (
                          <span key={r} style={{ ...S.razon, ...S.razonStyles[m.cls] }}>{m.label}</span>
                        ) : null
                      })}
                    </div>
                    {s.genera_dte && (
                      <div style={S.excludeFlag}>⚠ Ya está en P&L · Se excluirá para evitar doble conteo</div>
                    )}
                  </div>
                  <button style={S.btnAsignar} onClick={(e) => { e.stopPropagation(); askAsignar(s) }}>
                    ✓ Asignar
                  </button>
                </div>
              )
            })}

            {/* Búsqueda manual */}
            <div style={S.searchBox}>
              <label style={S.searchLabel}>🔎 Buscar otro proveedor</label>
              <input
                style={S.searchInput}
                placeholder="Pricesmart, Tropigas, Freund..."
                value={search}
                onChange={(e) => buscar(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div style={S.searchResults}>
                  {searchResults.map(r => {
                    const dte = generaDteSet.has((r.nombre_dte || '').toUpperCase().trim())
                    return (
                      <div key={r.id} style={S.searchRow} onClick={() => asignarBusqueda(r)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nombre_dte}</div>
                          <div style={S.sugMeta}>
                            {r.subcategoria || r.categoria}{dte ? ' · ⚡ ya en P&L' : ' · no en P&L'}
                          </div>
                        </div>
                        <button style={{ ...S.btnAsignar, padding: '5px 8px', fontSize: 11 }}>✓</button>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* Botón crear nuevo proveedor — visible siempre */}
              <button style={S.btnNuevoProv} onClick={abrirNuevoProveedor}>
                ➕ Crear proveedor nuevo
                {search && <span style={{ color: colors.gold, marginLeft: 4 }}>"{search.slice(0, 30)}"</span>}
              </button>
            </div>

            {/* Acciones */}
            <div style={S.actions}>
              <button style={S.btnNoPl} onClick={noAplica}>🚫 No aplica</button>
              <button style={S.btnSkip} onClick={skip}>⏭ Skip</button>
              {!splitMode && (
                <button style={S.btnSplit}
                        onClick={() => { setSplitMode(true); setSplitMontoInput('') }}
                        title="Si la foto tiene varias facturas, divide el egreso entre múltiples proveedores">
                  ✂ Split
                </button>
              )}
              {egresoActual?.foto_url && (
                <button style={S.btnOcr}
                        onClick={runOcr}
                        disabled={ocrLoading}
                        title={ocrResult ? 'OCR ya ejecutado' : 'Leer texto de la foto y buscar proveedor'}>
                  {ocrLoading ? '⏳ Leyendo…' : '🔍 OCR'}
                </button>
              )}
            </div>
            {ocrResult && (
              <div style={S.ocrPanel}>
                <strong style={{ color: '#f9a8d4' }}>🔍 Texto OCR detectado:</strong>
                <div style={S.ocrText}>{ocrResult.slice(0, 240)}{ocrResult.length > 240 ? '…' : ''}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...S.toast, ...(toast.type === 'warn' ? S.toastWarn : toast.type === 'error' ? S.toastError : toast.type === 'info' ? S.toastInfo : S.toastOk) }}>
          {toast.msg}
        </div>
      )}

      {/* Confirm modal — 4 variantes según fuente del proveedor en P&L */}
      {confirm && (() => {
        const cls = clasificarAsignacion(confirm.sugerencia)
        const esSplit = splitMode
        const montoInputNum = Number(splitMontoInput) || 0
        const restanteValido = !esSplit || (montoInputNum > 0 && montoInputNum <= restanteSplit + 1)
        return (
          <div style={S.modalBg} onClick={() => setConfirm(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
                {esSplit ? '➕ Agregar split' : 'Asignar'} a <span style={{ color: colors.gold }}>{confirm.sugerencia.nombre}</span>
              </div>
              <div style={{ fontSize: 13, color: colors.gray, marginBottom: 14 }}>
                Egreso <strong style={{ color: colors.gold }}>{fmt$(confirm.egreso.monto)}</strong>
                {' '}· {fmtDate(confirm.egreso.ventas_diarias?.fecha)} · {confirm.egreso.ventas_diarias?.store_code}
                {esSplit && <> · Faltan <strong style={{ color: colors.gold }}>{fmt$(restanteSplit)}</strong></>}
              </div>

              {/* Input de monto si es split */}
              {esSplit && (
                <div style={{ marginBottom: 12 }}>
                  <label style={S.searchLabel}>Monto de esta factura</label>
                  <input
                    type="number" step="0.01" autoFocus
                    style={S.searchInput}
                    placeholder={`Máx ${restanteSplit.toFixed(2)}`}
                    value={splitMontoInput}
                    onChange={(e) => setSplitMontoInput(e.target.value)}
                  />
                  {montoInputNum > restanteSplit + 1 && (
                    <div style={{ fontSize: 11, color: colors.accent, marginTop: 4 }}>
                      ⚠ Excede el restante por ${(montoInputNum - restanteSplit).toFixed(2)}
                    </div>
                  )}
                </div>
              )}

              {/* Hint según clasificación */}
              {cls.tipo === 'match' && (
                <div style={S.confirmPerfecto}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 6 }}>✨ MATCH EXACTO con DTE existente</div>
                  Se va a <strong>cruzar con el DTE</strong>:
                  <div style={{ marginTop: 8, padding: 8, background: 'rgba(16,185,129,0.1)', borderRadius: 6 }}>
                    <strong>{confirm.sugerencia.dte_proveedor || confirm.sugerencia.nombre}</strong><br/>
                    DTE: <strong>{fmt$(confirm.sugerencia.dte_monto)}</strong> del {fmtDate(confirm.sugerencia.dte_fecha)}<br/>
                    Egreso: <strong>{fmt$(esSplit ? montoInputNum : confirm.egreso.monto)}</strong>
                    {' · Diff '}<strong>{fmt$(Math.abs(n(confirm.sugerencia.dte_monto) - (esSplit ? montoInputNum : n(confirm.egreso.monto))))}</strong>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#6ee7b7' }}>
                    ✓ DTE → <code>cruzado=TRUE</code> · ✓ Egreso vinculado · ✓ EXCLUIDO P&L (no duplica)
                  </div>
                </div>
              )}
              {cls.tipo === 'pendiente' && (
                <div style={S.confirmPendiente}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: colors.gold, marginBottom: 6 }}>⏳ SIN DTE ESPECÍFICO en BD</div>
                  <strong>{confirm.sugerencia.nombre}</strong> envía DTEs por email pero <strong>no encontramos el DTE</strong> que corresponde a este egreso (monto ±monto, fecha ±14d).
                  <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,214,10,0.08)', borderRadius: 6, fontSize: 12 }}>
                    ✓ Egreso queda <code>pendiente_dte</code> · ✓ <strong>SÍ entra al P&L</strong> hasta que llegue el DTE<br/>
                    Cuando llegue el DTE, lo cruzas manualmente desde la tab Excluidos P&L.
                  </div>
                </div>
              )}
              {cls.tipo === 'agregado' && (
                <div style={S.confirmWarn}>
                  ⚠ <strong>{confirm.sugerencia.nombre}</strong> ya está contabilizado en el P&L por otra fuente (BEES / Excel manual / PeYa prorrateado).
                  <div style={{ marginTop: 6, fontSize: 12 }}>El egreso se <strong>excluirá</strong> para evitar doble conteo.</div>
                </div>
              )}
              {cls.tipo === 'normal' && (
                <div style={S.confirmOk}>
                  ✓ <strong>{confirm.sugerencia.nombre}</strong> no está en otra fuente del P&L. El gasto contará bajo <strong>{confirm.sugerencia.subcategoria || confirm.sugerencia.categoria}</strong>.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button style={S.btnCancel} onClick={() => setConfirm(null)}>Cancelar</button>
                <button style={{ ...S.btnConfirm, opacity: restanteValido ? 1 : 0.5 }}
                        disabled={!restanteValido}
                        onClick={() => ejecutarAsignar()}>
                  {esSplit ? 'Agregar split' : 'Confirmar asignación'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Foto zoom modal */}
      {fotoZoom && egresoActual?.foto_url && (
        <div style={S.modalBg} onClick={() => setFotoZoom(false)}>
          <img src={fotoUrlSafe(egresoActual.foto_url)} alt="" style={S.fotoZoomImg} />
        </div>
      )}

      {/* Modal: crear proveedor nuevo */}
      {newProvOpen && (
        <div style={S.modalBg} onClick={() => !newProvSaving && setNewProvOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4, color: colors.blue }}>
              ➕ Crear proveedor nuevo
            </div>
            <div style={{ fontSize: 12, color: colors.gray, marginBottom: 14 }}>
              Se agregará a <code>catalogo_contable</code> y se asignará al egreso actual.
            </div>

            <div style={S.formRow}>
              <label style={S.formLabel}>Nombre del proveedor *</label>
              <input style={S.formInput} autoFocus
                value={newProvForm.nombre}
                placeholder="Ej: Calleja, S.A. de C.V."
                onChange={e => setNewProvForm(f => ({...f, nombre: e.target.value}))} />
            </div>

            <div style={S.formRow}>
              <label style={S.formLabel}>Categoría P&L *</label>
              <select style={S.formInput}
                value={newProvForm.categoria}
                onChange={e => setNewProvForm(f => ({...f, categoria: e.target.value}))}>
                <option value="">— Seleccionar —</option>
                {categoriasGasto.map(c => (
                  <option key={c.id} value={c.id}>{c.grupo} · {c.nombre}</option>
                ))}
              </select>
            </div>

            <div style={S.formRow}>
              <label style={S.formLabel}>Subcategoría (opcional)</label>
              <input style={S.formInput}
                value={newProvForm.subcategoria}
                placeholder="Ej: Insumos Cocina, Servicios Públicos..."
                onChange={e => setNewProvForm(f => ({...f, subcategoria: e.target.value}))} />
            </div>

            <div style={S.formRow}>
              <label style={S.formCheckbox}>
                <input type="checkbox"
                  checked={newProvForm.requiere_recepcion}
                  onChange={e => setNewProvForm(f => ({...f, requiere_recepcion: e.target.checked}))} />
                <span>Requiere recepción física (items inventariables)</span>
              </label>
              <div style={{ fontSize: 10, color: colors.gray, marginTop: 4, marginLeft: 24 }}>
                Desmarca para servicios (Tigo, Electricidad, Bancos, etc.)
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={S.btnCancel} disabled={newProvSaving}
                onClick={() => setNewProvOpen(false)}>Cancelar</button>
              <button style={{ ...S.btnConfirm, opacity: newProvSaving ? 0.6 : 1 }}
                disabled={newProvSaving}
                onClick={guardarNuevoProveedor}>
                {newProvSaving ? 'Guardando…' : 'Crear y asignar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div style={S.kpi}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color }}>{value}</div>
    </div>
  )
}

// ────────────────────── Estilos ──────────────────────
const S = {
  headerWrap: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 },
  toggle: { display: 'flex', background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 4, gap: 4 },
  toggleBtn: { background: 'transparent', border: 'none', color: colors.gray, padding: '8px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s' },
  toggleBtnActive: { background: colors.accent, color: '#fff', boxShadow: '0 2px 8px rgba(230,57,70,0.4)' },
  kpiRow: { display: 'flex', gap: 8 },
  kpi: { background: colors.card, border: `1px solid ${colors.border}`, padding: '8px 12px', borderRadius: 8, minWidth: 90 },
  kpiLabel: { fontSize: 10, color: colors.gray, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 18, fontWeight: 800, marginTop: 2 },

  hintBox: { background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.3)', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: '#93c5fd', marginBottom: 12 },
  progressText: { fontSize: 11, color: colors.gray, marginBottom: 6, display: 'flex', justifyContent: 'space-between' },
  progressBar: { background: colors.card, height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 14, border: `1px solid ${colors.border}` },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${colors.green}, ${colors.blue})`, transition: 'width 0.3s' },
  empty: { textAlign: 'center', padding: 30, fontSize: 13, color: colors.gray },

  main: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1.1fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' },

  cardFoto: { background: colors.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  fotoWrap: { background: '#0a0a14', aspectRatio: '4/5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-in', overflow: 'hidden' },
  fotoImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  fotoEmpty: { textAlign: 'center', color: colors.gray, fontSize: 14, padding: 24 },
  fotoEmptyComent: { marginTop: 14, fontSize: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 },
  metaEgreso: { padding: '14px 16px', borderTop: `1px solid ${colors.border}` },
  metaMonto: { fontSize: 28, fontWeight: 800, color: colors.gold },
  metaFecha: { fontSize: 12, color: colors.gray, marginTop: 2 },
  metaRow: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  metaTag: { background: colors.card2, border: `1px solid ${colors.border}`, padding: '3px 9px', borderRadius: 6, fontSize: 11, color: colors.gray },
  metaTagWarn: { background: '#3a2510', borderColor: '#7a4a1a', color: colors.gold },
  metaComent: { marginTop: 8, fontSize: 12, color: '#cbd5e1', fontStyle: 'italic' },

  panel: { background: colors.card, borderRadius: 14, border: `1px solid ${colors.border}`, overflow: 'hidden' },
  panelHead: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { fontSize: 14, fontWeight: 700, color: '#f0f0f0' },
  panelCounter: { fontSize: 11, color: colors.gray, background: colors.card2, padding: '3px 9px', borderRadius: 10 },

  sugRow: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', transition: 'background 0.15s' },
  sugRowPerfecto: { background: 'linear-gradient(90deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%)', borderLeft: '3px solid #10b981' },
  scorePill: { fontWeight: 800, fontSize: 12, padding: '5px 7px', borderRadius: 7, minWidth: 36, textAlign: 'center', alignSelf: 'center' },
  scorePillStyles: {
    perfecto: { background: '#10b981', color: '#fff', boxShadow: '0 0 0 2px rgba(16,185,129,0.4)' },
    high:     { background: colors.green, color: '#0a2418' },
    med:      { background: colors.gold,  color: '#3a2510' },
    low:      { background: colors.gray,  color: '#1a1a2e' },
  },
  sugInfo: { flex: 1, minWidth: 0 },
  sugNombre: { fontWeight: 700, fontSize: 13, color: '#f0f0f0', marginBottom: 2 },
  sugMeta: { fontSize: 11, color: colors.gray, marginBottom: 4 },
  razones: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  razon: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: colors.card2, color: colors.gray, border: `1px solid ${colors.border}` },
  razonStyles: {
    perfecto:  { background: '#064e3b', borderColor: '#10b981', color: '#6ee7b7', fontWeight: 800, fontSize: 11, padding: '3px 8px', textTransform: 'uppercase' },
    dte:       { background: '#1a3a1a', borderColor: '#2a5a2a', color: '#86efac' },
    pendiente: { background: '#3a2510', borderColor: '#7a5a10', color: colors.gold, fontWeight: 700 },
    frec:      { background: '#1a2a4a', borderColor: '#2a4a7a', color: '#93c5fd' },
    ocr:       { background: '#3a1a2a', borderColor: '#7a2a4a', color: '#f9a8d4' },
    coment:    { background: '#3a3a1a', borderColor: '#7a7a2a', color: colors.gold },
  },
  excludeFlag: { fontSize: 10, color: colors.accent, marginTop: 4, fontWeight: 600 },
  btnAsignar: { background: colors.green, color: '#0a2418', border: 'none', padding: '7px 11px', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer', alignSelf: 'center', whiteSpace: 'nowrap' },

  searchBox: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.card2 },
  searchLabel: { fontSize: 10, color: colors.gray, display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  searchInput: { width: '100%', background: colors.bg, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '8px 11px', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' },
  searchResults: { marginTop: 7, maxHeight: 200, overflowY: 'auto' },
  searchRow: { padding: '7px 0', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' },

  actions: { padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' },
  btnNoPl: { flex: 1, background: colors.card2, border: `1px solid ${colors.border}`, color: colors.gray, padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },
  btnSkip:  { flex: 1, background: colors.card2, border: '1px solid #7a5a10', color: colors.gold, padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },
  btnOcr:   { flex: 1, background: colors.card2, border: '1px solid #7a2a4a', color: '#f9a8d4', padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },
  btnSplit: { flex: 1, background: colors.card2, border: '1px solid #2a5a2a', color: '#86efac', padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },

  splitPanel: { padding: '10px 0', borderBottom: `1px solid ${colors.border}`, background: 'rgba(255,214,10,0.04)' },
  splitHead:  { padding: '4px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  splitRow:   { padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${colors.border}` },
  btnSplitRemove: { background: 'transparent', border: '1px solid #7a1a2a', color: colors.accent, padding: '4px 9px', borderRadius: 5, fontSize: 14, cursor: 'pointer', lineHeight: 1 },
  btnSplitCancel: { flex: 1, background: 'transparent', border: '1px solid #7a1a2a', color: colors.accent, padding: '7px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  btnNuevoProv:   { width: '100%', marginTop: 8, background: 'rgba(96,165,250,0.1)', border: '1px dashed #2a4a7a', color: colors.blue, padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' },
  formRow:        { marginBottom: 12 },
  formLabel:      { fontSize: 10, color: colors.gray, display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput:      { width: '100%', background: colors.bg, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '8px 11px', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' },
  formCheckbox:   { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0f0f0', cursor: 'pointer' },
  ocrPanel: { padding: '10px 16px', borderTop: `1px solid ${colors.border}`, background: 'rgba(58,26,42,0.3)', fontSize: 11 },
  ocrText: { marginTop: 4, color: '#cbd5e1', fontFamily: 'ui-monospace, monospace', fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' },

  toast: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '13px 20px', borderRadius: 11, fontWeight: 700, fontSize: 13, boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 1000 },
  toastOk:    { background: colors.green, color: '#0a2418' },
  toastWarn:  { background: colors.gold,  color: '#3a2510' },
  toastInfo:  { background: colors.blue,  color: '#0a1a3a' },
  toastError: { background: colors.accent, color: '#fff' },

  modalBg: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20 },
  modal: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 20, maxWidth: 460, width: '100%', boxShadow: '0 12px 36px rgba(0,0,0,0.5)' },
  confirmWarn:      { padding: 12, background: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.3)', borderRadius: 8, color: colors.gold, fontSize: 13 },
  confirmOk:        { padding: 12, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, color: colors.green, fontSize: 13 },
  confirmPerfecto:  { padding: 14, background: 'rgba(16,185,129,0.08)', border: '2px solid #10b981', borderRadius: 8, color: '#86efac', fontSize: 13 },
  confirmPendiente: { padding: 14, background: 'rgba(255,214,10,0.05)', border: '2px solid #7a5a10', borderRadius: 8, color: colors.gold, fontSize: 13 },
  btnCancel:   { flex: 1, background: colors.card2, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 600 },
  btnConfirm:  { flex: 2, background: colors.accent, border: 'none', color: '#fff', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 700 },

  fotoZoomImg: { maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.6)' },
}
