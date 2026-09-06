// Hook de conexión a la Rhino BAR-6X, para pantallas que necesitan el peso
// en vivo sin la lógica de porciones del porcionador.
//
// Por qué existe aparte y no se reusa PorcionadorApp: el porcionador acepta
// una porción sola cuando el peso se estabiliza dentro de un rango fijo. Acá
// se pesan 25 ingredientes distintos, de 1.5 g a 6.8 kg, y el operario elige
// cuál está pesando. Es el mismo cable y el mismo parser, pero otra decisión.
//
// El porcionador NO se tocó a propósito: es una estación en producción que ya
// perdió un turno entero de datos una vez. Se prefirió duplicar ~80 líneas
// antes que refactorizar código vivo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestCh340Port } from './ch340-webusb'

// Android casi nunca expone el CH340 por Web Serial aunque navigator.serial
// exista. Se decide por sistema operativo ANTES de mirar qué APIs hay.
const ES_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const SERIAL_CONFIG = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }

const DEFAULTS = {
  poll_interval_ms: 250,
  stability_window_ms: 1100,
  stability_min_readings: 4,
  stability_max_spread_g: 2,   // 1 división de la Rhino
}

// Parser idéntico al del porcionador. La báscula manda "  2.265 kg" o "265 g".
export function parseWeight(line) {
  const m = line.replace(/,/g, '.').match(/(-?\d+(?:\.\d+)?)\s*(kg|g|lb)s?/i)
  if (!m) return null
  const v = Number(m[1])
  const u = m[2].toLowerCase()
  if (!Number.isFinite(v)) return null
  if (u === 'kg') return Math.round(v * 1000)
  if (u === 'lb') return Math.round(v * 453.59237)
  return Math.round(v)
}

export function useBalanza(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts }

  const [estado, setEstado]   = useState('idle')   // idle | conectando | conectada | error
  const [mensaje, setMensaje] = useState('')
  const [gramos, setGramos]   = useState(0)
  const [estable, setEstable] = useState(false)
  const [lecturas, setLecturas] = useState(0)

  const portRef    = useRef(null)
  const writerRef  = useRef(null)
  const readerRef  = useRef(null)
  const pollRef    = useRef(null)
  const runRef     = useRef(false)
  const bufferRef  = useRef('')
  const histRef    = useRef([])
  const sendingRef = useRef(false)

  const registrar = useCallback((g) => {
    const now = Date.now()
    const recientes = [...histRef.current, { g, at: now }]
      .filter(r => now - r.at <= cfg.stability_window_ms)
      .slice(-6)
    histRef.current = recientes
    const vals = recientes.map(r => r.g)
    const esEstable = recientes.length >= cfg.stability_min_readings &&
                      (Math.max(...vals) - Math.min(...vals)) <= cfg.stability_max_spread_g
    setGramos(g)
    setEstable(esEstable)
    setLecturas(n => n + 1)
  }, [cfg.stability_window_ms, cfg.stability_min_readings, cfg.stability_max_spread_g])

  const procesar = useCallback((bytes) => {
    bufferRef.current += new TextDecoder().decode(bytes)
    const lineas = bufferRef.current.split(/[\r\n]+/)
    bufferRef.current = lineas.pop() ?? ''
    for (const l of lineas) {
      const g = parseWeight(l)
      if (g !== null) registrar(g)
    }
  }, [registrar])

  const pedirPeso = useCallback(async () => {
    const w = writerRef.current
    if (!w || sendingRef.current) return
    sendingRef.current = true
    try { await w.write(new Uint8Array([80])) }        // 'P' = poll
    catch (e) { setEstado('error'); setMensaje(e.message || 'Se cortó la conexión con la báscula') }
    finally { sendingRef.current = false }
  }, [])

  const leerSiempre = useCallback(async (port) => {
    while (runRef.current && port.readable) {
      const reader = port.readable.getReader()
      readerRef.current = reader
      try {
        while (runRef.current) {
          const { value, done } = await reader.read()
          if (done) break
          if (value?.length) procesar(value)
        }
      } catch (e) {
        if (runRef.current) { setEstado('error'); setMensaje(e.message || 'Lectura interrumpida') }
      } finally {
        try { reader.releaseLock() } catch { /* noop */ }
        readerRef.current = null
      }
    }
  }, [procesar])

  const desconectar = useCallback(async () => {
    runRef.current = false
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try { await readerRef.current?.cancel() } catch { /* noop */ }
    try { writerRef.current?.releaseLock() } catch { /* noop */ }
    try { await portRef.current?.close() } catch { /* noop */ }
    portRef.current = null; writerRef.current = null
    histRef.current = []; bufferRef.current = ''
    setEstado('idle'); setMensaje(''); setGramos(0); setEstable(false); setLecturas(0)
  }, [])

  const conectar = useCallback(async () => {
    const hayUsb    = typeof navigator !== 'undefined' && 'usb' in navigator
    const haySerial = typeof navigator !== 'undefined' && 'serial' in navigator
    if (ES_ANDROID ? !hayUsb : !haySerial) {
      setEstado('error')
      setMensaje(ES_ANDROID
        ? 'Esta versión de Chrome no soporta USB. Actualizá Chrome desde Play Store'
        : 'Abrí esta página en Chrome o Edge de escritorio')
      return
    }
    try {
      setEstado('conectando')
      let port
      if (ES_ANDROID) {
        setMensaje('Elegí el USB de la báscula: CH340, QinHeng o USB2.0-Serial')
        port = await requestCh340Port(navigator.usb)
      } else {
        setMensaje('Seleccioná USB-SERIAL CH340')
        port = await navigator.serial.requestPort()
      }
      await port.open(SERIAL_CONFIG)
      if (!port.writable) throw new Error('El puerto no permite escribir')
      portRef.current = port
      writerRef.current = port.writable.getWriter()
      bufferRef.current = ''; histRef.current = []
      setGramos(0); setEstable(false); setLecturas(0)
      setEstado('conectada'); setMensaje('Rhino conectada · esperando la primera lectura')
      runRef.current = true
      void leerSiempre(port)
      await pedirPeso()
      pollRef.current = setInterval(() => void pedirPeso(), cfg.poll_interval_ms)
    } catch (e) {
      setEstado('error')
      // Un "no se pudo abrir" genérico esconde la causa y hace perder media hora
      // adivinando si es el cable, el permiso o el chip.
      const nombre = e instanceof DOMException ? e.name : ''
      if (nombre === 'NotFoundError')      setMensaje('No elegiste ningún dispositivo. Volvé a intentar y tocá el CH340.')
      else if (nombre === 'SecurityError') setMensaje('El navegador bloqueó el acceso. Abrí la página con https.')
      else if (nombre === 'NetworkError')  setMensaje('El USB se desconectó. Revisá el cable y volvé a conectar.')
      else setMensaje(e.message || 'No se pudo abrir la báscula')
    }
  }, [leerSiempre, pedirPeso, cfg.poll_interval_ms])

  // Cerrar el puerto al desmontar: si queda abierto, la próxima conexión falla
  // con "el dispositivo está en uso" y no hay forma obvia de recuperarlo.
  useEffect(() => () => {
    runRef.current = false
    if (pollRef.current) clearInterval(pollRef.current)
    try { readerRef.current?.cancel() } catch { /* noop */ }
    try { portRef.current?.close() } catch { /* noop */ }
  }, [])

  return { estado, mensaje, gramos, estable, lecturas, conectar, desconectar }
}
