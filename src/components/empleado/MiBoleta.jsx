import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', blue: '#60a5fa',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
};
const cardStyle = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 16, marginBottom: 12 };

export default function MiBoleta({ user }) {
  const [boletas, setBoletas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const storeName = STORES[user.store_code] || user.store_code || '';

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Try to find empleado linked to this user
        const { data: emp } = await db.from('empleados')
          .select('id, nombre_completo, cargo, salario_mensual')
          .or(`codigo_empleado.eq.${user.id},nombre_completo.ilike.%${user.nombre}%`)
          .limit(1)
          .maybeSingle();

        if (emp) {
          const { data } = await db.from('recibos_pago')
            .select('*')
            .eq('empleado_id', emp.id)
            .order('periodo', { ascending: false })
            .limit(12);
          setBoletas((data || []).map(b => ({ ...b, empleado: emp })));
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [user]);

  const fmtMoney = (v) => `$${(parseFloat(v) || 0).toFixed(2)}`;

  return (
    <div style={{ padding: '16px 12px', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>🧾 Mi Boleta</div>
        <div style={{ fontSize: 13, color: c.textDim, marginTop: 2 }}>{user.nombre} · {storeName}</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando...</div>
      ) : boletas.length === 0 ? (
        <div>
          <div style={{ ...cardStyle, textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 14, color: c.textOff }}>No hay boletas disponibles aún</div>
            <div style={{ fontSize: 12, color: c.textOff, marginTop: 4 }}>
              Tus recibos de pago aparecerán aquí cuando estén listos
            </div>
          </div>

          {/* Info card */}
          <div style={{ ...cardStyle, borderColor: c.greenDark }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.green, marginBottom: 6 }}>ℹ️ Información</div>
            <div style={{ fontSize: 13, color: c.textDim, lineHeight: 1.5 }}>
              Las boletas se generan al finalizar cada quincena. Si tenés dudas sobre tu pago,
              contactá al departamento de RRHH.
            </div>
          </div>
        </div>
      ) : selected ? (
        /* Detalle de boleta */
        <div>
          <button onClick={() => setSelected(null)} style={{
            background: 'none', border: 'none', color: c.red, fontSize: 14,
            cursor: 'pointer', marginBottom: 12, padding: 0, fontWeight: 600,
          }}>← Volver</button>

          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.text, marginBottom: 12 }}>
              Periodo: {selected.periodo}
            </div>

            <div style={{ borderBottom: `1px solid ${c.border}`, paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: c.textDim, marginBottom: 4 }}>INGRESOS</div>
              <Row label="Salario base" value={fmtMoney(selected.salario_base)} color={c.text} />
              {selected.horas_extra > 0 && <Row label="Horas extra" value={fmtMoney(selected.horas_extra)} color={c.green} />}
              {selected.bonificaciones > 0 && <Row label="Bonificaciones" value={fmtMoney(selected.bonificaciones)} color={c.green} />}
              {selected.propinas > 0 && <Row label="Propinas" value={fmtMoney(selected.propinas)} color={c.green} />}
            </div>

            <div style={{ borderBottom: `1px solid ${c.border}`, paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: c.textDim, marginBottom: 4 }}>DEDUCCIONES</div>
              {selected.isss > 0 && <Row label="ISSS" value={`-${fmtMoney(selected.isss)}`} color={c.red} />}
              {selected.afp > 0 && <Row label="AFP" value={`-${fmtMoney(selected.afp)}`} color={c.red} />}
              {selected.renta > 0 && <Row label="Renta" value={`-${fmtMoney(selected.renta)}`} color={c.red} />}
              {selected.otros_descuentos > 0 && <Row label="Otros" value={`-${fmtMoney(selected.otros_descuentos)}`} color={c.red} />}
            </div>

            <Row label="NETO A RECIBIR" value={fmtMoney(selected.neto)} color={c.green} bold />
          </div>
        </div>
      ) : (
        /* Lista de boletas */
        <div>
          {boletas.map((b, i) => (
            <div key={i} onClick={() => setSelected(b)} style={{
              ...cardStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{b.periodo}</div>
                <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>
                  {b.estado === 'pagado' ? '✓ Pagado' : b.estado || 'Generado'}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: c.green }}>
                {fmtMoney(b.neto)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: bold ? c.text : '#aaa', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: 14, color: color || c.text, fontWeight: bold ? 700 : 600, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}
