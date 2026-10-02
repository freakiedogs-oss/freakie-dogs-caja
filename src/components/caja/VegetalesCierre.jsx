// Paso «Vegetales del día» del cierre de caja (Corte Z del POS).
// La cajera dice si se compraron vegetales, anota libras de lechuga y tomate, monto de la
// factura y quién autorizó, y adjunta la foto de la factura de vegetales.
// Lo ÚNICO obligatorio es la foto (y solo si hubo compra): Cesar, 2-oct-2026, «ningún dato
// es obligatorio porque no estoy seguro de cómo manejar esa requisición».
// Se guarda en `cierre_vegetales` (1 fila por sucursal y día) y Saúl lo revisa en el
// módulo «Vegetales» (VegetalesView) para todas las sucursales.
import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'
import { BUCKET_CIERRES } from '../../config'
import QrFotoUpload from '../ui/QrFotoUpload'

const MAX_FOTOS = 3
const FOTO_TIMEOUT_MS = 25000
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
// Criterios de la planilla «Cronograma Requisición Interna Vegetales».
const SEGMENTO = ['Restaurantes', 'Food Court', 'Restaurantes', 'Food Court', 'Restaurantes', 'Food Court', null]
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

export const vegVacio = () => ({ comprado: true, lechuga: '', tomate: '', monto: '', autorizo: '', fotos: [] })
// fotos: [{ file?: File, url?: string }]

/** Única regla obligatoria: si se compró, tiene que haber foto de la factura (salvo excepción «sin fotos» del día). */
export const vegCompleto = (v, sinFotoHoy = false) => !v.comprado || v.fotos.length > 0 || sinFotoHoy

// ── fechas (sin zona horaria: diaISO ya es el día operativo de la sucursal) ──
const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const toISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
export const semanaDe = (iso) => {
  const d = parseISO(iso)
  const lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(lun); x.setDate(lun.getDate() + i); return toISO(x) })
}
const idxDia = (iso) => (parseISO(iso).getDay() + 6) % 7

async function uploadFoto(file, folder) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await db.storage.from(BUCKET_CIERRES).upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw new Error(error.message)
  return db.storage.from(BUCKET_CIERRES).getPublicUrl(path).data.publicUrl
}

/**
 * Sube las fotos pendientes y guarda la fila del día (upsert por sucursal+fecha).
 * Devuelve { ok, avisos[] }. Nunca lanza: un fallo acá no debe tumbar el corte Z.
 */
export async function guardarVegetales({ v, storeCode, fecha, usuario, sinFotoHoy = false }) {
  const avisos = []
  try {
    const urls = []
    for (const f of v.fotos) {
      if (f.url) { urls.push(f.url); continue }
      try {
        urls.push(await Promise.race([
          uploadFoto(f.file, `vegetales/${storeCode}`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('la foto tardó demasiado')), FOTO_TIMEOUT_MS)),
        ]))
      } catch (err) { avisos.push(`Una foto de la factura de vegetales no se subió (${err.message}).`) }
    }
    const comprado = !!v.comprado
    const row = {
      store_code: storeCode, fecha, comprado,
      lechuga_lb: comprado && v.lechuga !== '' ? num(v.lechuga) : null,
      tomate_lb: comprado && v.tomate !== '' ? num(v.tomate) : null,
      monto: comprado && v.monto !== '' ? num(v.monto) : null,
      autorizo: comprado ? (v.autorizo.trim() || null) : null,
      foto_urls: comprado ? urls : [],
      sin_foto: comprado && urls.length === 0 && sinFotoHoy,
      registrado_por: usuario || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('cierre_vegetales').upsert(row, { onConflict: 'store_code,fecha' })
    if (error) throw new Error(error.message)
    return { ok: true, avisos }
  } catch (e) {
    return { ok: false, avisos: [...avisos, `Vegetales no se guardaron: ${e.message}`] }
  }
}

const card = { background: '#1c1c22', border: '1px solid #332b27', borderRadius: 14, padding: 16, marginBottom: 14 }
const inp = { width: '100%', background: '#241d19', border: '1px solid #332b27', color: '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 14, outline: 'none' }
const lbl = { fontSize: 13, color: '#9a9088', marginBottom: 5 }
const ghost = { background: 'none', border: '1px solid #43382f', color: '#9a9088', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }

export default function VegetalesCierre({ value, onChange, storeCode, diaISO, sinFotoHoy = false }) {
  const [semana, setSemana] = useState({})        // fecha → fila de cierre_vegetales
  const [abierta, setAbierta] = useState(false)
  const camRef = useRef(null)
  const v = value
  const set = (p) => onChange({ ...v, ...p })
  const hoyIdx = idxDia(diaISO)
  const seg = SEGMENTO[hoyIdx]

  useEffect(() => {
    const dias = semanaDe(diaISO)
    db.from('cierre_vegetales').select('fecha,comprado,lechuga_lb,tomate_lb,monto,autorizo')
      .eq('store_code', storeCode).gte('fecha', dias[0]).lte('fecha', dias[6])
      .then(({ data }) => { const m = {}; (data || []).forEach(r => { m[r.fecha] = r }); setSemana(m) })
      .catch(() => {})
  }, [storeCode, diaISO])

  // La semana mezcla lo ya guardado con lo que se está llenando hoy.
  const dias = semanaDe(diaISO)
  const filas = dias.map((f, i) => {
    if (f === diaISO) {
      return { f, i, estado: v.comprado ? 'comprado' : 'no', lechuga: v.lechuga === '' ? null : num(v.lechuga), tomate: v.tomate === '' ? null : num(v.tomate), monto: v.monto === '' ? null : num(v.monto) }
    }
    const r = semana[f]
    if (!r) return { f, i, estado: 'pend' }
    return { f, i, estado: r.comprado ? 'comprado' : 'no', lechuga: r.lechuga_lb, tomate: r.tomate_lb, monto: r.monto }
  })
  const compradas = filas.filter(x => x.estado === 'comprado').length
  const tot = (k) => filas.reduce((s, x) => s + num(x[k]), 0)

  const addFoto = (f) => { if (f && v.fotos.length < MAX_FOTOS) set({ fotos: [...v.fotos, { file: f }] }) }
  const sinFoto = v.comprado && v.fotos.length === 0

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#FFD900', marginBottom: 4 }}>🥬 Vegetales del día</div>
      <div style={{ fontSize: 12, color: '#9a9088', marginBottom: 12, lineHeight: 1.5 }}>
        {DIAS[hoyIdx]}: {seg ? <>la compra le compete al <b style={{ color: '#f3efe9' }}>Segmento {seg}</b>.</> : 'este día no tiene segmento de compra asignado en la planilla.'}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#15110f', border: '1px solid #332b27', borderRadius: 10, cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" checked={v.comprado} onChange={(e) => set({ comprado: e.target.checked })} style={{ width: 18, height: 18 }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{v.comprado ? 'Se compraron vegetales este día' : 'No se compraron vegetales este día'}</span>
      </label>

      {v.comprado && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><div style={lbl}>Lechuga (libras)</div><input style={inp} inputMode="decimal" value={v.lechuga} onChange={(e) => set({ lechuga: e.target.value })} placeholder="0" /></div>
            <div><div style={lbl}>Tomate (libras)</div><input style={inp} inputMode="decimal" value={v.tomate} onChange={(e) => set({ tomate: e.target.value })} placeholder="0" /></div>
            <div><div style={lbl}>Monto de factura ($)</div><input style={inp} inputMode="decimal" value={v.monto} onChange={(e) => set({ monto: e.target.value })} placeholder="0.00" /></div>
            <div><div style={lbl}>Autorizó compra</div><input style={inp} value={v.autorizo} onChange={(e) => set({ autorizo: e.target.value })} placeholder="Nombre" /></div>
          </div>

          <div style={lbl}>Foto de la factura de vegetales <span style={{ color: '#FFD900' }}>★</span> <span style={{ color: '#6b6878' }}>(obligatoria)</span></div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { addFoto(e.target.files?.[0]); e.target.value = '' }} />
          {v.fotos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {v.fotos.map((f, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={f.url || URL.createObjectURL(f.file)} alt="Factura de vegetales" style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 8, border: '1px solid #2dd4a8' }} />
                  <button type="button" onClick={() => set({ fotos: v.fotos.filter((_, j) => j !== i) })}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#332b27', color: '#f3efe9', cursor: 'pointer', fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>
          )}
          {v.fotos.length < MAX_FOTOS && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div onClick={() => camRef.current?.click()}
                style={{ border: `2px dashed ${sinFoto ? '#f87171' : '#43382f'}`, borderRadius: 10, padding: 14, textAlign: 'center', cursor: 'pointer', fontSize: 13, color: sinFoto ? '#f87171' : '#9a9088' }}>
                📷 {v.fotos.length ? 'Agregar otra foto' : 'Tomar foto de la factura'}
              </div>
              <QrFotoUpload onFoto={(url) => set({ fotos: v.fotos.length < MAX_FOTOS ? [...v.fotos, { url }] : v.fotos })} />
            </div>
          )}
          {sinFoto && (
            <div style={{ fontSize: 12, color: sinFotoHoy ? '#fbbf24' : '#f87171', marginTop: 8, lineHeight: 1.45 }}>
              {sinFotoHoy ? 'Hoy se autorizó cerrar sin fotos en esta sucursal. Si podés tomarla, mejor.' : 'Sin la foto de la factura de vegetales no se puede cerrar el día. Es lo único obligatorio de este paso.'}
            </div>
          )}
        </>
      )}

      <button type="button" style={{ ...ghost, marginTop: 14, width: '100%' }} onClick={() => setAbierta(a => !a)}>
        {abierta ? 'Ocultar semana completa' : 'Ver semana completa'}
      </button>
      {abierta && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 10 }}>
            {filas.map(x => (
              <div key={x.f} style={{ textAlign: 'center', padding: '6px 2px', borderRadius: 8, background: x.f === diaISO ? '#2b2410' : '#15110f', border: `1px solid ${x.f === diaISO ? '#FFD900' : '#332b27'}` }}>
                <div style={{ fontSize: 11, color: '#9a9088' }}>{DIAS_CORTO[x.i]}</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{x.estado === 'comprado' ? '🥬' : x.estado === 'no' ? '—' : '·'}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: '#f3efe9', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>Lechuga: <b>{tot('lechuga').toFixed(1)} lb</b></span>
            <span>Tomate: <b>{tot('tomate').toFixed(1)} lb</b></span>
            <span>Facturas: <b>${tot('monto').toFixed(2)}</b></span>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8, color: compradas > 3 ? '#f87171' : '#9a9088' }}>
            Requisiciones esta semana: {compradas} de 3 permitidas.
          </div>
          <ul style={{ fontSize: 11, color: '#6b6878', lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 16 }}>
            <li>Máximo tres requisiciones por semana.</li>
            <li>La compra debe hacerse temprano (10:00–11:30 AM), antes de horas pico.</li>
            <li>La factura debe ingresarse al sistema el mismo momento o antes de las 4:00 PM.</li>
            <li>Lunes, miércoles y viernes: compra le compete al Segmento Restaurantes.</li>
            <li>Martes, jueves y sábado: compra le compete al Segmento Food Court.</li>
          </ul>
        </div>
      )}
    </div>
  )
}
