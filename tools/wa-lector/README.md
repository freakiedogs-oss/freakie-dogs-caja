# wa-lector — WhatsApp → resumen diario con AI local

Lee WhatsApp Web en la Mac mini, guarda los mensajes en una base local y usa un modelo
local (Ollama) para sacar lo que hay que tener registrado: reuniones, decisiones, cambios,
pagos, pendientes y problemas, por empresa.

**Solo lee.** No manda mensajes, no marca como leído, no descarga fotos ni audios.
**Nada sale de la máquina:** conversaciones, sesión y reportes quedan en `datos/` (fuera del repo).
No usa créditos de Claude ni escribe en Supabase.

## Instalar (una vez, en la mini)

Requiere Node 22.5 o más nuevo, Google Chrome y Ollama.

```bash
cd tools/wa-lector
npm install
ollama pull qwen3:8b
cp config.ejemplo.json config.json
```

## Usar

```bash
npm run leer        # abre Chrome con WhatsApp Web; la primera vez pide escanear el código QR
npm run chats       # lista los chats leídos, para llenar config.json
npm run extraer     # pasa los días cerrados por el modelo local (--hoy para incluir hoy)
npm run reporte     # resumen de ayer por empresa (--hoy, --dia AAAA-MM-DD)
```

`npm run leer` se deja corriendo: escucha en vivo y repasa todos los chats cada hora.
Con `npm run leer:una-vez` hace una pasada y se cierra.

## config.json

- `empresas`: lista de empresas entre las que el modelo clasifica.
- `chats`: por nombre exacto del chat, `{ "empresa": "Kaeru" }` para fijar la empresa o
  `{ "ignorar": true }` para que no se lea ni se procese (familia, chats personales).
- `mensajesPorChat`: cuántos mensajes hacia atrás se piden por chat en cada pasada (300).
- `modelo`: modelo de Ollama (`qwen3:8b`).

## Archivos

- `datos/wa.sqlite` — tablas `chats`, `mensajes`, `lotes` (chat+día ya procesado) e `items`.
- `datos/sesion/` — sesión de WhatsApp Web. Quien tenga esta carpeta tiene acceso a la cuenta.
- `datos/reportes/AAAA-MM-DD.md` — resumen diario.

## Límites conocidos

- Usa `whatsapp-web.js`, que maneja un Chrome real con WhatsApp Web. No es una vía oficial
  de Meta: es de bajo riesgo porque solo lee, pero el riesgo de bloqueo de la cuenta no es cero.
- Audios, fotos y documentos no se leen; quedan anotados solo como «(ptt)», «(image)», etc.
- Si WhatsApp cierra la sesión hay que volver a escanear el código.
- Los items son lo que el modelo entendió: revisarlos antes de darlos por ciertos.
