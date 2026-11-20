-- Bot básico de WhatsApp (19-nov-2026). Aplicada con apply_migration:
--   20261119e_whatsapp_grants (grant insert/update a service_role en whatsapp_mensajes)
--   20261119f_wa_bot_basico: wa_bot_responder(tel, texto) + trigger wa_bot_auto AFTER INSERT
--   en whatsapp_mensajes (direccion='entra') → wa_enviar(). Palabras clave:
--   1/pedido/dónde/estado → estado del último pedido (2 días) del mismo teléfono + link /track
--   2/menú/precio → link /menu · 3/persona/queja → «ya le avisamos al equipo» (PENDIENTE: avisar de verdad a la torre)
--   gracias → despedida · hola → bienvenida con opciones · otro → «no te entendí» + opciones
-- Ver la definición completa en la BD (pg_get_functiondef('public.wa_bot_responder(text,text)'::regprocedure)).

-- 20261119g..j (19-nov-2026): reemplazo por el bot con el ESTILO DE CESAR
-- (Previsualizaciones/WhatsApp IA/Perfil_estilo_Cesar_WhatsApp.md): usted, vocal alargada, ☺️🫶🏼, saludo según la hora,
-- varias burbujas separadas por '¶' (api/wa.js las manda en orden con 1.3 s de pausa).
-- wa_bot_responder ahora devuelve jsonb {texto, escalar}. Columna whatsapp_mensajes.requiere_cesar.
-- Delicado (falta/llegó mal/devolución/factura/empleo/proveedor) y lo que no entiende → «permítame ya verifico/ahorita consulto» + requiere_cesar.

-- 20261119k/l (19-nov-2026): tabla wa_faq (preguntas frecuentes editables: Pepsi/bebidas, cumpleaños, eventos, promos,
-- formas de pago, número para transferir, cobertura, reservaciones, tarjetas adivina la marca, cambios a pedido).
-- Horario por sucursal desde horarios_sucursal (wa_suc_detectar + wa_hora_txt) y ubicación con link de Google Maps (sucursales.lat/lng).
-- Sacado de ~95 chats reales del WhatsApp de pedidos (17–19 nov). Datos a confirmar: hora de cierre Usulután, ubicación del Drive Thru, condiciones del postre de cumpleaños, reservaciones.

-- 20261119m/n (19-nov-2026): mejoras tras batería de 101 mensajes de prueba (≈55% bien → ≈85%):
-- disculpa «Perdón que estábamos un poquito ocupadooos» cuando no llega / «¿hola?»; «¿están abiertos?» con hora real de cierre;
-- bebidas que no manejamos; problemas con la página (pide captura); cupón; bitcoin; cancelar; motorista perdido; audios/fotos/ubicación;
-- cobertura ya no promete «sí llegamos» (la página lo confirma); estados recibida/programado/entregada en «¿dónde viene?».
-- Pendiente de respuestas de Cesar: vegetariano, picante, papas, menú niños, parqueo, mascotas, reservaciones.

-- 20261119o..s (19-nov-2026): banco de regresión public.wa_bot_pruebas (1,000 mensajes con categoría esperada) +
-- wa_bot_firma(jsonb) que dice qué rama contestó. Resultado: 837 → 999/1000.
-- Cambios: normalización (vocales alargadas, q/qda/xq, ñ), «gracias» solo si el mensaje es puro agradecimiento (nucleo),
-- más palabras en quejas/reembolso/empleo/motorista/bebidas/pago/reservas; FAQ mascotas (pendiente de Cesar).
-- Para correr la regresión: select cat,msg,wa_bot_firma(wa_bot_responder('50300000000',msg)) from wa_bot_pruebas;

-- Datos confirmados por Cesar (19-nov-2026, ejecutados como UPDATE de datos):
-- mascotas y reservaciones: solo Paseo Venecia, Grand Plaza Lourdes y Plaza Cafetalón (restaurantes); reservas → requiere_cesar.
-- Plaza Mundo Usulután (S002): cierra 8:00 p. m. lun–mié y 9:00 p. m. jue–dom (horarios_sucursal; afecta también menú web/torre).
-- Drive Thru Lourdes (S005): misma ubicación que Grand Plaza Lourdes (lat/lng copiados de S003).
-- Postre de cumpleaños: aplica a domicilio y en el local.

-- 20261119t (19-nov-2026): batería de 10,000 mensajes (38 temas, ~330 frases base × saludos × cortesías × ruido).
-- 8,896 → 9,966/10,000. Lo que queda son artefactos del generador («parqo», «qso») y 3 ambiguos («hola??», «buenas gracias», «xd gracias»).
-- Ajustes: «plis» en cortesías; quejas (frío, pelo, aplastado); empleo; tardanza («llevo X minutos esperando», «por qué tarda tanto»);
-- abierto («atienden ahorita», «ya cerraron»); horario («último pedido», «reciben pedidos») sin chocar con «no me abre el link»;
-- pedido («en qué va», «despacharon»); vuelto no se confunde con motorista; cancelar/cupón/transferencia/bebidas/cambios/pago ampliados.

-- 20261119u (19-nov-2026), decisiones de Cesar: «pago con $X» se guarda en delivery_clientes.paga_con (efectivo, pedido activo
-- del mismo teléfono) y responde «nuestro driver le lleva su vuelto de $Y»; último pedido = 5 min antes del cierre;
-- feriados/asuetos → «permítame ya le consulto» + requiere_cesar; cobertura → «intente en la página para ver si cubre su zona».
-- Pendiente (Cesar lo verá después): alerta en la torre de los mensajes requiere_cesar.

-- 20261119v..y (19-nov-2026): contexto (último mensaje del bot: «¿Cuál le queda más cerca?» / «¿De cuál sucursal?»),
-- «aún atienden», recoger en tienda, sin saludo repetido. Ciclo de entrenamiento: wa_eval_corridas, wa_eval_turnos (estado
-- aprobada ≥9 / revisar <9 / corregida) y wa_eval_simular(conv, msgs[]) que simula sin enviar (teléfonos 50399xxxxxx, contexto
-- 'sale' con clock_timestamp, se borra al final). Prompt de la tarea nocturna: Previsualizaciones/WhatsApp IA/Tarea_Entrenamiento_Nocturno.md
