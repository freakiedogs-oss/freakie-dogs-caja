/**
 * escpos.js — Generador de bytes ESC/POS para impresoras térmicas 80mm.
 * Probado contra: RPT-006B (USB+LAN+Bluetooth, ESC/POS). Compatible con
 * Epson TM, Xprinter, 3nstar y la mayoría de térmicas genéricas chinas.
 *
 * No tiene dependencias. Devuelve bytes crudos que se envían a la impresora:
 *   - vía RawBT (Android): `rawbt:base64,<ticket.base64()>`
 *   - vía bridge HTTP→TCP9100: POST { ip, port, dataB64 }
 *   - vía WebUSB/Web Bluetooth: ticket.bytes()
 *
 * Acentos: se setea codepage PC850 (multilingüe). Los caracteres españoles
 * comunes se mapean a PC850; lo no mapeado se transcribe a ASCII para que
 * NUNCA salga basura en una impresora genérica.
 *
 * 80mm Fuente A = 48 columnas. 80mm Fuente B = 64. 58mm = 32.
 */

// Mapa de caracteres → byte PC850 (cp850)
const PC850 = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
  'ñ': 0xA4, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A,
  '¿': 0xA8, '¡': 0xAD, '°': 0xF8, 'º': 0xA7, 'ª': 0xA6,
};

// Fallback ASCII (incluye casos de >1 carácter)
const ASCII_FALLBACK = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
  'ñ': 'n', 'Ñ': 'N', 'ü': 'u', 'Ü': 'U',
  '¿': '?', '¡': '!', '°': 'o', 'º': 'o', 'ª': 'a',
  '–': '-', '—': '-', '‐': '-', '’': "'", '‘': "'",
  '“': '"', '”': '"', '€': 'EUR', '…': '...', '•': '*',
};

export class Ticket {
  constructor(cols = 48) {
    this.cols = cols;
    this.b = [];
    this._init();
  }

  raw(...bytes) {
    for (const x of bytes) this.b.push(x & 0xff);
    return this;
  }

  _encChar(ch) {
    const code = ch.charCodeAt(0);
    if (code < 128) return code;
    if (PC850[ch] != null) return PC850[ch];
    const fb = ASCII_FALLBACK[ch];
    if (fb && fb.length === 1) return fb.charCodeAt(0);
    return 0x3f; // '?'
  }

  text(str = '') {
    for (const ch of String(str)) {
      const fb = ASCII_FALLBACK[ch];
      if (fb && fb.length > 1) {
        for (const c of fb) this.b.push(c.charCodeAt(0));
      } else {
        this.b.push(this._encChar(ch));
      }
    }
    return this;
  }

  _init() {
    this.raw(0x1b, 0x40);       // ESC @  → reset
    this.raw(0x1b, 0x74, 0x02); // ESC t 2 → codepage PC850
    return this;
  }

  /** align: 'left' | 'center' | 'right' */
  align(a) {
    const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
    return this.raw(0x1b, 0x61, n);
  }

  bold(on = true) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
  underline(on = true) { return this.raw(0x1b, 0x2d, on ? 1 : 0); }
  invert(on = true) { return this.raw(0x1d, 0x42, on ? 1 : 0); } // GS B (blanco/negro)

  /** size: ancho 1-8, alto 1-8 (1 = normal) */
  size(w = 1, h = 1) {
    const n = (((w - 1) & 0x07) << 4) | ((h - 1) & 0x07);
    return this.raw(0x1d, 0x21, n);
  }

  normal() { return this.size(1, 1).bold(false).invert(false); }

  feed(n = 1) { return this.raw(0x1b, 0x64, n & 0xff); }

  ln(str = '') { this.text(str); return this.raw(0x0a); }

  /** línea horizontal de guiones (o el char dado) a lo ancho del papel */
  hr(ch = '-') { return this.ln(ch.repeat(this.cols)); }

  /** fila a dos columnas: etiqueta a la izquierda, valor a la derecha */
  row(left, right) {
    left = String(left);
    right = String(right);
    const space = this.cols - left.length - right.length;
    if (space < 1) {
      this.ln(left);
      this.align('right').ln(right).align('left');
      return this;
    }
    return this.ln(left + ' '.repeat(space) + right);
  }

  /** envuelve texto largo a this.cols, con sangría opcional para líneas siguientes */
  wrap(str, indent = 0) {
    const words = String(str).split(/\s+/);
    let line = '';
    const pad = ' '.repeat(indent);
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (cand.length > this.cols) {
        this.ln(line);
        line = pad + w;
      } else {
        line = cand;
      }
    }
    if (line) this.ln(line);
    return this;
  }

  /** Código QR (modelo 2). size 1-16 (~6 = mediano legible en 80mm) */
  qr(data, size = 6) {
    const d = String(data);
    // module size
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    // error correction = M (49)
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
    // store data
    const len = d.length + 3;
    this.raw(0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.text(d);
    // print
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  /** abre la gaveta de dinero (si está conectada al puerto de la impresora) */
  drawer() { return this.raw(0x1b, 0x70, 0x00, 0x19, 0xfa); }

  /** corte parcial con avance de papel */
  cut() { this.feed(4); return this.raw(0x1d, 0x56, 0x42, 0x00); }

  bytes() { return Uint8Array.from(this.b); }

  base64() {
    let s = '';
    for (const x of this.b) s += String.fromCharCode(x);
    return btoa(s);
  }
}

export default Ticket;
