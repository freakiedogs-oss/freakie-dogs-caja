import { useState, useEffect, useRef } from 'react'
import { db } from '../supabase'
import { APP_VERSION } from '../config'
import Icon from './Icon'

// Roles que pueden usar el POS
const POS_ROLES = ['cajero', 'cajera', 'mesero', 'mesera', 'cocina', 'gerente', 'admin', 'ejecutivo', 'superadmin']

// Dominios oficiales — si el host no está aquí (ni localhost), avisar "enlace antiguo"
const CANONICAL_HOSTS = ['freakie-dogs-caja.vercel.app', 'erp.freakiedogs.com', 'erp.freakiedogs.sv', 'pos.freakiedogs.com']
const MIN_PIN = 4
const MAX_PIN = 6
const DEBOUNCE_MS = 400
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4'

export default function POSLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [errDetails, setErrDetails] = useState('')
  const [loading, setLoading] = useState(false)
  const [canInstall, setCanInstall] = useState(typeof window !== 'undefined' && !!window.__pwaReady)
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [healthOk, setHealthOk] = useState(null)
  const [healthErr, setHealthErr] = useState('')
  const [rawFetchOk, setRawFetchOk] = useState(null)
  const [rawFetchDetails, setRawFetchDetails] = useState('')
  const [proxyFetchOk, setProxyFetchOk] = useState(null)
  const [proxyFetchDetails, setProxyFetchDetails] = useState('')
  const [showDiag, setShowDiag] = useState(false)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)

  // ── Online / offline ──
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── PWA install prompt ──
  useEffect(() => {
    const on = () => setCanInstall(true)
    const off = () => setCanInstall(false)
    window.addEventListener('pwaready', on)
    window.addEventListener('pwainstalled', off)
    return () => { window.removeEventListener('pwaready', on); window.removeEventListener('pwainstalled', off) }
  }, [])

  // ── Health check (SDK + fetch directo + fetch proxy) ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { error } = await db.from('usuarios_erp').select('id').limit(1)
        if (cancelled) return
        if (error) { setHealthOk(false); setHealthErr(`${error.code || ''} ${error.message || String(error)}`.trim()) }
        else { setHealthOk(true); setHealthErr('') }
      } catch (e) { if (!cancelled) { setHealthOk(false); setHealthErr(`EXC: ${e?.message || String(e)}`) } }

      try {
        const r = await fetch('https://btboxlwfqcbrdfrlnwln.supabase.co/rest/v1/usuarios_erp?select=id&limit=1', { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
        if (cancelled) return
        if (r.ok) { setRawFetchOk(true); setRawFetchDetails(`${r.status} OK`) }
        else { setRawFetchOk(false); const t = await r.text().catch(() => ''); setRawFetchDetails(`${r.status} ${r.statusText} ${t.slice(0, 80)}`) }
      } catch (e) { if (!cancelled) { setRawFetchOk(false); setRawFetchDetails(`FAIL: ${e?.message || String(e)}`) } }

      try {
        const r = await fetch(`${window.location.origin}/sb/rest/v1/usuarios_erp?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
        if (cancelled) return
        if (r.ok) { setProxyFetchOk(true); setProxyFetchDetails(`${r.status} OK`) }
        else { setProxyFetchOk(false); const t = await r.text().catch(() => ''); setProxyFetchDetails(`${r.status} ${r.statusText} ${t.slice(0, 80)}`) }
      } catch (e) { if (!cancelled) { setProxyFetchOk(false); setProxyFetchDetails(`FAIL: ${e?.message || String(e)}`) } }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Auto-login con debounce + abort ──
  useEffect(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    if (pin.length < MIN_PIN) return
    const delay = pin.length >= MAX_PIN ? 0 : DEBOUNCE_MS
    const snap = pin
    debounceRef.current = setTimeout(() => runLogin(snap), delay)
    return () => { if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  const runLogin = async (np) => {
    if (!navigator.onLine) { setErr('Sin conexión a internet'); setErrDetails('Revisa WiFi o datos móviles y reintenta.'); setPin(''); return }
    if (abortRef.current) { try { abortRef.current.abort() } catch {} }
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true); setErr(''); setErrDetails('')
    try {
      const { data, error } = await db
        .from('usuarios_erp').select('*').eq('pin', np).eq('activo', true)
        .abortSignal(ac.signal).maybeSingle()
      if (pin !== np && pin.length >= MIN_PIN) return // el PIN cambió mientras consultábamos
      setLoading(false)
      if (error) {
        if (error.message?.toLowerCase().includes('abort')) return
        setErr('Error conectando al servidor'); setErrDetails(error.message || 'Intenta de nuevo o limpia el caché.'); setPin(''); return
      }
      if (data) {
        if (!POS_ROLES.includes(data.rol)) { setErr('Sin acceso al POS'); setErrDetails('Tu rol no tiene permiso para el punto de venta.'); setPin(''); return }
        try {
          sessionStorage.setItem('pos_user', JSON.stringify({
            id: data.id, pin: data.pin, rol: data.rol, store_code: data.store_code,
            nombre: data.nombre, apellido: data.apellido,
          }))
        } catch {}
        onLogin(data); return
      }
      setErr('PIN incorrecto'); setErrDetails('Verifica con tu supervisor.'); setPin('')
    } catch (e) {
      setLoading(false)
      if (e?.name === 'AbortError') return
      setErr('Error inesperado'); setErrDetails(String(e?.message || e)); setPin('')
    }
  }

  const press = (k) => {
    if (k === 'del') { setPin(p => p.slice(0, -1)); setErr(''); setErrDetails(''); return }
    if (pin.length >= MAX_PIN) return
    setPin(p => p + k); setErr(''); setErrDetails('')
  }

  const clearCacheAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } catch {}
    window.location.href = window.location.pathname + '?_r=' + Date.now()
  }

  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isCanonical = CANONICAL_HOSTS.includes(host) || host === 'localhost' || host === '127.0.0.1'
  const canonicalUrl = `https://${CANONICAL_HOSTS[0]}`
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del']

  const dotColor = !online || healthOk === false ? '#f87171' : healthOk === null ? '#fbbf24' : '#2dd4a8'
  const statusText = !online ? 'Sin internet' : healthOk === false ? 'Servidor no responde' : healthOk === null ? 'Verificando…' : 'Conectado'

  return (
    <div style={{ minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#141418', padding: '24px 24px 56px' }}>

      {/* Enlace antiguo / no canónico */}
      {!isCanonical && (
        <div style={{ background: '#78350f', color: '#fde68a', padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, marginBottom: 16, textAlign: 'center', maxWidth: 320, border: '1px solid #f59e0b' }}>
          <b>⚠️ Estás en un enlace antiguo</b>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85, wordBreak: 'break-all' }}>{host}</div>
          <a href={canonicalUrl} style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>Ir al enlace correcto →</a>
        </div>
      )}

      <img src="/icon-192.png" alt="Freakie Dogs" style={{ width: 110, height: 110, borderRadius: 20, marginBottom: 12, objectFit: 'contain' }} />
      <div style={{ fontWeight: 800, fontSize: 22, color: '#E62329' }}>Freakie Dogs</div>
      <div style={{ color: '#8b8997', fontSize: 12, marginTop: 3, marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Punto de Venta</div>
      <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 24 }}>Ingresa tu PIN</div>

      {/* Dots */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: pin.length > i ? '#E62329' : '#2a2a32', border: '2px solid ' + (pin.length > i ? '#E62329' : '#2a2a32'), transition: 'all 0.1s' }} />
        ))}
      </div>

      {/* Error / loading */}
      <div style={{ minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        {err && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#f87171', fontSize: 14, fontWeight: 700 }}>{err}</div>
            {errDetails && <div style={{ color: '#8b8997', fontSize: 11, marginTop: 2, maxWidth: 280 }}>{errDetails}</div>}
          </div>
        )}
        {loading && !err && <div className="spin" />}
      </div>

      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: 220 }}>
        {keys.map((k, i) => k === '' ? <div key={i} /> : (
          <button key={i} onClick={() => press(k)} style={{ padding: '16px', borderRadius: 12, background: k === 'del' ? '#1e1e26' : '#1c1c22', color: '#e8e6ef', fontSize: 20, fontWeight: 700, cursor: 'pointer', border: '1px solid #2a2a32' }}
            onMouseOver={e => e.currentTarget.style.background = '#2a2a32'}
            onMouseOut={e => e.currentTarget.style.background = k === 'del' ? '#1e1e26' : '#1c1c22'}>
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      {/* Limpiar caché (solo si hay error) */}
      {err && (
        <button onClick={clearCacheAndReload} style={{ marginTop: 16, background: 'transparent', color: '#8b8997', border: '1px solid #43382f', borderRadius: 10, padding: '10px 18px', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Icon name="rotate" size={15} /> Limpiar caché y reintentar
        </button>
      )}

      {/* Instalar PWA */}
      {canInstall ? (
        <button onClick={() => window.__installPWA && window.__installPWA()} style={{ marginTop: 22, background: '#E62329', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="phone" size={17} /> Instalar app en este dispositivo
        </button>
      ) : (
        <div style={{ marginTop: 18, color: '#43382f', fontSize: 12, textAlign: 'center', maxWidth: 220 }}>
          En iOS: toca <b style={{ color: '#8b8997' }}>Compartir →</b> "Añadir a pantalla de inicio"
        </div>
      )}

      {/* Footer estado/versión (tocable para diagnóstico) */}
      <div onClick={() => setShowDiag(v => !v)} style={{ position: 'fixed', bottom: 6, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#6b6878', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
        POS {APP_VERSION || 'v1.0'} · {host} · {statusText}
      </div>

      {/* Panel diagnóstico */}
      {showDiag && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#15110f', border: '1px solid #43382f', borderRadius: 10, padding: 12, fontSize: 11, color: '#9a9088', fontFamily: 'monospace', maxWidth: 320, width: '90%', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 100 }}>
          <div><b>Versión:</b> {APP_VERSION || 'v1.0'}</div>
          <div><b>Host:</b> {host}</div>
          <div><b>Canónico:</b> {isCanonical ? 'Sí ✅' : 'No ⚠️'}</div>
          <div><b>Online:</b> {online ? 'Sí ✅' : 'No ❌'}</div>
          <div><b>Supabase SDK:</b> {healthOk === null ? '⏳' : healthOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {healthErr && <div style={{ color: '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>→ {healthErr}</div>}
          <div><b>Fetch DIRECTO:</b> {rawFetchOk === null ? '⏳' : rawFetchOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {rawFetchDetails && <div style={{ color: '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>→ {rawFetchDetails}</div>}
          <div><b>Fetch PROXY:</b> {proxyFetchOk === null ? '⏳' : proxyFetchOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {proxyFetchDetails && <div style={{ color: proxyFetchOk ? '#86efac' : '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>→ {proxyFetchDetails}</div>}
          <div style={{ marginTop: 4 }}><b>User Agent:</b></div>
          <div style={{ fontSize: 10, opacity: 0.7, wordBreak: 'break-all' }}>{typeof navigator !== 'undefined' ? navigator.userAgent : ''}</div>
          <button onClick={clearCacheAndReload} style={{ marginTop: 8, background: '#E62329', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer', width: '100%' }}>Limpiar caché y recargar</button>
        </div>
      )}
    </div>
  )
}
