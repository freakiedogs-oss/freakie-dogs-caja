/* ═══════════════════════════════════════════════════════════════════════
   Hablarle a la Zebra por USB, desde el navegador de la tablet

   La ZD421 se presenta como impresora USB estándar (clase 7). WebUSB puede
   reclamar esa interfaz y escribirle ZPL en crudo por su endpoint de salida.
   No hay driver que instalar ni diálogo de impresión: se manda el texto y la
   etiqueta sale.

   Dos cosas que hay que saber y que cuestan una tarde si no se saben:

   · El permiso lo da el usuario con un gesto. `requestDevice` tiene que
     salir de un clic, no de un useEffect. Por eso conectar es un botón.
   · El permiso sobrevive al recargar la página (queda guardado para ese
     origen), así que al abrir se intenta reusar el aparato ya autorizado
     con `getDevices` antes de molestar a nadie.

   Si la tablet no da WebUSB (iPad, o Chrome sin HTTPS) el módulo lo dice
   claro en vez de fallar callado: el peor resultado posible en esta
   estación es que alguien crea que imprimió.
   ═══════════════════════════════════════════════════════════════════════ */

const ZEBRA_VENDOR_ID = 0x0a5f
const CLASE_IMPRESORA = 7

export const hayWebUsb = () => typeof navigator !== 'undefined' && !!navigator.usb

/* Busca, dentro del aparato, la interfaz de impresora y su endpoint de
   salida. Se recorre en vez de asumir la 0: según el firmware y si está
   habilitado el modo de almacenamiento, la impresora no siempre es la
   primera. */
function buscarSalida(device) {
  for (const cfg of device.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        const esImpresora = alt.interfaceClass === CLASE_IMPRESORA
        const salida = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
        if (esImpresora && salida) {
          return { configuration: cfg.configurationValue, interfaceNumber: iface.interfaceNumber, endpoint: salida.endpointNumber }
        }
      }
    }
  }
  // Algunas unidades reportan clase 255 (específica del fabricante). Si no
  // apareció ninguna de clase 7, vale el primer bulk de salida que haya.
  for (const cfg of device.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        const salida = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
        if (salida) {
          return { configuration: cfg.configurationValue, interfaceNumber: iface.interfaceNumber, endpoint: salida.endpointNumber }
        }
      }
    }
  }
  return null
}

export class ImpresoraZebra {
  constructor() {
    this.device = null
    this.ruta = null
  }

  get conectada() { return !!(this.device && this.device.opened && this.ruta) }

  /* Reusa un aparato ya autorizado. No pide permiso ni abre diálogos, así
     que se puede llamar al cargar la pantalla. */
  async reconectar() {
    if (!hayWebUsb()) return false
    const previos = await navigator.usb.getDevices()
    const zebra = previos.find(d => d.vendorId === ZEBRA_VENDOR_ID)
    if (!zebra) return false
    await this._abrir(zebra)
    return true
  }

  /* Pide permiso. TIENE que llamarse desde un clic del usuario. */
  async conectar() {
    if (!hayWebUsb()) {
      throw new Error('Esta tablet no permite hablarle a la impresora por USB. Usá Chrome en Android y entrá por https.')
    }
    const device = await navigator.usb.requestDevice({ filters: [{ vendorId: ZEBRA_VENDOR_ID }] })
    await this._abrir(device)
    return true
  }

  async _abrir(device) {
    if (!device.opened) await device.open()
    const ruta = buscarSalida(device)
    if (!ruta) throw new Error('La impresora se conectó pero no expone por dónde recibir. Desconectala del cable y volvé a conectarla.')
    if (device.configuration?.configurationValue !== ruta.configuration) {
      await device.selectConfiguration(ruta.configuration)
    }
    try {
      await device.claimInterface(ruta.interfaceNumber)
    } catch (e) {
      // En Android el sistema puede tener tomada la interfaz si hay una app
      // de impresión instalada. Vale la pena decirlo con nombre y apellido.
      throw new Error('Otra aplicación tiene tomada la impresora. Cerrá la app de impresión de Zebra y volvé a intentar.')
    }
    this.device = device
    this.ruta = ruta
  }

  /* Manda ZPL. Se trocea porque el endpoint tiene un tamaño de paquete y
     una etiqueta con QR puede pasarse. */
  async enviar(zpl) {
    if (!this.conectada) throw new Error('La impresora no está conectada.')
    const datos = new TextEncoder().encode(zpl.endsWith('\n') ? zpl : zpl + '\n')
    const TROZO = 4096
    for (let i = 0; i < datos.length; i += TROZO) {
      const r = await this.device.transferOut(this.ruta.endpoint, datos.slice(i, i + TROZO))
      if (r.status !== 'ok') throw new Error('La impresora rechazó los datos (' + r.status + ').')
    }
  }

  async desconectar() {
    try {
      if (this.device?.opened) {
        await this.device.releaseInterface(this.ruta.interfaceNumber)
        await this.device.close()
      }
    } catch { /* si ya se fue, da igual */ }
    this.device = null
    this.ruta = null
  }
}
