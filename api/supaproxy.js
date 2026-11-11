// Edge Function de Vercel que hace proxy transparente a Supabase.
// Se accede vía rewrite en vercel.json:
//   /api/sb/:path*  →  /api/supaproxy?_p=:path*
// El cliente supabase-js usa URL base /api/sb y no necesita saber del rewrite.
//
// Motivo: algunos ISPs/WiFis en El Salvador (y ciertos DNS) están bloqueando
// la resolución DNS de *.supabase.co. Al pasar por vercel.app, la PWA funciona
// en todas las redes sin pedirle al usuario cambiar DNS.

// ── Gate de finanzas (SEG-1 Capa 2) ──
// El ERP entero pega como `anon`, y la anon key es PÚBLICA (viaja en el bundle).
// Por eso los objetos de finanzas NO se le abren a anon: el proxy exige una
// sesión de staff (la misma "torre": `staff_sesiones` + `erp_admin_sesion`) y
// recién ahí cambia la llave por el token del rol privado `erp_finanzas_ro`,
// que es de SOLO LECTURA y no puede ver la columna `pin` de usuarios_erp.
//
// Los objetos de esta lista HOY YA devuelven `permission denied` para anon
// (las Capas 0/1 revocaron las tablas base y rompieron de rebote las vistas
// `security_invoker`). Ponerles candado no puede romper nada que funcione:
// solo puede arreglar. Las tablas que hoy SÍ se leen (`compras_dte`,
// `empleados`, `bank_transacciones`) van en una segunda tanda, porque las
// usa también Almacén.

export const config = {
  runtime: 'edge',
};

const SUPA_URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co';

const FINANZAS_OBJETOS = new Set([
  'v_gastos_consolidados',
  'v_ventas_sucursal_diario',
  'v_peya_peso_mensual',
  'v_pl_pagado_categoria_mensual',
  'v_bank_saldos_consolidados',
  'v_bank_tx_pendientes_match',
  'v_cobertura_cruce',
  'v_ajustes_cruce_resumen',
  'v_egresos_excluidos_pl',
  'v_prestamos_estado',
  'v_planilla_gerencial_pl',
  // Agregadas 18-ago-2026. Estaban fuera del gate y con SELECT para `anon`.
  // Grave porque las 4 vistas de planilla tienen security_invoker=false: corren
  // como su dueño (postgres) y SALTAN el RLS de planilla_detalle/empleados.
  // v_planilla_desglose_pl expone nombre_completo + cargo + devengado de los
  // 139 empleados; era legible con la llave publica del bundle.
  'v_planilla_desglose_pl',
  'v_planilla_operativa_pl',
]);

// Ojo: `staff_login` (torre de delivery) emite sesiones para roles que NO
// deben ver el P&L (telefono, despachador, gerente). Por eso acá se valida el
// ROL, no solo que la sesión exista.
const ROLES_FINANZAS = new Set(['admin', 'superadmin', 'ejecutivo']);

// ── Gate de DTEs emitidos ──
// Agregadas 3-sep-2026 con la sección de DTEs emitidos. Son los 28.8k
// documentos fiscales que Freakie le emitió a Hacienda: traen nombre, NIT y
// NRC de cada cliente y el monto de cada venta. Nunca se le abrieron a anon
// (se crearon ya cerradas), así que acá el gate es la única puerta.
// `v_dte_duplicados_pendientes` (05-sep-2026): las facturas emitidas dos veces
// por un doble cobro del POS que siguen aceptadas en Hacienda. Deriva de
// v_dtes_emitidos y expone los mismos datos fiscales.
//
// Lista aparte de FINANZAS_OBJETOS desde el 1-oct-2026: el rol `eventos`
// factura a los clientes de eventos desde «DTEs Emitidos · Facturar», así que
// necesita leer estas vistas, pero NO el P&L, banco ni planilla. La sesión la
// emite `erp_admin_sesion` (acepta `eventos`); el corte por objeto vive acá.
const DTE_OBJETOS = new Set([
  'v_dtes_emitidos',
  'dte_emitido_detalle',
  'v_dte_duplicados_pendientes',
]);
const ROLES_DTE = new Set(['admin', 'superadmin', 'ejecutivo', 'eventos']);

// ── Gate de RRHH (SEG-1) ──
// El expediente de empleados (DUI, NIT, cuenta bancaria, salario, teléfono,
// contacto de emergencia, ISSS, AFP, nacimiento) vive en la vista
// `v_empleados_expediente`, cerrada a la llave pública. La sirve solo a quien
// tenga sesión de staff con rol de RRHH. `contador` NO entra: no administra
// expedientes y su sesión daría de rebote poder de edición de usuarios.
//
// `v_planilla_validacion` (nombre + DUI + salario + ISSS/AFP/renta + cuenta
// bancaria de cada empleado) tiene security_invoker=false → salta el RLS; se
// revocó de anon el 19-ago y eso dejó caída la pantalla de validación de
// planilla, que usan Jose (ejecutivo), Majo (rrhh) y superadmin.
//
// Agregadas 05-sep-2026: `planillas` y `planilla_detalle`. Verificado con
// `set role anon` que la llave pública leía 1,206 filas de salarios
// individuales saltándose el PIN. Son TABLAS con RLS (no vistas), así que
// además del GRANT hubo que darle política de SELECT a `erp_finanzas_ro`:
// sin eso el gate habría devuelto 0 filas EN SILENCIO.
// Las escrituras NO pasan por acá: van por RPC SECURITY DEFINER sobre `db`.
const RRHH_OBJETOS = new Set([
  'v_empleados_expediente',
  'v_planilla_validacion',
  'planillas',
  'planilla_detalle',
]);
const ROLES_RRHH = new Set(['admin', 'superadmin', 'ejecutivo', 'rrhh']);

// ── Gate de banco y socios (SEG-2) ──
// Agregadas 11-nov-2026. Tablas y vistas que leen BancoView, el Dashboard
// Financiero y Débitos por clasificar, más los RPC por los que pasan sus
// escrituras (`bank_comprobante_registrar`, `bank_estado_cuenta_registrar`,
// `bank_regla_set_activa`): son SECURITY DEFINER y solo los ejecuta
// `erp_finanzas_ro`, así que se llaman únicamente con sesión de finanzas.
const BANCO_OBJETOS = new Set([
  'bank_transacciones',
  'bank_comprobantes',
  'bank_match',
  'bank_aprendizaje',
  'bank_reglas_clasificacion',
  'bank_estados_cuenta',
  'movimientos_socios',
  'prestamo_movimientos',
  'mv_finanzas_banco_mensual',
  'v_socio_aportes_detalle',
  'v_socios_balance',
  'v_bank_tx_socio_pendientes',
  'v_bank_tx_con_match',
  'v_bank_sugerencias',
  'v_banco_por_clasificar',
  'v_banco_subcategorias',
  'v_banco_cuadre_mensual',
  'v_banco_revision',
  'bank_comprobante_registrar',
  'bank_estado_cuenta_registrar',
  'bank_regla_set_activa',
  // RPC de conciliación, revisión e ingesta que llaman esas mismas pantallas.
  // La más lenta (`fn_banco_autoclasificar`) tarda ~4 s: entra en el techo
  // de 25 s del proxy.
  'bancoview_aplicar_aprendizaje',
  'bancoview_aplicar_match_multiple',
  'bancoview_aplicar_reglas',
  'bancoview_aprender_match',
  'bancoview_clasificar_movimiento_socio',
  'bancoview_devengar_intereses_socios',
  'bancoview_match_comprobantes',
  'bancoview_sugerir_dtes_para_gasto',
  'bancoview_vincular_gasto_a_dte',
  'bank_match_crear',
  'bank_match_eliminar',
  'bank_match_eliminar_por_tx',
  'bank_tx_marcar',
  'fn_banco_autoclasificar',
  'fn_banco_revisar',
  'fn_banco_revisar_multi_dte',
  'fn_banco_revision_auto',
  'fn_banco_sugerir_dte',
  'fn_import_bank_bac',
  'fn_ingesta_candidatas',
  'fn_ingesta_resolver',
  'bancoview_registrar_pago_prestamo',
]);

// Cuentas bancarias de terceros (empleados, proveedores, socios) y la lista de
// socios: además de BancoView las usa la pestaña de cuentas de RRHH, por eso
// llevan los roles de RRHH y no los de finanzas.
const TERCEROS_OBJETOS = new Set([
  'cuentas_bancarias_terceros',
  'socios',
  'cuenta_tercero_guardar',
  'cuenta_tercero_set_activo',
]);

// Devuelve el set de roles con acceso a un objeto gateado, o null si es abierto.
function rolesRequeridos(objeto) {
  if (FINANZAS_OBJETOS.has(objeto)) return ROLES_FINANZAS;
  if (BANCO_OBJETOS.has(objeto)) return ROLES_FINANZAS;
  if (TERCEROS_OBJETOS.has(objeto)) return ROLES_RRHH;
  if (DTE_OBJETOS.has(objeto)) return ROLES_DTE;
  if (RRHH_OBJETOS.has(objeto)) return ROLES_RRHH;
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cache corta de tokens ya validados: evita un viaje extra a la DB por request.
// El TTL es chico para que revocar una sesión surta efecto rápido.
const cacheSesion = new Map();
const CACHE_MS = 60_000;

function objetoDe(path) {
  const m = /^rest\/v1\/(?:rpc\/)?([a-zA-Z0-9_]+)/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

async function rolDeSesion(token, apikey) {
  if (!token || !UUID_RE.test(token)) return null;

  const cacheado = cacheSesion.get(token);
  if (cacheado && cacheado.hasta > Date.now()) return cacheado.rol;

  // Vía RPC y no leyendo `staff_sesiones` directo: la tabla tiene RLS activa,
  // así que un GRANT no alcanza (el rol veía 0 filas y se rechazaban hasta las
  // sesiones válidas). `fin_sesion_rol` es SECURITY DEFINER y devuelve solo el
  // rol, sin exponer el resto de la fila.
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/fin_sesion_rol`, {
      method: 'POST',
      headers: {
        apikey,
        authorization: `Bearer ${process.env.SB_FINANZAS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return null;
    const rol = await r.json();
    if (typeof rol !== 'string' || !rol) return null;
    cacheSesion.set(token, { rol, hasta: Date.now() + CACHE_MS });
    return rol;
  } catch {
    return null;
  }
}

function noAutorizado(motivo) {
  return new Response(
    JSON.stringify({
      code: 'FIN_SIN_SESION',
      message: motivo,
      hint: 'Ingresá tu PIN para abrir la sesión de finanzas.',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    }
  );
}

const STRIP_REQ_HEADERS = new Set([
  'host',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-vercel-forwarded-for',
  'x-vercel-id',
  'x-vercel-ip-country',
  'x-vercel-ip-country-region',
  'x-vercel-ip-city',
  'x-vercel-ip-latitude',
  'x-vercel-ip-longitude',
  'x-vercel-ip-timezone',
  'x-real-ip',
  'via',
  'forwarded',
]);

const STRIP_RES_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

export default async function handler(req) {
  const url = new URL(req.url);

  // El rewrite en vercel.json inyecta _p=<path>. También soportamos llamada
  // directa con ?_p=rest/v1/xxx.
  const rawPath = url.searchParams.get('_p') || '';
  url.searchParams.delete('_p');
  // Eliminar leading slash duplicado
  const path = rawPath.replace(/^\/+/, '');
  const qs = url.search; // ya sin _p
  const target = `${SUPA_URL}/${path}${qs}`;

  // Preflight CORS (probable que no haga falta, mismo origen)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'authorization, apikey, content-type, prefer, x-client-info, range, accept-profile, content-profile, x-torre-token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Construir headers para upstream
  const upstreamHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (!STRIP_REQ_HEADERS.has(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  }

  // ── Gate de finanzas ──
  // El token de sesión nunca viaja a Supabase: se consume acá.
  const tokenTorre = upstreamHeaders.get('x-torre-token');
  upstreamHeaders.delete('x-torre-token');

  const rolesPermitidos = rolesRequeridos(objetoDe(path));
  if (rolesPermitidos) {
    if (!process.env.SB_FINANZAS_TOKEN) {
      return noAutorizado('El gate no está configurado en el servidor.');
    }
    const rol = await rolDeSesion(tokenTorre, upstreamHeaders.get('apikey'));
    if (!rol) {
      return noAutorizado('Sesión ausente o vencida.');
    }
    if (!rolesPermitidos.has(rol)) {
      return noAutorizado(`Tu rol (${rol}) no tiene acceso a este dato.`);
    }
    // Cambiar la llave pública por el rol privado de solo lectura.
    upstreamHeaders.set('authorization', `Bearer ${process.env.SB_FINANZAS_TOKEN}`);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      body: hasBody ? req.body : undefined,
      // @ts-ignore duplex requerido para streaming
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        proxy_error: 'upstream_fetch_failed',
        message: String(e?.message || e),
        target,
      }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      }
    );
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (!STRIP_RES_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set('access-control-allow-origin', '*');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
