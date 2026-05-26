// ============================================================
// LoadingScreen — pantalla de carga dedicada con kanji 蛙 animado
// ============================================================

interface Props {
  /** Mensaje opcional. Default: "Cargando…" */
  message?: string;
  /** Si true ocupa toda la pantalla. Si false, solo el contenedor padre. */
  fullscreen?: boolean;
}

export default function LoadingScreen({ message = 'Cargando…', fullscreen = true }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: fullscreen ? '100vh' : '40vh',
        background: fullscreen ? 'var(--bg-base)' : 'transparent',
        gap: 16,
      }}
    >
      {/* Kanji rana 蛙 con bounce */}
      <div
        style={{
          fontFamily: 'var(--font-kanji)',
          fontSize: 64,
          color: 'var(--accent-kaeru)',
          animation: 'kaeru-bounce 1s ease-in-out infinite',
          lineHeight: 1,
        }}
      >
        蛙
      </div>

      {/* Spinner */}
      <div
        style={{
          width: 28,
          height: 28,
          border: '2px solid var(--border-subtle, #2a2a2a)',
          borderTopColor: 'var(--accent-kaeru)',
          borderRadius: '50%',
          animation: 'kaeru-spin 0.8s linear infinite',
        }}
      />

      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {message}
      </div>
    </div>
  );
}
