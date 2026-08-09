import { useState, useEffect } from 'react';
import { db } from '../supabase';

// ── Fuente ÚNICA de unidades para TODA la app ──────────────────────────
// Todas las listas de unidades (Kardex, editor 📐, crear producto, Recetas)
// usan <UnidadSelect/> y leen del MISMO catálogo: la tabla `public.unidades`.
// La opción "➕ otra…" persiste la unidad nueva vía RPC `agregar_unidad`, así
// aparece en TODOS los dropdowns (y en todos los dispositivos) para siempre.
// Si la red/DB falla, cae a esta lista fija para no quedar sin opciones.
export const UNIDADES_FALLBACK = [
  'porcion', 'unidad', 'libra', 'onza', 'gramo', 'kilogramo',
  'litro', 'mililitro', 'taza', 'cucharada', 'cucharadita',
  'bolsa', 'bote', 'caja', 'fardo', 'paquete', 'saco', 'lata',
  'galón', 'display', 'docena', 'media docena', 'cubeta',
];

const OTRA = '__otra__';

// Caché a nivel de módulo (se carga una sola vez y se comparte entre todos
// los <UnidadSelect/> montados; al agregar una unidad se notifica a todos).
let _cache = null;
let _promise = null;
const _subs = new Set();
const _notify = () => _subs.forEach(fn => fn(_cache ? [..._cache] : null));

function _load() {
  if (_promise) return _promise;
  _promise = db.from('unidades').select('nombre').eq('activo', true).order('orden')
    .then(({ data, error }) => {
      _cache = (!error && data && data.length) ? data.map(r => r.nombre) : [...UNIDADES_FALLBACK];
      _notify();
      return _cache;
    })
    .catch(() => { _cache = [...UNIDADES_FALLBACK]; _notify(); return _cache; });
  return _promise;
}

export function useUnidades() {
  const [list, setList] = useState(_cache);
  useEffect(() => {
    _subs.add(setList);
    if (_cache) setList(_cache); else _load();
    return () => { _subs.delete(setList); };
  }, []);
  return list || UNIDADES_FALLBACK;
}

// Persiste una unidad nueva en el catálogo y la agrega a la caché compartida.
export async function agregarUnidad(nombre) {
  const n = (nombre || '').trim();
  if (!n || (_cache && _cache.includes(n))) return;
  try { await db.rpc('agregar_unidad', { p_nombre: n }); } catch { /* offline: igual la mostramos local */ }
  if (_cache && !_cache.includes(n)) { _cache = [..._cache, n]; _notify(); }
}

/**
 * Select de unidad unificado con opción "➕ otra…" (texto libre, se persiste).
 * Props:
 *  - value, onChange(nuevoValor: string)
 *  - allowEmpty + emptyLabel: opción vacía al inicio (ej. "(igual que almacén)")
 *  - className / selectStyle: estilos del <select> y del <input> de "otra"
 *  - style: estilos del contenedor (para ocupar el slot flex donde va)
 */
export function UnidadSelect({ value, onChange, allowEmpty = false, emptyLabel = '(elegir)', className, selectStyle, style }) {
  const unidades = useUnidades();
  const [custom, setCustom] = useState(false);
  const v = value || '';
  const base = v && !unidades.includes(v) ? [v, ...unidades] : unidades;
  const confirmar = () => { if (v.trim()) { agregarUnidad(v); setCustom(false); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <select
        className={className}
        style={selectStyle}
        value={custom ? OTRA : v}
        onChange={e => {
          if (e.target.value === OTRA) { setCustom(true); onChange(''); }
          else { setCustom(false); onChange(e.target.value); }
        }}>
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {base.map(u => <option key={u} value={u}>{u}</option>)}
        <option value={OTRA}>➕ otra…</option>
      </select>
      {custom && (
        <input
          autoFocus type="text" placeholder="Escribí la unidad y Enter…"
          className={className} style={selectStyle}
          value={v}
          onChange={e => onChange(e.target.value)}
          onBlur={confirmar}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }} />
      )}
    </div>
  );
}
