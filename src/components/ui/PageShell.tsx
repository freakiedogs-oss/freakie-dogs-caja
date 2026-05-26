import { ReactNode } from 'react';

interface PageShellProps {
  kanji: string;
  titulo: string;
  subtitulo: string;
  badge?: { label: string; variant: 'kaeru' | 'purple' | 'muted' | 'warning' | 'danger' };
  actions?: ReactNode;
  children: ReactNode;
}

export default function PageShell({ kanji, titulo, subtitulo, badge, actions, children }: PageShellProps) {
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
        <div className="page-actions">
          {badge && <span className={`badge badge-${badge.variant}`}>{badge.label}</span>}
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

export const LoadingCard = () => (
  <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
    ● Consultando Supabase…
  </div>
);

export const ErrorCard = ({ error }: { error: string }) => (
  <div className="card">
    <div className="card-title text-danger">Error</div>
    <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
  </div>
);

export const EmptyCard = ({ message }: { message: string }) => (
  <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
    {message}
  </div>
);
