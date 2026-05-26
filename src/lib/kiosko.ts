// ============================================================
// kiosko.ts — Modo kiosko para tabletas POS / Cocina
// ------------------------------------------------------------
// Activa el modo con: visitar la URL una vez con `?kiosko=on`
// desde la tablet. Persiste flag en localStorage.
//
// Funcionalidades:
//   1. Auto-login: re-loguea con el último PIN guardado si la
//      sesión Supabase expira (evita "PIN inválido" a mitad de turno).
//   2. Wake Lock: pide a la tablet no dormir mientras está en POS/Cocina.
//   3. Fullscreen: oculta UI del navegador (Android Chrome / iPad Safari).
//   4. Beforeunload: advierte si el mesero cierra accidentalmente.
//   5. "Cambiar mesero": signOut + back al login conservando modo kiosko.
// ============================================================

const LS_KIOSKO_FLAG  = 'kaeru_kiosko_mode';
const LS_KIOSKO_EMAIL = 'kaeru_kiosko_last_email';
const LS_KIOSKO_PIN   = 'kaeru_kiosko_last_pin';
const LS_KIOSKO_ROLE  = 'kaeru_kiosko_only_role'; // si tablet es exclusiva de un rol

export function isKioskoMode(): boolean {
  try {
    return localStorage.getItem(LS_KIOSKO_FLAG) === '1';
  } catch {
    return false;
  }
}

export function activarKiosko(opts?: { soloRol?: 'mesero' | 'cocinero' | 'manager' }) {
  try {
    localStorage.setItem(LS_KIOSKO_FLAG, '1');
    if (opts?.soloRol) localStorage.setItem(LS_KIOSKO_ROLE, opts.soloRol);
  } catch {/* noop */}
}

export function desactivarKiosko() {
  try {
    localStorage.removeItem(LS_KIOSKO_FLAG);
    localStorage.removeItem(LS_KIOSKO_EMAIL);
    localStorage.removeItem(LS_KIOSKO_PIN);
    localStorage.removeItem(LS_KIOSKO_ROLE);
  } catch {/* noop */}
}

export function getKioskoRol(): string | null {
  try { return localStorage.getItem(LS_KIOSKO_ROLE); } catch { return null; }
}

// ============================================================
// Credenciales persistidas — para re-login automático
// ------------------------------------------------------------
// IMPORTANTE: solo se guardan cuando el modo kiosko está ON.
// El PIN se guarda en texto plano en localStorage (acceso físico
// a la tablet implica acceso al PIN). Aceptable en una tablet de
// punto fijo en cocina porque solo guarda PINs operativos (4XXX),
// nunca admin (1XXX) ni socio (2XXX).
// ============================================================
export function guardarCredencialesKiosko(email: string, pin: string) {
  if (!isKioskoMode()) return;
  try {
    localStorage.setItem(LS_KIOSKO_EMAIL, email);
    localStorage.setItem(LS_KIOSKO_PIN, pin);
  } catch {/* noop */}
}

export function leerCredencialesKiosko(): { email: string; pin: string } | null {
  if (!isKioskoMode()) return null;
  try {
    const email = localStorage.getItem(LS_KIOSKO_EMAIL);
    const pin   = localStorage.getItem(LS_KIOSKO_PIN);
    return email && pin ? { email, pin } : null;
  } catch {
    return null;
  }
}

export function olvidarCredencialesKiosko() {
  try {
    localStorage.removeItem(LS_KIOSKO_EMAIL);
    localStorage.removeItem(LS_KIOSKO_PIN);
  } catch {/* noop */}
}

// ============================================================
// Wake Lock — la tablet no se duerme mientras está en POS/Cocina
// ============================================================
let _wakeLock: any = null;

export async function pedirWakeLock() {
  try {
    const nav: any = navigator;
    if (nav.wakeLock && typeof nav.wakeLock.request === 'function') {
      _wakeLock = await nav.wakeLock.request('screen');
      _wakeLock.addEventListener?.('release', () => { _wakeLock = null; });
    }
  } catch {/* ignorar — no es crítico */}
}

export function liberarWakeLock() {
  try { _wakeLock?.release?.(); } catch {/* noop */}
  _wakeLock = null;
}

// Re-pide wake lock cuando la tablet vuelve del background
export function inicializarWakeLockAutoRecover() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isKioskoMode() && !_wakeLock) {
      void pedirWakeLock();
    }
  });
}

// ============================================================
// Fullscreen
// ============================================================
export async function pedirFullscreen() {
  try {
    const el: any = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' } as any);
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {/* noop */}
}

export async function salirFullscreen() {
  try {
    const d: any = document;
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    else if (d.webkitFullscreenElement && d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {/* noop */}
}

// ============================================================
// Prevenir cierre accidental
// ============================================================
let _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

export function activarConfirmacionCierre() {
  if (_beforeUnloadHandler || typeof window === 'undefined') return;
  _beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '¿Cerrar el POS? Se perderá la sesión del mesero.';
  };
  window.addEventListener('beforeunload', _beforeUnloadHandler);
}

export function desactivarConfirmacionCierre() {
  if (_beforeUnloadHandler && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', _beforeUnloadHandler);
    _beforeUnloadHandler = null;
  }
}

// ============================================================
// Helper: activar todo el modo kiosko en una página POS/Cocina
// ============================================================
export function inicializarModoKioskoEnPagina() {
  if (!isKioskoMode()) return () => {};
  void pedirWakeLock();
  activarConfirmacionCierre();
  // Fullscreen requiere user gesture; lo pedimos al primer tap.
  const onFirstTap = () => {
    void pedirFullscreen();
    document.removeEventListener('click', onFirstTap);
    document.removeEventListener('touchstart', onFirstTap);
  };
  document.addEventListener('click', onFirstTap, { once: true });
  document.addEventListener('touchstart', onFirstTap, { once: true });

  // Cleanup al desmontar la página
  return () => {
    desactivarConfirmacionCierre();
    liberarWakeLock();
  };
}

// ============================================================
// Procesar query param `?kiosko=on|off` al cargar la app
// ============================================================
export function procesarQueryKiosko() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get('kiosko');
  if (flag === 'on') {
    const rol = params.get('rol') as any;
    activarKiosko(rol ? { soloRol: rol } : undefined);
    // Limpiar el URL para que no quede el query
    params.delete('kiosko');
    params.delete('rol');
    const clean = window.location.pathname + (params.toString() ? '?' + params : '');
    window.history.replaceState({}, '', clean);
  } else if (flag === 'off') {
    desactivarKiosko();
    params.delete('kiosko');
    const clean = window.location.pathname + (params.toString() ? '?' + params : '');
    window.history.replaceState({}, '', clean);
  }
}
