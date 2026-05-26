import { useEffect, useState } from 'react';
import { kaeru } from './supabase';

export interface KaeruSession {
  email: string;
  rol: string | null;
  nombre_display: string | null;
  empleado_id: string | null;
}

export function useSession() {
  const [session, setSession] = useState<KaeruSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const { data: { session: s }, error: sessErr } = await kaeru.auth.getSession();

        if (cancel) return;
        if (sessErr) {
          console.warn('[auth] getSession error:', sessErr);
          setSession(null);
          setLoading(false);
          return;
        }

        if (!s?.user?.email) {
          setSession(null);
          setLoading(false);
          return;
        }

        // Buscar rol en kaeru.user_roles (policy self_read permite leer la propia fila)
        const { data: rolData, error: rolErr } = await kaeru
          .from('user_roles')
          .select('rol, nombre_display, empleado_id')
          .eq('email', s.user.email)
          .eq('activo', true)
          .maybeSingle();

        if (cancel) return;
        if (rolErr) {
          console.warn('[auth] user_roles lookup error:', rolErr);
        }

        setSession({
          email: s.user.email,
          rol: rolData?.rol ?? null,
          nombre_display: rolData?.nombre_display ?? null,
          empleado_id: rolData?.empleado_id ?? null
        });
        setLoading(false);
      } catch (e) {
        if (cancel) return;
        console.error('[auth] useSession refresh failed:', e);
        setSession(null);
        setLoading(false);
      }
    }

    // Timeout de seguridad: si después de 6s aún loading, asume null
    timeoutId = setTimeout(() => {
      if (cancel) return;
      console.warn('[auth] useSession timeout — asumiendo sin sesión');
      setSession(null);
      setLoading(false);
    }, 6000);

    refresh().finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    const { data: { subscription } } = kaeru.auth.onAuthStateChange(() => {
      refresh();
    });

    return () => {
      cancel = true;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

export async function signIn(email: string, password: string) {
  return kaeru.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  return kaeru.auth.signUp({ email, password });
}

export async function signOut() {
  return kaeru.auth.signOut();
}
