import { useEffect, useState } from 'react';
import { kaeru } from '@/lib/supabase';

// ============================================================
// useUnreadInbox — count unread del inbox del usuario actual
// ------------------------------------------------------------
// Lee de kaeru.v_notif_unread_mi (RLS filtra por auth.email() + rol).
// Polling cada 60s para mantenerlo fresco sin saturar.
// Si la vista no existe (migración no aplicada), retorna 0 silencioso.
// ============================================================

export interface UnreadCount {
  total:   number;
  danger:  number;
  warning: number;
  info:    number;
}

const ZERO: UnreadCount = { total: 0, danger: 0, warning: 0, info: 0 };

export function useUnreadInbox(pollMs = 60_000): UnreadCount {
  const [count, setCount] = useState<UnreadCount>(ZERO);

  useEffect(() => {
    let cancel = false;
    async function refresh() {
      try {
        const { data, error } = await kaeru
          .from('v_notif_unread_mi')
          .select('total,danger,warning,info')
          .maybeSingle();
        if (cancel) return;
        if (error) {
          // Migración no aplicada o sin permisos — silenciar
          if (!/relation .* does not exist/i.test(error.message)) {
            console.warn('[inbox] unread query:', error.message);
          }
          setCount(ZERO);
          return;
        }
        setCount({
          total:   Number(data?.total ?? 0),
          danger:  Number(data?.danger ?? 0),
          warning: Number(data?.warning ?? 0),
          info:    Number(data?.info ?? 0)
        });
      } catch {
        if (!cancel) setCount(ZERO);
      }
    }
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => { cancel = true; clearInterval(t); };
  }, [pollMs]);

  return count;
}
