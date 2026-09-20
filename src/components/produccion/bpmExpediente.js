import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   Expediente de producción por tanda (fase 3 de la auditoría de Mauricio)

   El requisito 6 de su informe: "datos, evidencias, fotos, lotes,
   parámetros, desvíos, responsables, liberaciones y PDF controlado".
   La evidencia ya estaba guardada; lo que faltaba era poder sacarla.

   Se arma con texto vectorial (no captura de pantalla) para que se pueda
   buscar y copiar un lote, y jsPDF entra por import dinámico: son ~390 kB
   que no tienen por qué viajar en el bundle de la pantalla del operario.
   ═══════════════════════════════════════════════════════════════════════ */

const TZ = 'America/El_Salvador'
const hora = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—'
const horaSeg = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }) : '—'
const fechaHora = (iso) => iso ? `${new Date(iso).toLocaleDateString('es-SV', { timeZone: TZ })} ${hora(iso)}` : '—'

export async function cargarExpediente(corridaId) {
  const [{ data: corrida }, { data: registros }, { data: desviaciones }, { data: pesajes }, { data: equipos }, { data: quimicos }] = await Promise.all([
    db.from('bpm_corridas').select('*').eq('id', corridaId).single(),
    db.from('bpm_registros').select('*').eq('corrida_id', corridaId).order('orden'),
    db.from('bpm_desviaciones').select('*').eq('corrida_id', corridaId).order('creada_at'),
    db.from('bpm_registro_pesajes').select('*, bpm_pesaje_items(ingrediente, gramos_objetivo, unidad, orden)').eq('corrida_id', corridaId),
    db.from('bpm_equipos').select('id, codigo, nombre, calibracion_vence'),
    db.from('bpm_quimicos').select('id, nombre, categoria, unidad_concentracion'),
  ])
  if (!corrida) throw new Error('No se encontró la tanda')
  const { data: pasos } = await db.from('bpm_pasos').select('*').eq('plantilla_id', corrida.plantilla_id).order('orden')
  const ids = [...new Set([corrida.iniciada_por, corrida.liberada_por, ...(registros || []).map(r => r.registrado_por)].filter(Boolean))]
  const { data: usuarios } = ids.length
    ? await db.from('usuarios_erp').select('id, nombre').in('id', ids)
    : { data: [] }
  return {
    corrida, pasos: pasos || [], registros: registros || [], desviaciones: desviaciones || [],
    pesajes: (pesajes || []).sort((a, b) => (a.bpm_pesaje_items?.orden || 0) - (b.bpm_pesaje_items?.orden || 0)),
    equipos: equipos || [], quimicos: quimicos || [],
    quien: Object.fromEntries((usuarios || []).map(u => [u.id, u.nombre])),
  }
}

// ── Lo capturado en los controles, en frases que se puedan leer ──
// Sin esto el expediente sería un volcado de JSON: cierto pero inútil.
function detalleControles(paso, datos, ex) {
  const out = []
  const eqCodigo = (id) => ex.equipos.find(e => e.id === id)?.codigo || '—'
  for (const c of paso.controles || []) {
    const v = datos?.valores?.[c.clave] || {}

    if (c.tipo === 'equipo') {
      if (c.opcional && v.aplica === false) { out.push([c.titulo, 'No aplica']); continue }
      out.push([c.titulo, eqCodigo(v.equipo_id)])
      for (const k of c.criterios || []) out.push([`· ${k.texto}`, v.criterios?.[k.clave] || '—'])
    }

    if (c.tipo === 'matriz') {
      if (c.cantidad && v.cantidad) out.push([`${c.titulo} · cantidad`, String(v.cantidad)])
      for (const k of c.criterios || []) out.push([`${c.titulo} · ${k.texto}`, v.criterios?.[k.clave] || '—'])
    }

    if (c.tipo === 'quimicos') {
      for (const linea of c.lineas || []) {
        const l = v[linea] || {}
        const q = ex.quimicos.find(x => x.id === l.quimico_id)
        const nombre = l.quimico_id === 'otro' ? (l.otro || 'Otro') : (q?.nombre || '—')
        out.push([`${linea.charAt(0).toUpperCase() + linea.slice(1)}`,
          `${nombre} · lote ${l.lote || '—'} · ${l.proveedor || 'sin proveedor'} · vence ${l.vencimiento || '—'} · ${l.concentracion ?? '—'} ${q?.unidad_concentracion || ''}`.trim()])
      }
    }

    if (c.tipo === 'secuencia') {
      for (const e of c.etapas || []) {
        if (e.cronometro) {
          const cr = v.cronometro || {}
          out.push([`${c.titulo} · tiempo de contacto`,
            cr.fin ? `${horaSeg(cr.inicio)} a ${horaSeg(cr.fin)} · ${Math.round(cr.seg)} s${cr.requerido ? ` (exigido ${cr.requerido} s)` : ''} · ${cr.veredicto === 'sin_parametro' ? 'sin parámetro' : cr.veredicto}` : '—'])
          continue
        }
        const r = v.etapas?.[e.clave]
        out.push([`${c.titulo} · ${e.texto}`, r?.estado ? `${r.estado} · ${horaSeg(r.hora)}${r.por ? ` · ${r.por}` : ''}` : '—'])
      }
      if (v.esponja) out.push([`${c.titulo} · esponja`, `${v.esponja.condicion || '—'}${v.esponja.color ? ` · color ${v.esponja.color}` : ''}`])
    }

    if (c.tipo === 'basculas') {
      for (const k of v.orden || ['1', '2']) {
        const f = v.filas?.[k] || {}
        const crit = (c.criterios || []).map(x => `${x.texto}: ${f.criterios?.[x.clave] || '—'}`).join(' · ')
        out.push([`Báscula ${k}`, `${eqCodigo(f.equipo_id)} · ${crit}`])
      }
    }

    if (c.tipo === 'tabla') {
      for (const f of c.filas || []) {
        const r = v[f.clave] || {}
        const linea = (c.columnas || []).map(col => {
          const val = r[col.clave]
          const txt = col.tipo === 'hora' && val ? val : (val ?? '—')
          return `${col.label}: ${txt}${col.unidad && val ? ' ' + col.unidad : ''}`
        }).join(' · ')
        out.push([f.nombre, linea])
      }
    }

    if (c.tipo === 'eventos') {
      for (const hito of c.hitos || []) {
        const r = v.hitos?.[hito.clave]
        out.push([`${hito.minuto != null ? `Min ${hito.minuto} · ` : ''}${hito.texto}`,
          r?.hora ? `${horaSeg(r.hora)}${r.por ? ` · ${r.por}` : ''}` : '—'])
        for (const col of hito.campos || []) {
          if (col.tipo === 'duracion') {
            const a = v.hitos?.[col.desde]?.hora, b = v.hitos?.[col.hasta]?.hora
            const min = a && b ? Math.round((new Date(b) - new Date(a)) / 600) / 100 : null
            out.push([`· ${col.label}`, min != null ? `${min} ${col.unidad || 'min'} (calculado)` : '—'])
            continue
          }
          const val = v.campos?.[col.clave]
          out.push([`· ${col.label}`, val != null && val !== '' ? `${val}${col.unidad ? ' ' + col.unidad : ''}` : '—'])
        }
      }
    }

    if (c.tipo === 'campos') {
      if (c.tipo_equipo) out.push([c.label_equipo || 'Equipo', eqCodigo(v.equipo_id)])
      for (const col of c.campos || []) {
        const val = v.campos?.[col.clave]
        out.push([col.label, val != null && val !== '' ? `${val}${col.unidad ? ' ' + col.unidad : ''}` : '—'])
      }
    }
  }
  return out
}

export async function descargarExpediente(corridaId) {
  const ex = await cargarExpediente(corridaId)
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const c = ex.corrida
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const M = 14
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const dcha = ancho - M
  let y = 20

  const pasoDe = (id) => ex.pasos.find(p => p.id === id)
  const nombre = (id) => ex.quien[id] || '—'

  // ── Encabezado ──
  doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(34)
  doc.text('Expediente de producción · Chili', M, y)
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(102)
  doc.text('Freakie Dogs · Casa Matriz', dcha, y, { align: 'right' })
  y += 6
  doc.setFontSize(8.5)
  doc.text(`Tanda del ${c.fecha}${c.lote ? ` · lote ${c.lote}` : ''}`, M, y)
  doc.text(`Emitido ${fechaHora(new Date().toISOString())}`, dcha, y, { align: 'right' })
  y += 7

  if (c.es_revision) {
    doc.setFillColor(255, 244, 217); doc.setDrawColor(240, 200, 120)
    doc.roundedRect(M, y - 4, ancho - M * 2, 9, 1.5, 1.5, 'FD')
    doc.setTextColor(140, 90, 10); doc.setFont(undefined, 'bold')
    doc.text('CORRIDA DE REVISIÓN — no es producción. No se exigió evidencia.', M + 3, y + 2)
    doc.setFont(undefined, 'normal'); doc.setTextColor(102)
    y += 12
  }

  // ── Resumen de la tanda ──
  const hechos = ex.registros.length
  const malos = ex.registros.filter(r => r.cumple === false).length
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1.4, textColor: 60 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38, textColor: 100 }, 2: { fontStyle: 'bold', cellWidth: 38, textColor: 100 } },
    body: [
      ['Estado', String(c.estado), 'Abierta', `${fechaHora(c.iniciada_at)} · ${nombre(c.iniciada_por)}`],
      ['Pasos', `${hechos} de ${ex.pasos.length} registrados${malos ? ` · ${malos} no conformes` : ''}`, 'Cerrada', c.cerrada_at ? fechaHora(c.cerrada_at) : '—'],
      ['Desviaciones', String(ex.desviaciones.length), 'Liberación',
        c.liberada_at ? `${fechaHora(c.liberada_at)} · ${nombre(c.liberada_por)}` : '—'],
      ...(c.liberacion_motivo ? [['Motivo', { content: c.liberacion_motivo, colSpan: 3 }]] : []),
    ],
  })
  y = doc.lastAutoTable.finalY + 6

  // ── Los pasos, en orden ──
  autoTable(doc, {
    startY: y, margin: { left: M, right: M },
    head: [['#', 'Paso', 'Hora', 'Responsable', 'Resultado']],
    headStyles: { fillColor: [31, 58, 82], fontSize: 8, textColor: 255 },
    styles: { fontSize: 8, cellPadding: 1.6, textColor: 50 },
    columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 16 }, 3: { cellWidth: 34 }, 4: { cellWidth: 22 } },
    body: ex.pasos.map(p => {
      const rs = ex.registros.filter(r => r.paso_id === p.id)
      const r = rs[rs.length - 1]
      return [
        String(p.orden),
        p.titulo + (rs.length > 1 ? ` (${rs.length} verificaciones)` : ''),
        r ? hora(r.registrado_at) : '—',
        r ? (r.datos?.registrado_por_nombre || nombre(r.registrado_por)) : '—',
        r ? (r.cumple ? 'Cumple' : 'No cumple') : 'Sin registrar',
      ]
    }),
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 4) {
        if (d.cell.raw === 'No cumple') d.cell.styles.textColor = [180, 35, 24]
        if (d.cell.raw === 'Cumple') d.cell.styles.textColor = [20, 108, 67]
      }
    },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Detalle de cada paso con controles ──
  const salto = (necesita = 40) => { if (y > alto - necesita) { doc.addPage(); y = 20 } }
  for (const p of ex.pasos) {
    const regs = ex.registros.filter(r => r.paso_id === p.id)
    if (!regs.length) continue
    for (const r of regs) {
      const filas = detalleControles(p, r.datos, ex)
      if (!filas.length && !r.nota && r.temperatura_c == null && !r.foto_url) continue
      salto()
      doc.setFontSize(9.5); doc.setFont(undefined, 'bold'); doc.setTextColor(31, 58, 82)
      const sufijo = regs.length > 1 ? ` · verificación ${regs.indexOf(r) + 1} de ${regs.length}` : ''
      doc.text(`Paso ${p.orden} · ${p.titulo}${sufijo}`, M, y)
      doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text(`${hora(r.registrado_at)} · ${r.datos?.registrado_por_nombre || nombre(r.registrado_por)} · ${r.cumple ? 'cumple' : 'NO CUMPLE'}`, dcha, y, { align: 'right' })
      y += 3
      const extra = []
      if (r.temperatura_c != null) extra.push([p.temp_label || 'Temperatura', `${r.temperatura_c} °C`])
      if (r.duracion_seg != null) extra.push(['Duración', `${r.duracion_seg} s`])
      if (r.nota) extra.push(['Nota', r.nota])
      if (r.foto_url) extra.push(['Foto', r.foto_url])
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'grid',
        styles: { fontSize: 7.8, cellPadding: 1.3, textColor: 60, lineColor: [225, 231, 238] },
        columnStyles: { 0: { cellWidth: 72, textColor: 95 } },
        body: [...filas, ...extra],
      })
      y = doc.lastAutoTable.finalY + 5
    }
  }

  // ── Pesaje ──
  if (ex.pesajes.length) {
    salto(50)
    doc.setFontSize(9.5); doc.setFont(undefined, 'bold'); doc.setTextColor(31, 58, 82)
    doc.text('Pesaje y trazabilidad de los ingredientes', M, y)
    doc.setFont(undefined, 'normal'); y += 3
    autoTable(doc, {
      startY: y, margin: { left: M, right: M },
      head: [['Ingrediente', 'Objetivo', 'Real', 'Lote', 'Proveedor', 'Vence', 'Báscula', 'Resultado']],
      headStyles: { fillColor: [31, 58, 82], fontSize: 7.5, textColor: 255 },
      styles: { fontSize: 7.3, cellPadding: 1.2, textColor: 50 },
      columnStyles: { 1: { halign: 'right', cellWidth: 16 }, 2: { halign: 'right', cellWidth: 16 }, 5: { cellWidth: 17 }, 6: { cellWidth: 16 }, 7: { cellWidth: 17 } },
      body: ex.pesajes.map(p => {
        const it = p.bpm_pesaje_items || {}
        return [
          it.ingrediente || '—',
          `${Number(it.gramos_objetivo ?? 0).toLocaleString('es-SV')} ${it.unidad || ''}`,
          `${Number(p.gramos_real ?? 0).toLocaleString('es-SV')} ${it.unidad || ''}`,
          p.lote || '—', p.proveedor || '—', p.vencimiento || '—',
          p.bascula_codigo || '—',
          p.cumple ? 'Cumple' : (p.motivo_no_cumple || 'No cumple'),
        ]
      }),
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 7 && d.cell.raw !== 'Cumple') d.cell.styles.textColor = [180, 35, 24]
      },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  // ── Desviaciones ──
  if (ex.desviaciones.length) {
    salto(50)
    doc.setFontSize(9.5); doc.setFont(undefined, 'bold'); doc.setTextColor(180, 35, 24)
    doc.text('Desviaciones', M, y)
    doc.setFont(undefined, 'normal'); y += 3
    autoTable(doc, {
      startY: y, margin: { left: M, right: M },
      head: [['Paso', 'Qué pasó', 'Esperado', 'Real', 'Causa', 'Acción', 'Liberación']],
      headStyles: { fillColor: [180, 35, 24], fontSize: 7.5, textColor: 255 },
      styles: { fontSize: 7.3, cellPadding: 1.2, textColor: 50 },
      columnStyles: { 0: { cellWidth: 13 }, 2: { cellWidth: 24 }, 3: { cellWidth: 24 } },
      body: ex.desviaciones.map(d => [
        pasoDe(d.paso_id) ? `#${pasoDe(d.paso_id).orden}` : '—',
        d.detalle || '—', d.valor_esperado || '—', d.valor_real || '—',
        d.causa || '—', d.accion || '—',
        d.resuelta_at ? `${fechaHora(d.resuelta_at)} · ${d.resolucion || ''}` : 'Sin liberar',
      ]),
    })
    y = doc.lastAutoTable.finalY + 7
  }

  // ── Pie en todas las páginas ──
  const paginas = doc.internal.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFontSize(7); doc.setTextColor(140)
    doc.text(`Freakie Dogs · Control BPM del chili · tanda ${c.fecha}${c.lote ? ` · lote ${c.lote}` : ''} · documento generado por el ERP`, M, alto - 8)
    doc.text(`${i} de ${paginas}`, dcha, alto - 8, { align: 'right' })
  }

  doc.save(`expediente-chili-${c.fecha}${c.es_revision ? '-revision' : ''}.pdf`)
}
