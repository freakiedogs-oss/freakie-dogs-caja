// Driver WebUSB para el adaptador CH340 de la Rhino BAR-6X.
//
// Por qué existe: en Android, Chrome casi nunca expone el CH340 por Web Serial
// (navigator.serial.requestPort devuelve "no se encontraron dispositivos"),
// pero SÍ lo expone por WebUSB. Este módulo habla el protocolo del chip a mano
// y devuelve un objeto con la misma forma que un SerialPort, para que el resto
// del porcionador no se entere de por dónde vino el dato.
//
// Portado desde ch340-webusb.ts del Paquete_Claude_Rhino_BAR6X_v11.
// El protocolo NO se tocó: las órdenes de control y la fórmula del baudrate
// son las mismas que ya funcionaban con la báscula real.

const CH340_VENDOR_ID = 0x1a86
const CH340_PRODUCT_ID = 0x7523
const LCR_8N1_RX_TX = 0xc3

function copyDataView(data) {
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

class DirectCh340Port {
  constructor(device) {
    this.device = device
    this.readable = null
    this.writable = null
    this.interfaceNumber = null
    this.inputEndpoint = null
    this.outputEndpoint = null
    this.closing = false
  }

  getInfo() {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId }
  }

  async controlOut(request, value, index) {
    const result = await this.device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request, value, index,
    })
    if (result.status !== 'ok') throw new Error(`El CH340 rechazó la orden 0x${request.toString(16)}`)
  }

  async controlIn(request, value, length = 2) {
    const result = await this.device.controlTransferIn({
      requestType: 'vendor', recipient: 'device', request, value, index: 0,
    }, length)
    if (result.status !== 'ok') throw new Error(`El CH340 no respondió a 0x${request.toString(16)}`)
    return result.data
  }

  async setBaudRate(baudRate) {
    const baudBaseFactor = 1532620800
    let factor = Math.floor(baudBaseFactor / baudRate)
    let divisor = 3
    while (factor > 0xfff0 && divisor > 0) {
      factor >>= 3
      divisor -= 1
    }
    if (factor > 0xfff0) throw new Error('La velocidad solicitada no es compatible con el CH340')
    factor = 0x10000 - factor
    divisor |= 0x0080
    const firstValue = (factor & 0xff00) | divisor
    const secondValue = factor & 0xff
    await this.controlOut(0x9a, 0x1312, firstValue)
    await this.controlOut(0x9a, 0x0f2c, secondValue)
  }

  async initialize() {
    await this.controlIn(0x5f, 0x0000)
    await this.controlOut(0xa1, 0x0000, 0x0000)
    await this.setBaudRate(9600)
    await this.controlIn(0x95, 0x2518)
    await this.controlOut(0x9a, 0x2518, LCR_8N1_RX_TX)
    await this.controlIn(0x95, 0x0706)
    await this.controlOut(0xa1, 0x501f, 0xd90a)
    await this.setBaudRate(9600)
    await this.controlOut(0xa4, 0xffff, 0x0000)
    await this.controlIn(0x95, 0x0706)
    await this.setBaudRate(9600)
    await this.controlOut(0x9a, 0x2518, LCR_8N1_RX_TX)
  }

  async open() {
    this.closing = false
    await this.device.open()
    if (!this.device.configuration) {
      const configurationValue = this.device.configurations[0]?.configurationValue ?? 1
      await this.device.selectConfiguration(configurationValue)
    }

    const interfaces = this.device.configuration?.interfaces ?? []
    const candidatos = interfaces.map(usbInterface => {
      const alternate = usbInterface.alternate ?? usbInterface.alternates[0]
      const input = alternate?.endpoints.find(ep => ep.type === 'bulk' && ep.direction === 'in')
      const output = alternate?.endpoints.find(ep => ep.type === 'bulk' && ep.direction === 'out')
      return input && output ? { usbInterface, input, output } : null
    }).filter(Boolean)
    const selected = candidatos[candidatos.length - 1]

    if (!selected) throw new Error('El adaptador CH340 no expuso sus entradas USB')
    await this.device.claimInterface(selected.usbInterface.interfaceNumber)
    this.interfaceNumber = selected.usbInterface.interfaceNumber
    this.inputEndpoint = selected.input
    this.outputEndpoint = selected.output
    await this.initialize()

    this.readable = new ReadableStream({
      pull: async controller => {
        if (this.closing || !this.inputEndpoint) { controller.close(); return }
        try {
          const result = await this.device.transferIn(
            this.inputEndpoint.endpointNumber,
            Math.max(64, this.inputEndpoint.packetSize),
          )
          if (result.status === 'stall') {
            await this.device.clearHalt('in', this.inputEndpoint.endpointNumber)
            return
          }
          if (result.status !== 'ok') throw new Error('Android interrumpió la lectura USB')
          if (result.data?.byteLength) controller.enqueue(copyDataView(result.data))
        } catch (error) {
          if (this.closing) controller.close()
          else controller.error(error)
        }
      },
      cancel: () => { this.closing = true },
    })

    this.writable = new WritableStream({
      write: async chunk => {
        if (this.closing || !this.outputEndpoint) throw new Error('La conexión USB está cerrada')
        const result = await this.device.transferOut(this.outputEndpoint.endpointNumber, chunk)
        if (result.status === 'stall') {
          await this.device.clearHalt('out', this.outputEndpoint.endpointNumber)
          throw new Error('La báscula pausó el envío; intentá conectar de nuevo')
        }
        if (result.status !== 'ok') throw new Error('No se pudo solicitar el peso por USB')
      },
    })
  }

  async close() {
    this.closing = true
    this.readable = null
    this.writable = null
    if (this.interfaceNumber !== null) {
      // Android a veces libera la interfaz solo al cerrar el lector: no es error.
      try { await this.device.releaseInterface(this.interfaceNumber) } catch { /* noop */ }
    }
    this.interfaceNumber = null
    this.inputEndpoint = null
    this.outputEndpoint = null
    await this.device.close()
  }
}

// En varias builds de Android el selector no encuentra nada si se le pasa un
// filtro exacto de VID/PID, aunque el aparato esté conectado. Por eso se pide
// la lista completa y se valida después, a mano.
export async function requestCh340Port(usb) {
  const device = await usb.requestDevice({ filters: [] })
  if (device.vendorId !== CH340_VENDOR_ID || device.productId !== CH340_PRODUCT_ID) {
    const vid = device.vendorId.toString(16).padStart(4, '0').toUpperCase()
    const pid = device.productId.toString(16).padStart(4, '0').toUpperCase()
    throw new Error(`Ese USB no es la Rhino (detectado ${vid}:${pid}). Elegí CH340, QinHeng o USB2.0-Serial`)
  }
  return new DirectCh340Port(device)
}
