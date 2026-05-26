interface PlaceholderProps {
  kanji: string;
  titulo: string;
  subtitulo: string;
  fase: number;
  descripcion: string;
  features?: string[];
}

export default function Placeholder({ kanji, titulo, subtitulo, fase, descripcion, features = [] }: PlaceholderProps) {
  return (
    <div className="stack">
      <div className="page-header">
        <div className="page-title">
          <span className="page-title-kanji">{kanji}</span>
          <div>
            <div className="page-title-text">{titulo}</div>
            <div className="page-title-sub">{subtitulo}</div>
          </div>
        </div>
        <span className={`badge badge-${fase === 1 ? 'kaeru' : fase === 2 ? 'purple' : 'muted'}`}>
          Fase {fase}
        </span>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Módulo en desarrollo</div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7 }}>{descripcion}</p>
        {features.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>Lo que va a incluir</div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {features.map((f, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                  <span className="text-kaeru" style={{ marginTop: 2 }}>●</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
