export const STORES = {
  M001: 'Cafetalón',
  S001: 'Soyapango',
  S002: 'Usulután',
  S003: 'Lourdes',
  S004: 'Venecia',
  CM001: 'Casa Matriz'
}

export const STORES_SHORT = {
  M001: 'Cafetalón',
  S001: 'Soyapango',
  S002: 'Usulután',
  S003: 'Lourdes',
  S004: 'Venecia',
  CM001: 'Casa Matriz'
}

export const BUCKET_CIERRES = 'cierres-fotos'
export const BUCKET_DESPACHOS = 'despachos-fotos'

export const today = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]
export const yesterday = () => { const d = new Date(Date.now() - 6 * 3600 * 1000); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
export const shiftDate = (dateStr, days) => { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; }

export const fmtDate = (d) =>
  new Date(d + 'T12:00:00').toLocaleDateString('es-SV', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

export const n = (v) => parseFloat(v) || 0

// Role-based navigation config
export const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { key: 'home', label: 'Inicio', icon: '🏠', roles: ['*'] },
    ],
  },
  {
    label: 'Caja',
    items: [
      { key: 'cierre', label: 'Cierre de Caja', icon: '💰', roles: ['cajero', 'cajera', 'gerente', 'admin'] },
      { key: 'reporte', label: 'Reporte de Turno', icon: '📝', roles: ['cajero', 'cajera', 'cocina', 'gerente', 'admin'] },
      { key: 'deposito', label: 'Depósitos', icon: '🏦', roles: ['cajero', 'cajera', 'gerente', 'admin'] },
    ],
  },
  {
    label: 'Dashboards',
    items: [
      { key: 'dashboard', label: 'Ventas', icon: '📊', roles: ['gerente', 'admin', 'ejecutivo'] },
      { key: 'ejecutivo', label: 'Ejecutivo', icon: '👔', roles: ['ejecutivo', 'admin'] },
      { key: 'ventas-dash', label: 'Ventas Diarias', icon: '📊', roles: ['ejecutivo', 'admin'] },
    ],
  },
  {
    label: 'Almacén',
    items: [
      { key: 'recepcion', label: 'Recepción', icon: '📥', roles: ['bodeguero', 'jefe_casa_matriz', 'admin'] },
      { key: 'despacho', label: 'Despacho', icon: '🚚', roles: ['bodeguero', 'jefe_casa_matriz', 'admin'] },
      { key: 'inventario', label: 'Inventario', icon: '📦', roles: ['bodeguero', 'jefe_casa_matriz', 'admin'] },
      { key: 'historial', label: 'Historial', icon: '📋', roles: ['bodeguero', 'jefe_casa_matriz', 'admin'] },
      { key: 'compras', label: 'Órdenes de Compra', icon: '🛒', roles: ['compras', 'admin'] },
      { key: 'stock-levels', label: 'Stock Mín/Máx', icon: '📊', roles: ['jefe_casa_matriz', 'admin', 'ejecutivo'] },
    ],
  },
  {
    label: 'Supply Chain',
    items: [
      { key: 'conteo', label: 'Conteo Nocturno', icon: '🌙', roles: ['cocina', 'gerente', 'admin', 'ejecutivo'] },
      { key: 'entregas', label: 'Confirmar Entregas', icon: '✅', roles: ['despachador', 'motorista', 'gerente', 'cocina', 'admin', 'ejecutivo'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { key: 'admin', label: 'Dashboard de Cierres', icon: '⚙️', roles: ['admin'] },
      { key: 'incidentes', label: 'Incidentes', icon: '🚨', roles: ['gerente', 'admin'] },
    ],
  },
  {
    label: 'Producción',
    items: [
      { key: 'recetas', label: 'Recetas / BOM', icon: '📖', roles: ['admin', 'ejecutivo'] },
      { key: 'produccion', label: 'Producción Diaria', icon: '🏭', roles: ['ejecutivo', 'produccion', 'admin'] },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { key: 'conciliacion', label: 'Conciliación', icon: '🏦', roles: ['ejecutivo', 'contador', 'admin'] },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { key: 'delivery', label: 'Panel Delivery', icon: '🛵', roles: ['ejecutivo', 'despachador', 'gerente', 'admin'] },
    ],
  },
  {
    label: 'RRHH / Planilla',
    items: [
      { key: 'rrhh', label: 'Recursos Humanos', icon: '👥', roles: ['ejecutivo', 'rrhh', 'admin'] },
      { key: 'planilla', label: 'Nómina / Planilla', icon: '💵', roles: ['ejecutivo', 'rrhh', 'contador', 'admin'] },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { key: 'marketing', label: 'Analytics Redes', icon: '📱', roles: ['ejecutivo', 'marketing', 'admin'] },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      { key: 'quanto-upload', label: 'Importar QUANTO', icon: '📤', roles: ['admin'] },
    ],
  },
]
