// AsistenteFlotante.jsx — Botón flotante (FAB) del Chat IA, accesible en TODO momento.
// ------------------------------------------------------------------
// Montar UNA sola vez en el root de la app (FUERA del switch de vistas),
// p.ej. al final del render de App.jsx:
//
//   import AsistenteFlotante from "./components/dashboard/AsistenteFlotante";
//   ...
//   return (<>{/* ...app/router... */}<AsistenteFlotante user={user} /></>);
//
// Coloca AsistenteFlotante.jsx junto a AsistenteView.jsx (mismo folder).
// NOTA: el FAB y el panel usan estilos INLINE (no dependen de Tailwind),
// para que se vean sí o sí aunque el build de Tailwind purgue clases arbitrarias.
// ------------------------------------------------------------------
import { useState } from "react";
import AsistenteView from "./AsistenteView";

const ROJO = "#E62329";

// Roles que pueden ver el asistente. Ajustá esta lista si querés exponerlo a más roles.
const ROLES_PERMITIDOS = ["ejecutivo", "superadmin", "super", "admin"];

export default function AsistenteFlotante({ user = {} }) {
  const [open, setOpen] = useState(false);
  const rol = (user?.rol || "").toLowerCase();
  if (!ROLES_PERMITIDOS.includes(rol)) return null;

  const narrow = typeof window !== "undefined" && window.innerWidth < 480;

  const panelStyle = {
    position: "fixed",
    bottom: 88,
    right: 16,
    width: narrow ? "calc(100vw - 32px)" : 400,
    height: "70vh",
    maxHeight: 620,
    zIndex: 2147483000,
    background: "#ffffff",
    borderRadius: 16,
    boxShadow: "0 20px 50px rgba(0,0,0,0.30)",
    border: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const fabStyle = {
    position: "fixed",
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 9999,
    background: ROJO,
    color: "#ffffff",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2147483000,
  };

  return (
    <>
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Asistente IA">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <AsistenteView user={user} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <button
        style={fabStyle}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar asistente IA" : "Abrir asistente IA"}
        title="Asistente IA"
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
