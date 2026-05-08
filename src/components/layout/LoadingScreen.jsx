export default function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 20,
        background: 'transparent',
      }}
    >
      {/* Logo */}
      <div style={{ fontSize: 48, lineHeight: 1 }}>🍔</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: '#e63946',
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        FREAKIE DOGS
      </div>

      {/* Spinner */}
      <div
        style={{
          width: 36,
          height: 36,
          border: '3px solid #2a2a2a',
          borderTop: '3px solid #e63946',
          borderRadius: '50%',
          animation: 'fd-spin 0.8s linear infinite',
        }}
      />

      {/* Skeleton strips */}
      <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {[100, 75, 88].map((w, i) => (
          <div
            key={i}
            style={{
              height: 12,
              width: `${w}%`,
              background: '#1e1e1e',
              borderRadius: 6,
              animation: `fd-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes fd-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fd-pulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
