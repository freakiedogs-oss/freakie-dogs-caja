import { useState, useEffect } from 'react'
import { db } from '../../supabase'

const ZONA_LABELS = {
  interior:  '🏠 Interior',
  principal: '🏠 Principal',
  terraza:   '🌿 Terraza',
  barra:     '🍺 Barra',
  vip:       '⭐ VIP',
  privado:   '🔒 Privado',
}

// Dimensiones del canvas SVG virtual (en unidades relativas)
const SVG_W = 100
const SVG_H = 55

export default function FloorPlanSelector({ storeCode, storeName, onSelectMesa, onBack }) {
  const [mesas, setMesas]           = useState([])
  const [ocupadas, setOcupadas]     = useState(new Set())  // Set de mesa IDs
  const [loading, setLoading]       = useState(true)
  const [selectedZona, setSelectedZona] = useState(null)
  const [hoveredMesa, setHoveredMesa]   = useState(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualNum, setManualNum]   = useState('')
  const [noMesas, setNoMesas]       = useState(false)

  // ── Cargar mesas + sesiones activas ──
  useEffect(() => {
    const load = async () => {
      setLoading(true)

      const { data: mesasData } = await db
        .from('pos_mesas')
        .select('*')
        .eq('store_code', storeCode)
        .eq('activa', true)
        .order('numero')

      if (!mesasData || mesasData.length === 0) {
        setNoMesas(true)
        setManualMode(true)
        setLoading(false)
        return
      }

      setMesas(mesasData)
      const primeraZona = mesasData[0]?.zona || 'principal'
      setSelectedZona(primeraZona)

      // Sesiones abiertas
      const { data: sesData } = await db
        .from('pos_sesiones_mesa')
        .select('mesa_id')
        .in('mesa_id', mesasData.map(m => m.id))
        .eq('estado', 'abierta')

      setOcupadas(new Set((sesData || []).map(s => s.mesa_id)))
      setLoading(false)
    }
    load()
  }, [storeCode])

  const zonas = [...new Set(mesas.map(m => m.zona || 'principal'))]
  const mesasZona = mesas.filter(m => (m.zona || 'principal') === selectedZona)

  const isOcupada = (mesa) => ocupadas.has(mesa.id)

  const handleSelectMesa = (mesa) => {
    if (isOcupada(mesa)) return
    onSelectMesa({
      id:     mesa.id,
      numero: String(mesa.numero),
      nombre: mesa.nombre || `Mesa ${mesa.numero}`,
      zona:   mesa.zona || 'principal',
    })
  }

  const handleManualConfirm = () => {
    if (!manualNum.trim()) return
    onSelectMesa({
      id:     null,
      numero: manualNum.trim(),
      nombre: `Mesa ${manualNum.trim()}`,
      zona:   'principal',
    })
  }

  // ── Render carga ──
  if (loading) {
    return (
      <div className="floorplan-overlay">
        <div className="floorplan-loading">
          <div className="spin" />
          Cargando plano del piso...
        </div>
      </div>
    )
  }

  // ── Render entrada manual (sin mesas o modo manual) ──
  if (noMesas || manualMode) {
    return (
      <div className="floorplan-overlay">
        <div className="floorplan-container">
          <div className="floorplan-header">
            <button className="floorplan-back-btn" onClick={noMesas ? onBack : () => setManualMode(false)}>
              ← {noMesas ? 'Volver' : 'Ver plano'}
            </button>
            <div className="floorplan-title">🪑 Mesa — {storeName}</div>
          </div>

          <div className="floorplan-manual-area">
            <div className="floorplan-manual-icon">🪑</div>
            <div className="floorplan-manual-title">
              {noMesas ? 'Ingresa el número de mesa' : 'Número de mesa manual'}
            </div>
            <input
              className="pos-mesa-input floorplan-input"
              type="text"
              placeholder="Ej: 5, A3, Terraza 2..."
              value={manualNum}
              onChange={e => setManualNum(e.target.value)}
              autoFocus
              maxLength={10}
              onKeyDown={e => e.key === 'Enter' && handleManualConfirm()}
            />
            <button
              className="pos-confirmar-btn"
              disabled={!manualNum.trim()}
              onClick={handleManualConfirm}
            >
              Confirmar Mesa
            </button>
            <button className="pos-cancelar-btn" onClick={onBack}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Estadísticas zona activa ──
  const libres   = mesasZona.filter(m => !isOcupada(m)).length
  const ocupadasN = mesasZona.filter(m => isOcupada(m)).length

  return (
    <div className="floorplan-overlay">
      <div className="floorplan-container">

        {/* ── Header ── */}
        <div className="floorplan-header">
          <button className="floorplan-back-btn" onClick={onBack}>← Volver</button>
          <div className="floorplan-title">🪑 Plano del Piso — {storeName}</div>
          <div className="floorplan-legend">
            <span className="fp-libre">● Libre</span>
            <span className="fp-ocupada">● Ocupada</span>
          </div>
        </div>

        {/* ── Zona tabs ── */}
        {zonas.length > 1 && (
          <div className="floorplan-zonas">
            {zonas.map(zona => (
              <button
                key={zona}
                className={`floorplan-zona-btn${selectedZona === zona ? ' active' : ''}`}
                onClick={() => setSelectedZona(zona)}
              >
                {ZONA_LABELS[zona] || zona}
              </button>
            ))}
          </div>
        )}

        {/* ── SVG Floor Plan ── */}
        <div className="floorplan-svg-wrapper">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="floorplan-svg"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Fondo del salón */}
            <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#1c1c22" rx="1" />

            {/* Cuadrícula sutil */}
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`vg${i}`} x1={(i + 1) * 10} y1="0" x2={(i + 1) * 10} y2={SVG_H}
                stroke="#2a2a32" strokeWidth="0.3" />
            ))}
            {Array.from({ length: 4 }).map((_, i) => (
              <line key={`hg${i}`} x1="0" y1={(i + 1) * (SVG_H / 5)} x2={SVG_W} y2={(i + 1) * (SVG_H / 5)}
                stroke="#2a2a32" strokeWidth="0.3" />
            ))}

            {/* Etiqueta zona */}
            <text x="1" y="4" fill="#2a2a32" fontSize="3" fontFamily="sans-serif">
              {ZONA_LABELS[selectedZona] || selectedZona}
            </text>

            {/* ── Mesas ── */}
            {mesasZona.map(mesa => {
              const x       = parseFloat(mesa.pos_x)
              const y       = parseFloat(mesa.pos_y)
              const w       = parseFloat(mesa.ancho)
              const h       = parseFloat(mesa.alto)
              const ocupada = isOcupada(mesa)
              const hovered = hoveredMesa === mesa.id && !ocupada
              const color   = ocupada ? '#ff6b35' : hovered ? '#6ef08f' : '#2dd4a8'
              const bgColor = ocupada ? '#1a0a0a' : hovered ? '#0a2015' : '#0d1a18'
              const forma   = mesa.forma || 'cuadrada'

              return (
                <g
                  key={mesa.id}
                  style={{ cursor: ocupada ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={() => !ocupada && setHoveredMesa(mesa.id)}
                  onMouseLeave={() => setHoveredMesa(null)}
                  onClick={() => handleSelectMesa(mesa)}
                >
                  {forma === 'redonda' ? (
                    <ellipse
                      cx={x + w / 2} cy={y + h / 2}
                      rx={w / 2 - 0.3} ry={h / 2 - 0.3}
                      fill={bgColor}
                      stroke={color}
                      strokeWidth={hovered ? 0.9 : 0.5}
                    />
                  ) : (
                    <rect
                      x={x} y={y} width={w} height={h}
                      fill={bgColor}
                      stroke={color}
                      strokeWidth={hovered ? 0.9 : 0.5}
                      rx={forma === 'rectangular' ? 0.5 : 1.2}
                    />
                  )}

                  {/* Número de mesa */}
                  <text
                    x={x + w / 2} y={y + h / 2 - 1.2}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={color}
                    fontSize={w > 10 ? 4 : 3}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {mesa.numero}
                  </text>

                  {/* Estado / capacidad */}
                  <text
                    x={x + w / 2} y={y + h / 2 + 2.5}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={ocupada ? '#ff6b3588' : '#2dd4a866'}
                    fontSize={2.2}
                    fontFamily="sans-serif"
                  >
                    {ocupada ? 'OCUPADA' : `${mesa.capacidad || 4} 👥`}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* ── Footer stats ── */}
        <div className="floorplan-footer">
          <span className="fp-stat-libre">{libres} libre{libres !== 1 ? 's' : ''}</span>
          <span className="fp-sep">·</span>
          <span className="fp-stat-ocup">{ocupadasN} ocupada{ocupadasN !== 1 ? 's' : ''}</span>
          <span className="fp-sep">·</span>
          <span className="fp-stat-total">{mesasZona.length} total</span>

          <button className="floorplan-manual-btn" onClick={() => setManualMode(true)}>
            # Manual
          </button>
        </div>
      </div>
    </div>
  )
}
