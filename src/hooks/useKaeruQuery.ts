import { useEffect, useState } from 'react';
import { kaeru } from '@/lib/supabase';

export interface QueryState<T> {
  data: T[];
  count: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook genérico para queries simples a kaeru.*.
 * Retorna data, count, loading, error.
 */
export function useKaeruQuery<T = any>(
  table: string,
  options: {
    select?: string;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
    eq?: Record<string, any>;
    neq?: Record<string, any>;
    deps?: any[];
  } = {}
): QueryState<T> {
  const { select = '*', orderBy, limit, eq, neq, deps = [] } = options;
  const [state, setState] = useState<QueryState<T>>({ data: [], count: 0, loading: true, error: null });

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        let q: any = kaeru.from(table).select(select, { count: 'exact' });
        if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? false });
        if (limit) q = q.limit(limit);
        if (eq) Object.entries(eq).forEach(([k, v]) => { q = q.eq(k, v); });
        if (neq) Object.entries(neq).forEach(([k, v]) => { q = q.neq(k, v); });

        const { data, count, error } = await q;
        if (cancel) return;
        if (error) {
          setState({ data: [], count: 0, loading: false, error: error.message });
        } else {
          setState({ data: (data || []) as T[], count: count || 0, loading: false, error: null });
        }
      } catch (e: any) {
        if (!cancel) setState({ data: [], count: 0, loading: false, error: String(e?.message || e) });
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
