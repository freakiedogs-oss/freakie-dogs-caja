// Endpoint simple de test — si este responde "ok" entonces Vercel SÍ
// está escaneando y deployando archivos de /api/.
export const config = { runtime: 'edge' };

export default async function handler() {
  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString() }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
}
