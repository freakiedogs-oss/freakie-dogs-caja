# PLAN — Mac mini M4 como servidor AI 24/7 ("Freakie HQ")

> Fecha: 2026-07-02. Hardware: **Mac mini M4, 16 GB RAM, 512 GB SSD**, ubicado en El Salvador.
> Suscripción: Claude **Max**. Canal remoto elegido: **Telegram bot**.
> Antecedentes: `PLAN_FREAKIE_AI.md` §1a descartó self-hosting porque era en la *laptop* de Jose (frágil, viaja). Un mini 24/7 dedicado cambia esa ecuación. Además resuelve el pendiente crítico de `PROXY_DGII_PY_NOTAS.md`.

---

## OBJETIVOS

1. **Claude siempre disponible**: Claude Code corriendo en el mini, controlable desde el celular vía Telegram.
2. **Modelos locales 24/7** (Ollama): motor privado + fallback del `ai-gateway` multi-ERP (hoy limitado por Groq free 12k TPM).
3. **proxy_dgii.py con hogar permanente** — IP salvadoreña fija, resuelve el bloqueador DGII para el go-live POS.
4. **Agentes y orquestadores automáticos** (launchd): briefings, healthchecks, auditorías.
5. **Todos los proyectos** (Freakie, Kako, Kaeru, Eatalia, dte-service, la-llave) clonados y sincronizados vía git.

---

## F0 — Base del servidor (una tarde)

- Usuario dedicado `freakie-server`, auto-login activado, FileVault OFF (para que arranque solo tras corte de luz).
- Energía y reinicio automático:
  ```bash
  sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1
  ```
- **UPS pequeño (~$60, único gasto)** — los cortes de luz en ES son el riesgo #1.
- Instalar: Homebrew, git, node, python3, tmux, cloudflared, tailscale, ollama.
- Backup: repos ya viven en GitHub; Time Machine a disco externo opcional para configs.

## F1 — Acceso remoto (mismo día)

- **Tailscale** en mini + celular + laptop → red privada cifrada, IP estable (100.x), **sin abrir puertos en el router**. Gratis.
- Activar Remote Login (SSH) y Screen Sharing (emergencias con pantalla).
- Desde el celular: app Termius + Tailscale = terminal completo; `tmux` mantiene sesiones vivas aunque se corte la conexión.

## F2 — Claude 24/7 + Telegram bot (semana 1)

- Claude Code instalado en el mini, login con tu cuenta Max.
- **Bot de Telegram** (servicio Node bajo launchd, `KeepAlive`):
  - Whitelist dura de `chat_id` (solo Jose, opcional Cesar). Cualquier otro → ignorado.
  - Mensaje → ejecuta `claude -p "<mensaje>"` en el directorio del proyecto → responde al chat. `--resume` para mantener conversación.
  - Comandos: `/erp <pregunta>`, `/status` (salud de servicios), `/logs`, `/dte` (backlog check), `/proxy` (estado tunnel DGII).
  - Acciones destructivas (push, deploy, SQL de escritura) requieren confirmación explícita "SI" en el chat.
  - Token del bot en variable de entorno del servicio, nunca en repo. Log completo de cada interacción.
- Resultado: escribís al bot desde el celular y Claude resuelve el problema **en el servidor, con acceso real a los proyectos y la BD**.

## F3 — proxy_dgii.py permanente (semana 1 — PRIORIDAD, cierra bloqueador DGII)

- Mover `proxy_dgii.py` al mini como servicio launchd con `KeepAlive` (se relevanta solo si muere).
- **cloudflared named tunnel** (gratis, URL fija que sobrevive reinicios) → actualizar `DGII_PROXY_URL` en Supabase **una sola vez**, nunca más URLs efímeras de ngrok.
- Healthcheck cada 30 min (cron): curl al tunnel → si falla, alerta por Telegram. Ya nadie descubre el proxy caído "cuando un cobro falle".
- Completar de paso el cuestionario pendiente de `PROXY_DGii_PY_NOTAS.md`.

## F4 — Modelos locales con Ollama (semana 2)

- **Presupuesto de RAM (16 GB)**: macOS + servicios ~5 GB · modelo 8B Q4 ~6 GB · margen ~5 GB. Un 14B Q4 (~9-10 GB) es posible pero justo — probar; 8B es la base segura.
- Modelos:
  - `qwen3:8b` — primario (razonamiento/SQL, buen español).
  - `llama3.2:3b` o `qwen3:4b` — tareas rápidas (clasificación, redacción de alertas).
- Ollama expone API OpenAI-compatible (`:11434`):
  - Vía **tailnet**: tu laptop/celular la usan directo, privado.
  - Vía **cloudflared tunnel con token**: el `ai-gateway` (Edge Function) gana un eslabón nuevo en la cascada → Groq → Cerebras → **mini local (sin límite TPM, $0, privado)**.
- **Ventaja privacidad**: preguntas que toquen PII/planilla pueden rutearse SOLO al modelo local — nunca salen de tu casa (mitiga el riesgo "free tiers entrenan con tus datos" de PLAN_FREAKIE_AI §1b).

## F5 — Agentes y orquestación automática (semanas 2-3)

Todo con launchd (nativo, sobrevive reinicios):

| Horario | Agente | Qué hace |
|---|---|---|
| 7:00 AM diario | Briefing | Ventas ayer vs comparable, sucursales desviadas, backlog DTE → mensaje Telegram (alineado con F3 de PLAN_FREAKIE_AI) |
| Cada 30 min | Watchdog | proxy DGII, tunnel, ai-gateway, pool de conexiones Supabase (lección incidente 8-jun) → alerta si algo cae |
| Diario 6:00 AM | Git sync | `git pull` de todos los repos — el mini siempre al día |
| Semanal | Auditorías | Las 4 auditorías de mejora continua (hoy scheduled tasks en Cowork) migrables al mini con más control y contexto local |

- **Orquestador simple**: tabla `agent_jobs` en Supabase como cola — el bot de Telegram o cualquier ERP encola trabajos, un runner en el mini los ejecuta (Claude Code headless o heurística local según el caso). Heurística primero, LLM solo para cola larga (Regla 13 de la casa).

## F6 — Capturas de transferencias iPhone → BD (matching bancario)

**Objetivo**: cada captura de transferencia que Jose toma en el iPhone llega sola al mini, se lee, se inserta en BD y se matchea con el movimiento bancario → el banco gana el **concepto** que el estado de cuenta BAC no trae.

Flujo zero-touch recomendado (iCloud):
1. Tomás la captura al hacer la transferencia (como ya hacés). Cero pasos extra.
2. **iCloud Photos** la sincroniza sola al mini (mismo Apple ID, "Optimizar almacenamiento" ON — no llena el SSD).
3. Watcher launchd cada 5 min (`osxphotos`): detecta screenshots nuevos y descarga solo esos.
4. **OCR local con Apple Vision** (nativo macOS, $0, offline, excelente con apps bancarias). Filtro por keywords (BAC, transferencia, comprobante, referencia, $): solo lo que parece comprobante se procesa; el resto de tus fotos **jamás sale del mini**.
5. Parser extrae: banco, monto, fecha, referencia, cuenta destino, nombre, concepto → INSERT en tabla nueva `banco_capturas` + imagen (WebP comprimida) a Supabase Storage.
6. **Matching** contra `bank_estados_cuenta`/`bank_transacciones`: referencia exacta → fallback monto + fecha ±2 días. El concepto enriquece la Revisión bancaria (Fase 2 banco pendiente) y cruza con `cuentas_bancarias_terceros` (TEF → entidad → categoría).
7. Sin match → estado `pendiente` visible en Revisión; resumen por Telegram.

**Plan B manual ($0, disponible desde F2)**: reenviar la captura al bot de Telegram → mismo OCR + insert. Útil para comprobantes que te llegan por WhatsApp (no son screenshots tuyos).

Tabla `banco_capturas`: `id, storage_path, ocr_texto, banco, monto, fecha_transfer, referencia, cuenta_destino, nombre_destino, concepto, match_bank_tx_id, estado (pendiente|matcheada|descartada), created_at`. GRANT anon SELECT + authenticated ALL + política RLS de escritura (regla de la casa).

Si Apple Vision deja campos ambiguos: segundo pase con `qwen2.5vl:7b` local (F4). Nunca API paga, nunca la imagen sale a un tercero.

## Proyectos en el mini

```
~/Proyectos/
  freakie-dogs-caja/     ← repo GitHub (fuente de verdad)
  contexto-maestro/      ← esta carpeta (git o sync periódico)
  kako/  kaeru/  eatalia/
  dte-service/
  la-llave/
  server/                ← bot telegram, watchdogs, launchd plists, proxy_dgii.py
```

Git manda: el mini hace pull automático, nunca es la única copia de nada.

---

## COSTOS Y GASTOS FUTUROS (análisis honesto)

**Hoy:**
- UPS **~$60 una vez** (único gasto de arranque).
- Software **$0/mes**: Tailscale free (hasta 3 usuarios), Ollama, launchd, Telegram, Apple Vision OCR. Claude Max ya lo pagás.
- **Electricidad**: M4 24/7 consume 4-10W idle → **~$2-3/mes**. Es el único recurrente nuevo garantizado.

**Posibles gastos futuros (y cómo evitarlos):**

| Ítem | Cuándo aparecería | Monto | Mitigación $0 |
|---|---|---|---|
| Dominio para cloudflared named tunnel | F3: named tunnel exige dominio propio en Cloudflare | ~$10/año | **Tailscale Funnel** (URL fija `*.ts.net`, $0, sin dominio) — usar esto si no hay dominio libre |
| iCloud+ | F6: si tu fototeca supera los 5 GB gratis (casi seguro ya lo pagás hoy) | $0.99-2.99/mes | Si ya pagás iCloud, costo cero adicional; alternativa: reenviar al bot Telegram |
| Free tiers LLM cambian (Groq/Cerebras) | Riesgo ya documentado en PLAN_FREAKIE_AI §1b | ? | F4 es justamente el seguro: Ollama local sin costo ni límite |
| Claude Max se queda corto | Si los agentes F5 se vuelven muy intensivos | Upgrade Max 20x | Regla 13: heurística local $0 primero; Claude solo para cola larga |
| VPS con GPU | Solo si 16 GB quedan cortos Y se exige más modelo local | $20-40/mes | Decidir con datos de uso reales, no hoy |
| Supabase Storage (capturas F6) | Miles de capturas acumuladas | Centavos/mes | Comprimir a WebP (~100 KB c/u) antes de subir |

**Conclusión**: nada del plan crea un gasto recurrente obligatorio nuevo salvo ~$2-3/mes de luz. Todo lo demás tiene vía $0 documentada.

## RIESGOS

| Riesgo | Mitigación |
|---|---|
| Corte de luz / internet | UPS + `autorestart 1` + watchdog con alerta Telegram (te enterás en ≤30 min) |
| Bot Telegram = puerta al servidor | Whitelist `chat_id`, confirmación para acciones destructivas, log inmutable, token fuera del repo |
| 16 GB cortos para modelos grandes | Base 8B; el híbrido heurística+free-tier ya cubre el 80% — el local es refuerzo, no cuello de botella. Techo futuro: mini de más RAM o Studio |
| SSD 512 GB | Modelos ~15-20 GB + proyectos ~5 GB → sobra. Vigilar logs con rotación |
| Límites Claude Max con agentes intensivos | Agentes frugales: heurística local $0 primero, Claude solo cuando aporta (Regla 13) |
| IP residencial cambia | Irrelevante: Tailscale y cloudflared no dependen de IP pública fija |

## ORDEN DE EJECUCIÓN

1. **F0 + F1** (una tarde) → mini accesible remoto.
2. **F3 proxy DGII** (crítico, cierra bloqueador go-live POS).
3. **F2 Telegram bot** → Claude desde el celular.
4. **F4 Ollama** → modelos locales + fallback gateway.
5. **F5 agentes** → briefings y watchdogs automáticos.
