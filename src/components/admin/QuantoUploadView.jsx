import { useState, useRef } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════
   FREAKIE DOGS — IMPORTAR QUANTO
   Subir diario: (1) ZIP DTE JSONs  (2) CSV TICKETS
   Roles: admin / superadmin / ejecutivo
   ═══════════════════════════════════════════════════════════ */

// Mapping store_code → sucursal_id (validado en backfill)
const STORE_TO_SUC = {
  'M001': '8ffb29ec-3d58-4ae1-b0d4-bcd12202456e',
  'S001': '04bcc11a-affa-44b4-9fec-b90d00639cf3',
  'S002': '1382bdc6-4349-43af-86e9-1989b9b529de',
  'S003': 'e712df8e-344c-4fad-94a9-fa06106d0f71',
  'S004': 'f022554d-88b9-4ba5-aba5-8bbd0fb3f3ec',
}
const FOOD_COURTS = ['S001', 'S002']
const CANAL_MAP = {
  'Mesas': 'mesa',
  'Llevar': 'para_llevar',
  'Domicilio': 'delivery_propio',
  'PedidosYa': 'peya',
}


// PeYa local_id → store_code
const LOCAL_TO_STORE_PEYA = {
  '224235': 'M001',
  '519400': 'S001',
  '567479': 'S002',
  '583558': 'S003',
  '593019': 'S004',
}

// Helpers PeYa CSV (formato europeo: "9,50" → 9.50  |  "1.234,56" → 1234.56)
function numEU(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}
function boolifyES(v) {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  if (['sí','si','yes','true','1'].includes(s)) return true
  if (['no','false','0',''].includes(s)) return false
  return null
}
function tsLocalToISO(v) {
  if (!v) return null
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!m) return null
  // Construir como UTC-6 (El Salvador)
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-06:00`
}

// canal_venta heurístico (cuando solo tenemos DTE sin CSV)
function canalFromDte(store, propina) {
  if (FOOD_COURTS.includes(store)) return 'para_llevar'
  return propina > 0 ? 'mesa' : 'para_llevar'
}

// Cargar JSZip dinámico desde CDN
async function loadJSZip() {
  if (window.JSZip) return window.JSZip
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = () => resolve(window.JSZip)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function parseDte(filename, doc) {
  const ident = doc.identificacion || {}
  const resumen = doc.resumen || {}
  const rec = doc.receptor || {}
  const items = doc.cuerpoDocumento || []
  const pagos = resumen.pagos || []

  const store = filename.split('-')[2].split('P')[0]
  const sucId = STORE_TO_SUC[store]
  if (!sucId) return null

  const nc = ident.numeroControl || ''
  let numeroOrden = 0
  try { numeroOrden = parseInt(nc.split('-').pop(), 10) || 0 } catch {}

  // Propina = SUM items donde descripcion='Propina'
  let propina = 0
  for (const it of items) {
    if ((it.descripcion || '').trim().toLowerCase() === 'propina') {
      propina += (parseFloat(it.ventaGravada) || 0) + (parseFloat(it.noGravado) || 0)
    }
  }
  propina = Math.round(propina * 100) / 100

  const orderId = crypto.randomUUID()
  const cab = {
    id: orderId,
    store_code: store,
    sucursal_id: sucId,
    numero_orden: numeroOrden,
    fecha: ident.fecEmi,
    hora: ident.horEmi,
    codigo_generacion: ident.codigoGeneracion,
    numero_control: ident.numeroControl,
    tipo_dte: ident.tipoDte,
    ambiente: ident.ambiente,
    sello_recibido: doc.selloRecibido,
    receptor_nombre: rec.nombre,
    receptor_nrc: rec.nrc,
    receptor_documento: rec.numDocumento,
    condicion_operacion: resumen.condicionOperacion,
    metodo_pago: pagos[0]?.codigo || null,
    pagos_json: pagos.length ? pagos : null,
    total_gravada:    parseFloat(resumen.totalGravada)    || 0,
    total_no_gravada: parseFloat(resumen.totalNoGravado)  || 0,
    total_exenta:     parseFloat(resumen.totalExenta)     || 0,
    total_iva:        parseFloat(resumen.totalIva)        || 0,
    total_descuento:  parseFloat(resumen.totalDescu)      || 0,
    total_pagar:      parseFloat(resumen.totalPagar)      || 0,
    propina,
    canal_venta: canalFromDte(store, propina),
    source: 'dte_quanto',
    json_raw: doc,
  }

  const itemRows = items.map((it) => ({
    orden_id: orderId,
    numero_item: it.numItem,
    descripcion: it.descripcion || '',
    tipo_item: it.tipoItem,
    cantidad: parseFloat(it.cantidad) || 0,
    unidad_medida: it.uniMedida,
    precio_unitario: parseFloat(it.precioUni) || 0,
    monto_descuento: parseFloat(it.montoDescu) || 0,
    venta_gravada:   parseFloat(it.ventaGravada) || 0,
    venta_no_sujeta: parseFloat(it.ventaNoSuj)   || 0,
    venta_exenta:    parseFloat(it.ventaExenta)  || 0,
    no_gravado:      parseFloat(it.noGravado)    || 0,
    iva_item:        parseFloat(it.ivaItem)      || 0,
  }))

  return { cab, items: itemRows }
}

// Parser CSV simple (maneja comillas)
function parseCsv(text) {
  const rows = []
  let i = 0, field = '', row = [], inQuote = false
  while (i < text.length) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2 }
      else if (c === '"') { inQuote = false; i++ }
      else { field += c; i++ }
    } else {
      if (c === '"') { inQuote = true; i++ }
      else if (c === ',') { row.push(field); field = ''; i++ }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' }
        if (c === '\r' && text[i + 1] === '\n') i++
        i++
      } else { field += c; i++ }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export default function QuantoUploadView({ user }) {
  const [zipStatus, setZipStatus] = useState(null)
  const [csvStatus, setCsvStatus] = useState(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  const [peyaStatus, setPeyaStatus] = useState(null)
  const [peyaBusy, setPeyaBusy] = useState(false)
  const zipRef = useRef(null)
  const csvRef = useRef(null)
  const peyaRef = useRef(null)

  // ═══════════════════════════════════════════════════════════
  // Procesar ZIP DTE
  // ═══════════════════════════════════════════════════════════
  async function handleZip(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setZipBusy(true)
    setZipStatus({ phase: 'reading', msg: `Leyendo ${file.name}...` })
    try {
      const JSZip = await loadJSZip()
      const zip = await JSZip.loadAsync(file)
      const jsonFiles = Object.keys(zip.files).filter(n => n.endsWith('.json'))
      setZipStatus({ phase: 'parsing', msg: `${jsonFiles.length} archivos JSON detectados...`, total: jsonFiles.length, done: 0, ok: 0, dup: 0, err: 0 })

      let ok = 0, dup = 0, err = 0
      const BATCH = 50
      let bufCab = [], bufItems = []

      const flush = async () => {
        if (!bufCab.length) return
        try {
          const { error: e1 } = await db.from('quanto_ordenes').upsert(bufCab, { onConflict: 'codigo_generacion', ignoreDuplicates: true })
          if (e1) throw e1
          if (bufItems.length) {
            const { error: e2 } = await db.from('quanto_orden_items').upsert(bufItems, { onConflict: 'orden_id,numero_item', ignoreDuplicates: true })
            if (e2) throw e2
          }
          ok += bufCab.length
        } catch (ex) {
          // Si UNIQUE conflict, asumimos duplicado
          if (String(ex.message || ex).match(/duplicate|unique/i)) dup += bufCab.length
          else err += bufCab.length
        }
        bufCab = []; bufItems = []
      }

      for (let i = 0; i < jsonFiles.length; i++) {
        const name = jsonFiles[i]
        try {
          const content = await zip.files[name].async('string')
          const doc = JSON.parse(content.replace(/^﻿/, ''))
          const parsed = parseDte(name, doc)
          if (!parsed) { err++; continue }
          bufCab.push(parsed.cab)
          bufItems.push(...parsed.items)
        } catch {
          err++
        }
        if (bufCab.length >= BATCH) await flush()
        if ((i + 1) % 100 === 0) {
          setZipStatus({ phase: 'inserting', msg: `${i + 1}/${jsonFiles.length}`, total: jsonFiles.length, done: i + 1, ok, dup, err })
        }
      }
      await flush()
      setZipStatus({ phase: 'done', msg: `✓ ${ok} insertados · ${dup} duplicados (omitidos) · ${err} errores`, total: jsonFiles.length, done: jsonFiles.length, ok, dup, err })
    } catch (ex) {
      setZipStatus({ phase: 'error', msg: `✗ ${ex.message || ex}` })
    } finally {
      setZipBusy(false)
      if (zipRef.current) zipRef.current.value = ''
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Procesar CSV TICKETS
  // ═══════════════════════════════════════════════════════════
  async function handleCsv(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvBusy(true)
    setCsvStatus({ phase: 'reading', msg: `Leyendo ${file.name}...` })
    try {
      const text = await file.text()
      const rows = parseCsv(text.replace(/^﻿/, ''))
      const headers = rows.shift()
      // Indices de columnas que necesitamos (la 1ra ocurrencia de cada nombre, ojo con 'Sucursal' duplicada)
      const idx = {}
      const want = ['Codigo de Generacion', 'Tipo de orden', 'Autorizado por', 'Cliente', 'Dispositivo', 'Total']
      for (const w of want) idx[w] = headers.indexOf(w)
      if (idx['Codigo de Generacion'] < 0) throw new Error('CSV sin columna "Codigo de Generacion"')

      const updates = rows.filter(r => r[idx['Codigo de Generacion']]).map(r => {
        const aut = (r[idx['Autorizado por']] || '').trim()
        const tipo = (r[idx['Tipo de orden']] || '').trim()
        const canal = aut.toLowerCase().includes('drive') ? 'drivethrough' : (CANAL_MAP[tipo] || 'otro')
        return {
          codigo: r[idx['Codigo de Generacion']].toUpperCase(),
          canal,
          autorizado_por: aut || null,
          cliente_nombre: (r[idx['Cliente']] || '').trim() || null,
          dispositivo: (r[idx['Dispositivo']] || '').trim() || null,
        }
      })

      setCsvStatus({ phase: 'updating', msg: `${updates.length} órdenes a actualizar...`, total: updates.length, done: 0, ok: 0, err: 0 })
      let ok = 0, err = 0
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i]
        try {
          const { error } = await db.from('quanto_ordenes').update({
            canal_venta: u.canal,
            autorizado_por: u.autorizado_por,
            cliente_nombre: u.cliente_nombre,
            dispositivo: u.dispositivo,
          }).eq('codigo_generacion', u.codigo)
          if (error) throw error
          ok++
        } catch { err++ }
        if ((i + 1) % 50 === 0) {
          setCsvStatus({ phase: 'updating', msg: `${i + 1}/${updates.length}`, total: updates.length, done: i + 1, ok, err })
        }
      }
      setCsvStatus({ phase: 'done', msg: `✓ ${ok} actualizadas · ${err} errores`, total: updates.length, done: updates.length, ok, err })
    } catch (ex) {
      setCsvStatus({ phase: 'error', msg: `✗ ${ex.message || ex}` })
    } finally {
      setCsvBusy(false)
      if (csvRef.current) csvRef.current.value = ''
    }
  }


  // ═══════════════════════════════════════════════════════════
  // Procesar CSV PEDIDOSYA (orderDetails)
  // ═══════════════════════════════════════════════════════════
  async function handlePeya(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPeyaBusy(true)
    setPeyaStatus({ phase: 'reading', msg: `Leyendo ${file.name}...` })
    try {
      const text = await file.text()
      const rows = parseCsv(text.replace(/^\uFEFF/, ''))
      const headers = rows.shift()
      const idx = {}
      const wanted = [
        'Nombre del local','Nro de pedido','ID del local','Método de entrega','Forma de pago',
        'Pedido programado','Restaurant Address','Estado del pedido','Fecha del pedido',
        'Aceptado en','Lista para retiro','Repartidor cerca del local','Retirado del local el',
        'Entregado el','¿Tiene reclamos?','Motivo del reclamo','Cancelado el','Motivo de rechazo',
        'Responsable del rechazo','Total del pedido','Tarifa mínima por pedido','Resarcimientos',
        'Customer Fee Total','Cargo impositivo','Tarifa de pago','Descuentos subsidiados por la tienda',
        'Voucher subsidiado por la tienda','Comisión','Cargos','Cargos por Descuentos fugaces',
        'Tarifa por servicios de publicidad','Avoidable cancellation fee','Es pagadero','Pagado',
        'Ingreso estimado','Monto en efectivo ya cobrado por el local','Monto adeudado a PedidosYa',
        'Monto de pago','Descuento financiado por PedidosYa','Voucher financiado por PedidosYa',
        'Descuento total','Total del voucher','Monto de impuestos','Artículos'
      ]
      for (const w of wanted) idx[w] = headers.indexOf(w)
      if (idx['Nro de pedido'] < 0) throw new Error('CSV sin columna "Nro de pedido"')

      const records = []
      for (const r of rows) {
        const nro = r[idx['Nro de pedido']]
        if (!nro) continue
        const localId = r[idx['ID del local']] || ''
        records.push({
          nro_pedido: parseInt(nro, 10),
          local_id: parseInt(localId, 10) || null,
          store_code: LOCAL_TO_STORE_PEYA[localId] || null,
          nombre_local: r[idx['Nombre del local']] || null,
          metodo_entrega: r[idx['Método de entrega']] || null,
          forma_pago: r[idx['Forma de pago']] || null,
          pedido_programado: boolifyES(r[idx['Pedido programado']]),
          restaurant_address: r[idx['Restaurant Address']] || null,
          estado: r[idx['Estado del pedido']] || null,
          fecha_pedido: tsLocalToISO(r[idx['Fecha del pedido']]),
          aceptado_en: tsLocalToISO(r[idx['Aceptado en']]),
          lista_para_retiro: tsLocalToISO(r[idx['Lista para retiro']]),
          repartidor_cerca: tsLocalToISO(r[idx['Repartidor cerca del local']]),
          retirado_en: tsLocalToISO(r[idx['Retirado del local el']]),
          entregado_en: tsLocalToISO(r[idx['Entregado el']]),
          tiene_reclamos: boolifyES(r[idx['¿Tiene reclamos?']]),
          motivo_reclamo: r[idx['Motivo del reclamo']] || null,
          cancelado_en: tsLocalToISO(r[idx['Cancelado el']]),
          motivo_rechazo: r[idx['Motivo de rechazo']] || null,
          responsable_rechazo: r[idx['Responsable del rechazo']] || null,
          total_pedido: numEU(r[idx['Total del pedido']]),
          tarifa_minima: numEU(r[idx['Tarifa mínima por pedido']]),
          resarcimientos: numEU(r[idx['Resarcimientos']]),
          customer_fee: numEU(r[idx['Customer Fee Total']]),
          cargo_impositivo: numEU(r[idx['Cargo impositivo']]),
          tarifa_pago: numEU(r[idx['Tarifa de pago']]),
          descuento_tienda: numEU(r[idx['Descuentos subsidiados por la tienda']]),
          voucher_tienda: numEU(r[idx['Voucher subsidiado por la tienda']]),
          comision: numEU(r[idx['Comisión']]),
          cargos: numEU(r[idx['Cargos']]),
          cargos_descuentos_fugaces: numEU(r[idx['Cargos por Descuentos fugaces']]),
          tarifa_publicidad: numEU(r[idx['Tarifa por servicios de publicidad']]),
          avoidable_cancellation_fee: numEU(r[idx['Avoidable cancellation fee']]),
          es_pagadero: r[idx['Es pagadero']] || null,
          pagado: r[idx['Pagado']] || null,
          ingreso_estimado: numEU(r[idx['Ingreso estimado']]),
          monto_efectivo_cobrado: numEU(r[idx['Monto en efectivo ya cobrado por el local']]),
          monto_adeudado_peya: numEU(r[idx['Monto adeudado a PedidosYa']]),
          monto_pago: numEU(r[idx['Monto de pago']]),
          descuento_peya: numEU(r[idx['Descuento financiado por PedidosYa']]),
          voucher_peya: numEU(r[idx['Voucher financiado por PedidosYa']]),
          descuento_total: numEU(r[idx['Descuento total']]),
          total_voucher: numEU(r[idx['Total del voucher']]),
          monto_impuestos: numEU(r[idx['Monto de impuestos']]),
          articulos: r[idx['Artículos']] || null,
          mes_csv: 'web_upload',
        })
      }

      setPeyaStatus({ phase: 'inserting', msg: `${records.length} pedidos detectados, enviando...`, total: records.length, done: 0, ok: 0, dup: 0, err: 0 })

      // Batches de 250 (RPC pg ON CONFLICT DO NOTHING)
      const BATCH = 250
      let ok = 0, dup = 0, err = 0
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH)
        try {
          const { data, error } = await db.rpc('import_peya_jsonb', { p_data: chunk })
          if (error) throw error
          if (data && typeof data === 'object') {
            ok += (data.insertados || 0)
            dup += (data.duplicados || 0)
          } else {
            ok += chunk.length
          }
        } catch (ex) {
          err += chunk.length
          console.error('PeYa batch error:', ex)
        }
        const done = Math.min(i + BATCH, records.length)
        setPeyaStatus({ phase: 'inserting', msg: `${done}/${records.length}`, total: records.length, done, ok, dup, err })
      }

      setPeyaStatus({ phase: 'done', msg: `✓ ${ok} insertados · ${dup} duplicados (omitidos) · ${err} errores`, total: records.length, done: records.length, ok, dup, err })
    } catch (ex) {
      setPeyaStatus({ phase: 'error', msg: `✗ ${ex.message || ex}` })
    } finally {
      setPeyaBusy(false)
      if (peyaRef.current) peyaRef.current.value = ''
    }
  }

  // Estilos compartidos
  const card = {
    background: '#0f1828',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  }
  const btn = (color, disabled) => ({
    background: disabled ? '#475569' : color,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
    transition: 'background .2s',
  })

  const renderStatus = (s) => {
    if (!s) return null
    const colors = { reading: '#3b82f6', parsing: '#3b82f6', updating: '#3b82f6', inserting: '#3b82f6', done: '#10b981', error: '#ef4444' }
    return (
      <div style={{ marginTop: 12, padding: 12, background: '#0a1220', borderRadius: 8, fontSize: 13, color: colors[s.phase] || '#94a3b8' }}>
        <div style={{ fontWeight: 600 }}>{s.msg}</div>
        {s.total ? (
          <div style={{ marginTop: 8, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(s.done / s.total) * 100}%`, height: '100%', background: colors[s.phase] || '#3b82f6', transition: 'width .3s' }} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#dc2626', fontSize: 24, fontWeight: 700, margin: 0 }}>📤 Importar QUANTO</h1>
        <p style={{ color: '#94a3b8', marginTop: 4, fontSize: 14 }}>
          Sube los reportes diarios de QUANTO POS y PedidosYa para poblar las tablas <code style={{ color: '#fbbf24' }}>quanto_ordenes</code> y <code style={{ color: '#fbbf24' }}>pedidos_peya</code>.
        </p>
      </div>

      {/* Card 1: ZIP DTE */}
      <div style={card}>
        <h2 style={{ color: '#fbbf24', fontSize: 16, marginTop: 0 }}>📦 Paso 1 — Archivo ZIP de DTEs (JSON)</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Sube el ZIP que descargas de QUANTO con los archivos JSON DTE (uno por orden facturada). Inserta cada
          orden en <code>quanto_ordenes</code> + sus líneas en <code>quanto_orden_items</code>. Las órdenes ya
          existentes se omiten automáticamente (idempotente).
        </p>
        <input
          ref={zipRef}
          type="file"
          accept=".zip"
          onChange={handleZip}
          disabled={zipBusy}
          style={{ display: 'none' }}
          id="zip-input"
        />
        <button
          style={btn('#dc2626', zipBusy)}
          disabled={zipBusy}
          onClick={() => zipRef.current?.click()}
        >
          {zipBusy ? '⏳ Procesando...' : '📦 Seleccionar ZIP de DTEs'}
        </button>
        {renderStatus(zipStatus)}
      </div>

      {/* Card 2: CSV TICKETS */}
      <div style={card}>
        <h2 style={{ color: '#fbbf24', fontSize: 16, marginTop: 0 }}>📋 Paso 2 — CSV de TICKETS</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Sube el CSV TICKETS de QUANTO. Enriquece las órdenes ya cargadas con <code>canal_venta</code> real
          (Mesa/Llevar/Domicilio), <code>autorizado_por</code> (empleado), <code>cliente</code>, y <code>dispositivo</code>.
          Las órdenes con "Drive Thru" en autorizado se reclasifican automáticamente a <code>drivethrough</code>.
        </p>
        <input
          ref={csvRef}
          type="file"
          accept=".csv"
          onChange={handleCsv}
          disabled={csvBusy}
          style={{ display: 'none' }}
          id="csv-input"
        />
        <button
          style={btn('#3b82f6', csvBusy)}
          disabled={csvBusy}
          onClick={() => csvRef.current?.click()}
        >
          {csvBusy ? '⏳ Actualizando...' : '📋 Seleccionar CSV de TICKETS'}
        </button>
        {renderStatus(csvStatus)}
      </div>


      {/* Card 3: CSV PEDIDOSYA */}
      <div style={card}>
        <h2 style={{ color: '#fbbf24', fontSize: 16, marginTop: 0 }}>🛵 Paso 3 — CSV de PedidosYa (orderDetails)</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Sube el CSV <code>orderDetails</code> que descargas del portal PeYa Manager. Inserta cada pedido en{' '}
          <code>pedidos_peya</code> (deduplicado por <code>nro_pedido</code>). Se mapea automáticamente
          <code> ID del local</code> → <code>store_code</code> (M001, S001-S004). Idempotente — re-subirlo no crea duplicados.
        </p>
        <input
          ref={peyaRef}
          type="file"
          accept=".csv"
          onChange={handlePeya}
          disabled={peyaBusy}
          style={{ display: 'none' }}
          id="peya-input"
        />
        <button
          style={btn('#ef4444', peyaBusy)}
          disabled={peyaBusy}
          onClick={() => peyaRef.current?.click()}
        >
          {peyaBusy ? '⏳ Procesando...' : '🛵 Seleccionar CSV de PedidosYa'}
        </button>
        {renderStatus(peyaStatus)}
      </div>

      {/* Recordatorio orden */}
      <div style={{ ...card, background: '#1e1b4b', borderColor: '#4338ca' }}>
        <h3 style={{ color: '#a5b4fc', fontSize: 14, marginTop: 0 }}>💡 Recomendación</h3>
        <ul style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>Subí <strong>primero el ZIP</strong> (crea las órdenes), luego el CSV (las enriquece)</li>
          <li>Si solo tenés CSV pero no ZIP, igual se enriquecen las órdenes que ya estén cargadas</li>
          <li>Ambos archivos pueden re-subirse — el sistema deduplica solo</li>
          <li>Carga diaria recomendada: cada mañana subir los archivos del día anterior</li>
          <li>El CSV de PedidosYa se descarga del portal <em>PeYa Manager</em> en "Pedidos &rarr; Exportar"</li>
        </ul>
      </div>
    </div>
  )
}
