import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useSession } from '@/lib/auth';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)' }}>
        <div className="text-muted">● Verificando sesión…</div>
      </div>
    );
  }

  if (!session || !session.rol) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
