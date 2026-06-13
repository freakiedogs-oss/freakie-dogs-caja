// AsistenteFlotante.jsx — FAB del Chat IA (cerebro), accesible en TODO momento.
// ------------------------------------------------------------------
// Montar UNA sola vez en el root de App.jsx (fuera del switch de vistas):
//   import AsistenteFlotante from "./components/dashboard/AsistenteFlotante";
//   <AsistenteFlotante user={user} />
// Estilos INLINE (no dependen de Tailwind).
// ------------------------------------------------------------------
import { useState } from "react";
import AsistenteView from "./AsistenteView";

const ROJO = "#E62329";
const ROLES_PERMITIDOS = ["ejecutivo", "superadmin", "super", "admin"];

const BrainIcon = ({ size = 26, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.6 6.5a3 3 0 0 0 .4-1.4" />
    <path d="M6 5.1a3 3 0 0 0 .4 1.4" />
    <path d="M6 18a4 4 0 0 1-2-.5" />
    <path d="M20 17.5a4 4 0 0 1-2 .5" />
  </svg>
);

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
    background: "#141414",
    borderRadius: 16,
    boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
    border: "1px solid #2a2a2a",
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
    boxShadow: "0 8px 22px rgba(230,35,41,0.45)",
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
          <BrainIcon size={27} color="#fff" />
        )}
      </button>
    </>
  );
}
