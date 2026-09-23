/* ═══════════════════════════════════════════════════════════════════════
   BPM Chili · versión Mauricio · configuración de pantalla por paso

   Sale del anexo FD-CI-DO-013-A01 (Especificación de pantallas · Control
   BPM · Chili v2.0.0, Mauricio Bolaños, 22-sep-2026), sección
   «Configuración por paso». Es el equivalente del chili.v2.ts del anexo:
   cada paso declara su clase de control, su fase, el criterio de
   aceptación que ve el operario, los documentos que aplica y el texto
   del botón. La lógica de captura sigue viviendo en bpm_pasos.controles.

   Se indexa por `bpm_pasos.clave`. Si un paso no está acá, la pantalla
   igual funciona: solo pierde la franja de criterio y la clase.
   ═══════════════════════════════════════════════════════════════════════ */

export const FASES = {
  F0: 'F0 · Preoperacional',
  F1: 'F1 · Preparación',
  F2: 'F2 · Cocción',
  F3: 'F3 · Post-cocción',
  F4: 'F4 · Frío',
}

// Clase de control: PCC sólido, PPRO contorno, PRP/PC claro (anexo, «Marco común»).
export const CLASES = {
  PRP:  { etiqueta: 'PRP',   estilo: 'claro',   nombre: 'Programa prerrequisito' },
  PC:   { etiqueta: 'PC',    estilo: 'claro',   nombre: 'Punto de control' },
  PCC1: { etiqueta: 'PCC-1', estilo: 'solido',  nombre: 'Punto crítico de control 1' },
  PCC2: { etiqueta: 'PCC-2', estilo: 'solido',  nombre: 'Punto crítico de control 2' },
  PPRO: { etiqueta: 'PPRO',  estilo: 'contorno', nombre: 'Programa prerrequisito operativo' },
}

// Documento madre de todos los pasos y los instructivos que aplican.
const DO013 = (paso) => ({ codigo: `DO-013 · paso ${paso}`, largo: `FD-CI-DO-013 · paso ${paso}`, version: 'v02', tipo: 'do', estado: 'vigente' })
const DO003 = { codigo: 'DO-003', largo: 'FD-CI-DO-003 · Control de temperaturas', version: null, tipo: 'do', estado: 'pendiente' }
const DO002 = (n) => ({ codigo: `DO-002-${n}`, largo: `FD-CI-DO-002-${n} · Instructivo de limpieza y sanitización`, version: 'v01', tipo: 'instructivo', estado: 'vigente' })
const VIDEO = (paso) => ({ codigo: `Video V${String(paso).padStart(2, '0')}`, largo: `FD-CI-DO-013-V${String(paso).padStart(2, '0')}`, version: 'v01', tipo: 'video', estado: 'vigente' })

export const PASOS_V2 = {
  calibrar_termometro: {
    paso: 1, clase: 'PRP', fase: 'F0', corto: 'Termómetro',
    titulo: 'Verificar el termómetro del PCC',
    criterio: 'Lectura en baño de hielo de −1 °C a +1 °C · equipo identificado, calibrado e íntegro',
    docs: [DO013(1), DO003, VIDEO(1)], rvp: [],
    boton: 'Registrar: Verificar el termómetro',
    pie: 'Al registrar se habilitan los pasos 2 a 6 (pueden hacerse en paralelo).',
  },
  lavado_desinfeccion_olla: {
    paso: 2, clase: 'PRP', fase: 'F0', corto: 'Olla vegetales',
    titulo: 'Limpiar y sanitizar la olla de vegetales',
    criterio: 'Olla íntegra y limpia · LK-Kleen 5–20 ml/L · Penta Quat 200–400 ppm · contacto ≥ 60 s',
    docs: [DO013(2), DO002(11), VIDEO(2)], rvp: ['RVP-04'], concentraciones: true,
    boton: 'Registrar: Olla de vegetales',
    pie: 'La olla liberada queda disponible para el paso 9.',
  },
  lavado_desinfeccion_olla_carnes: {
    paso: 3, clase: 'PRP', fase: 'F0', corto: 'Olla carnes',
    titulo: 'Limpiar y sanitizar la olla de carnes',
    criterio: 'Olla íntegra y limpia · insumos AZUL de etapa cruda · Penta Quat 200–400 ppm · contacto ≥ 60 s',
    docs: [DO013(3), DO002(11), VIDEO(3)], rvp: ['RVP-04'], concentraciones: true,
    boton: 'Registrar: Olla de carnes',
    pie: 'La olla liberada queda disponible para el paso 8.',
  },
  lavado_desinfeccion_olla_chili: {
    paso: 4, clase: 'PRP', fase: 'F0', corto: 'Olla chili',
    titulo: 'Limpiar y sanitizar la olla del chili',
    criterio: 'Unión fondo-pared sin residuos · Penta Quat 200–400 ppm · contacto ≥ 60 s',
    docs: [DO013(4), DO002(11), VIDEO(4)], rvp: ['RVP-04'], concentraciones: true,
    boton: 'Registrar: Olla del chili',
    pie: 'La olla liberada queda disponible para el paso 10.',
  },
  lavado_desinfeccion_tapa_chili: {
    paso: 5, clase: 'PRP', fase: 'F0', corto: 'Tapa',
    titulo: 'Limpiar y sanitizar la tapa del chili',
    criterio: 'Tapa íntegra por ambas caras · contacto ≥ 60 s · foto de la cara inferior',
    docs: [DO013(5), DO002(11), VIDEO(5)], rvp: ['RVP-04'], concentraciones: true,
    boton: 'Registrar: Tapa del chili',
    pie: 'La tapa liberada queda disponible para el paso 11.',
  },
  desinfeccion_cucharones: {
    paso: 6, clase: 'PRP', fase: 'F0', corto: 'Cucharones',
    titulo: 'Limpiar y sanitizar los cucharones por etapa',
    criterio: 'Cucharones AZUL liberados por código y etapa · sin madera · contacto ≥ 60 s',
    docs: [DO013(6), DO002(18), VIDEO(6)], rvp: ['RVP-04'], concentraciones: true,
    boton: 'Registrar: Cucharones',
    pie: 'Los cucharones liberados quedan disponibles por código en los pasos 8 a 14.',
  },
  pesaje_ingredientes: {
    paso: 7, clase: 'PC', fase: 'F1', corto: 'Pesaje',
    titulo: 'Pesar y registrar ingredientes con lote',
    criterio: '25 de 25 ingredientes dentro de tolerancia · báscula apta · lote o recepción',
    docs: [DO013(7), VIDEO(7)], rvp: [],
    boton: 'Registrar: Pesaje',
    pie: 'El registro se habilita con todos los ingredientes dentro de tolerancia y con lote o recepción.',
  },
  freir_carne: {
    paso: 8, clase: 'PC', fase: 'F2', corto: 'Sellar carne',
    titulo: 'Sellar la carne (3 tandas de 5 lb)',
    criterio: 'Fondo de 180–220 °C antes de cada carga · cucharón AZUL de etapa cruda · grasa drenada',
    docs: [DO013(8), VIDEO(8)], rvp: ['RVP-11'],
    boton: 'Registrar: Sellado de carne',
    pie: 'Una lectura fuera de rango antes de cargar no se acepta como hito: esperá y volvé a medir.',
  },
  sofrito_vegetales: {
    paso: 9, clase: 'PC', fase: 'F2', corto: 'Vegetales',
    titulo: 'Cocinar los vegetales',
    criterio: 'Olla a 135–165 °C · agregados según plan ± 0:30 · corte de 5–8 mm',
    docs: [DO013(9), VIDEO(9)], rvp: ['RVP-11'],
    boton: 'Registrar: Vegetales',
    pie: 'Los tres entran escalonados para que lleguen al punto al mismo tiempo.',
  },
  armar_olla: {
    paso: 10, clase: 'PC', fase: 'F2', corto: 'Integrar',
    titulo: 'Integrar ingredientes en la olla del chili',
    criterio: 'Orden de la fórmula · tostado 45–60 s · lotes heredados del paso 7 · hervor registrado',
    docs: [DO013(10), VIDEO(10)], rvp: ['RVP-11'],
    boton: 'Registrar: Integración',
    pie: 'Cada hito se habilita al cerrar el anterior: el orden de la fórmula importa.',
  },
  tapar_hervor: {
    paso: 11, clase: 'PRP', fase: 'F2', corto: 'Tapa y sonda',
    titulo: 'Tapar la olla e instalar la sonda',
    criterio: 'Tapa liberada · sonda verificada en el punto marcado',
    docs: [DO013(11), VIDEO(11)], rvp: [],
    boton: 'Registrar: Tapa y sonda',
    pie: 'Si no cumple, no continúes y avisá a Calidad: el PCC-1 no se habilita.',
  },
  coccion_80: {
    paso: 12, clase: 'PCC1', fase: 'F2', corto: 'Cocción · PCC-1',
    titulo: 'Cocción a 80 °C con retención',
    criterio: 'Límite crítico: ≥ 80 °C en el punto frío con retención ≥ 15 min',
    docs: [DO013(12), DO003, VIDEO(12)], rvp: ['RVP-01', 'RVP-02'],
    boton: 'Registrar: Cocción · PCC-1',
    pie: 'El cierre se habilita solo con la retención cumplida y la lectura final ≥ 80 °C.',
  },
  coccion_sostenida: {
    paso: 13, clase: 'PC', fase: 'F3', corto: 'Reducción',
    titulo: 'Reducir sin tapa',
    criterio: 'Reducción destapada de 40–60 min · mezcla cada 5 min · rendimiento por varilla',
    docs: [DO013(13), VIDEO(13)], rvp: ['RVP-10', 'RVP-11'],
    boton: 'Registrar: Reducción',
    pie: 'La olla va destapada: tapada, el vapor se condensa y vuelve a caer.',
  },
  reposo_desgrase: {
    paso: 14, clase: 'PRP', fase: 'F3', corto: 'Reposo',
    titulo: 'Reposo, desgrase y retiro de laurel',
    criterio: 'Reposo de 5–10 min · laurel 9 = 9 · producto ≥ 70 °C al terminar',
    docs: [DO013(14), VIDEO(14)], rvp: ['RVP-07', 'RVP-09'],
    boton: 'Registrar: Reposo y desgrase',
    pie: 'Una hoja de laurel faltante retiene el paso y detiene el envasado hasta encontrarla.',
  },
  envasado_vacio: {
    paso: 15, clase: 'PPRO', fase: 'F3', corto: 'Envasado',
    titulo: 'Envasar y sellar al vacío',
    criterio: 'Producto ≥ 70 °C · bolsa de 2,218–2,318 g · sello íntegro · bolsa testigo identificada',
    docs: [DO013(15), VIDEO(15)], rvp: ['RVP-07'],
    boton: 'Registrar: Envasado',
    pie: 'El registro se habilita con las 7 bolsas conformes. La última es la bolsa testigo del PCC-2.',
  },
  choque_termico: {
    paso: 16, clase: 'PCC2', fase: 'F4', corto: 'Enfriamiento · PCC-2',
    titulo: 'Enfriamiento en hielo y agua',
    criterio: 'Límite crítico: 57 → 21 °C en ≤ 2 h · ≤ 5 °C en ≤ 6 h',
    docs: [DO013(16), DO003, VIDEO(16)], rvp: ['RVP-06'],
    boton: 'Registrar: Enfriamiento · PCC-2',
    pie: 'La medición de los 30 min solo vale dentro de su ventana. Antes no demuestra nada.',
  },
  congelado: {
    paso: 17, clase: 'PPRO', fase: 'F4', corto: 'Almacenar',
    titulo: 'Almacenar congelado',
    criterio: 'Producto ≤ 5 °C al ingresar · freezer ≤ −18 °C · etiqueta completa',
    docs: [DO013(17), DO003, VIDEO(17)], rvp: ['RVP-08'],
    boton: 'Registrar: Almacenamiento',
    pie: 'Guardar no es liberar. Solo Calidad libera, con todas las desviaciones cerradas.',
  },
}

export const uiDePaso = (paso) => (paso && PASOS_V2[paso.clave]) || null
