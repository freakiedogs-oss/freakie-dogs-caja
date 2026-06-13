// AsistenteFlotante.jsx — Botón flotante (FAB) del Chat IA, accesible en TODO momento.
// ------------------------------------------------------------------
// Montar UNA sola vez en el root de la app (FUERA del switch de vistas),
// p.ej. al final del render de App.jsx, para que flote sobre cualquier pantalla:
//
//   import AsistenteFlotante from "./components/dashboard/AsistenteFlotante";
//   ...
//   return (
//     <>
//       {/* ...tu app/router... */}
//       <AsistenteFlotante user={user} />
//     </>
//   );
//
// Coloca AsistenteFlotante.jsx junto a AsistenteView.jsx (mismo folder).
// ------------------------------------------------------------------
import { useState } from "react";
import AsistenteView from "./AsistenteView";

const ROJO = "#E62329";

// Roles que pueden ver el asistente (igual que el nav 'asistente-ai').
// Ajustá esta lista si querés exponerlo a más roles.
const ROLES_PERMITIDOS = ["ejecutivo", "superadmin", "super", "admin"];

export default function AsistenteFlotante({ user = {} }) {
  const [open, setOpen] = useState(false);
  const rol = (user?.rol || "").toLowerCase();
  if (!ROLES_PERMITIDOS.includes(rol)) return null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Asistente IA"
          className="fixed z-[60] bottom-24 right-4 flex flex-col overflow-hidden bg-white rounded-2xl shadow-2xl border border-gray-200
                     w-[calc(100vw-2rem)] max-w-[400px] h-[70vh] max-h-[620px]"
        >
          <AsistenteView user={user} onClose={() => setOpen(false)} />
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar asistente IA" : "Abrir asistente IA"}
        title="Asistente IA"
        className="fixed z-[60] bottom-5 right-5 w-14 h-14 rounded-full shadow-lg flex items-center justify-center
                   text-white transition-transform hover:scale-105 active:scale-95 focus:outline-none"
        style={{ backgroundColor: ROJO }}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </>
  );
}
