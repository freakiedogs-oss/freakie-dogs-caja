# Telegram Bot — `@kaeru_chan_erp_bot`

## Cómo crear (manual — paso a paso)

1. En Telegram, buscar **@BotFather** y abrir conversación
2. `/newbot`
3. Nombre del bot: **Kaeru Chan ERP Bot**
4. Username: **kaeru_chan_erp_bot** (debe terminar en `_bot`)
5. BotFather responde con un **token** tipo `1234567890:ABCdef-GHIjklMNOpqrSTUvwxYZ_1234`
   → **Copiar este token** y guardarlo en Apps Script → Script Properties como `TELEGRAM_BOT_TOKEN`

## Crear el grupo

1. En Telegram → crear nuevo grupo: **Kaeru Chan — Operación**
2. Agregar miembros: Jose, Luis, Roberto, Florian, Yessica
3. Agregar al grupo el bot **@kaeru_chan_erp_bot**
4. Hacer al bot **admin del grupo** (necesario para enviar mensajes en grupos algunos casos)
5. Obtener el **chat_id**:
   - Opción A: enviar `/start` en el grupo, luego abrir https://api.telegram.org/bot<TOKEN>/getUpdates en navegador → buscar `"chat":{"id":<NUMERO>}` (será negativo, ej. `-1001234567890`)
   - Opción B: agregar `@RawDataBot` al grupo, te muestra el ID, después removerlo
6. **Copiar el chat_id** (incluye el signo negativo) y guardarlo en Apps Script → Script Properties como `TELEGRAM_CHAT_ID`

## Configuración recomendada

En BotFather:
- `/setdescription` → "Bot del ERP Kaeru Chan — alertas operativas, cierres de caja, propinas, planilla, stock"
- `/setabouttext` → "ERP Kaeru Chan automation bot"
- `/setuserpic` → subir el logo de la rana 蛙 verde
- `/setcommands` → pegar:
  ```
  ventas - Ver ventas del día
  cierre - Estado del cierre de caja
  stock - Ingredientes con stock bajo
  propinas - Propinas pendientes de pago
  ```

## Funcionalidad

El bot **NO recibe comandos del usuario** en MVP — solo **envía alertas** disparadas desde Google Apps Script (ver `/Scripts/`).

Si en Fase 5+ queremos comandos interactivos, hay que:
1. Configurar un webhook con `setWebhook` apuntando a una Edge Function de Supabase
2. Esa Edge Function procesa el comando y responde

Por ahora, el bot es **unidireccional**: ERP → grupo.
