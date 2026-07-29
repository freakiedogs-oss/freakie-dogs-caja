# Aprobación de egresos de caja vía Telegram

> **ESTADO: APAGADO.** Todas las sucursales están en `aprobacion_egresos = 'off'` y no hay
> secretos configurados, así que el bot no puede enviar nada. Nada se enciende sin los
> pasos de abajo. **No encender sin indicación explícita de Jose.**

Portado de `pos-aprobaciones` de Eatalia (proyecto `wzkqaxgsqgbokkmxarbd`), adaptado a egresos.

## Por qué existe

Hoy los egresos se tipean **al cierre** (X/Z), de la libreta: la plata salió de la gaveta
horas antes. Aprobar eso es retroactivo, no es control. Este módulo mueve el registro **al
momento del gasto**: el cajero lo pide → alguien aprueba → recién ahí sale el efectivo.

Volumen real medido (30 días, jun-jul 2026): **697 egresos = 23/día, $28,530**.

## Modelo de decisión

| Cosa | Cómo quedó |
|---|---|
| Quién aprueba | **Siempre el gerente de la sucursal** (por DM privado) |
| Escalamiento | A los **15 min** sin respuesta va al **grupo** (Jose/Cesar/Jazz). El DM del gerente **sigue válido**: gana el primero que decide |
| Expiración | **No expira.** Queda pendiente hasta que alguien decida |
| Auto-aprobación | **Ninguna.** Todo egreso pasa por un humano (decisión de Jose, 29-jul) |
| Bloqueante | Sí, en modo `bloqueante`: el efectivo **no sale** sin aprobación |

Dos huecos reales que el ruteo resuelve solo (`fn_egreso_aprobador` devuelve vacío ⇒ va al grupo):
1. **S006 Metro Centro no tiene gerente** → sus egresos van al grupo.
2. **El gerente pidiendo su propio egreso** (en S004 el gerente opera la caja) → va al grupo.
   Nadie se auto-aprueba.

## Modos por sucursal (`sucursales.aprobacion_egresos`)

- `off` — no pasa nada (estado actual de las 11 sucursales)
- `sombra` — notifica y registra, **pero el efectivo sale igual**. Para calibrar sin frenar la caja
- `bloqueante` — el efectivo espera la aprobación

## Encendido (runbook)

**Nada de esto está hecho todavía.**

### 1. Crear el bot
En @BotFather: `/newbot` → nombre `Freakie Aprobaciones` → guardar el token.

> ⚠️ **Usar un bot NUEVO, no @FreakieDogsMonitor.** El token de ese bot está
> **hardcodeado en texto plano** en 8 archivos versionados de `kako-cakes-erp/Scripts/` y
> `kaeru-chan-erp/Scripts/` — está comprometido y hay que rotarlo aparte. Un bot que
> aprueba salidas de efectivo no puede compartir un token expuesto.

### 2. Crear el grupo de respaldo
Grupo "Aprobaciones Freakie" con Jose, Cesar y Jazz. Agregar el bot. Mandar `/id` para
obtener el `chat_id` (es negativo en grupos).

### 3. Cargar los secretos (nunca en git)
```sql
insert into app_secretos (clave, valor) values
  ('TELEGRAM_EGRESOS_BOT_TOKEN',      '<token de BotFather>'),
  ('TELEGRAM_EGRESOS_CHAT_ID',        '<chat_id del grupo>'),
  ('TELEGRAM_EGRESOS_WEBHOOK_SECRET', '<string aleatorio largo>'),
  ('EGRESOS_ADMIN_SECRET',            '<string aleatorio largo>'),
  ('EGRESOS_REGISTRO_CLAVE',          '<clave para /registrarme>')
on conflict (clave) do update set valor = excluded.valor, updated_at = now();
```

### 4. Registrar el webhook
```bash
curl -X POST "$SUPABASE_URL/functions/v1/egresos-aprobaciones" \
  -H "x-admin-secret: <EGRESOS_ADMIN_SECRET>" -H "Content-Type: application/json" \
  -d '{"action":"set_webhook"}'
```
Verificar con `{"action":"status"}`.

### 5. Vincular a los aprobadores
Cada gerente + Jose/Cesar/Jazz: `/start` al bot y `/registrarme <CLAVE>`.
Eso los deja en `telegram_aprobadores`, pero **sin poder aprobar todavía** — hay que
asignarles rol y usuario:
```sql
-- Gerentes: solo pueden aprobar SU sucursal
update telegram_aprobadores set rol_aprobacion='gerente',
       usuario_id=(select id from usuarios_erp where nombre='Ivette' and rol='gerente'),
       store_code='M001'
 where telegram_id=<id>;

-- Ejecutivos (Jose/Cesar/Jazz): pueden aprobar cualquiera (son el escalamiento)
update telegram_aprobadores set rol_aprobacion='ejecutivo' where telegram_id=<id>;
```

### 6. Probar el circuito sin tocar datos
```bash
curl -X POST "$SUPABASE_URL/functions/v1/egresos-aprobaciones" \
  -H "x-admin-secret: <EGRESOS_ADMIN_SECRET>" -H "Content-Type: application/json" \
  -d '{"action":"test_card"}'
```
Manda una tarjeta de prueba al grupo. Tocar ✅/❌ y verificar que el mensaje se edita.

### 7. Cron de escalamiento
```sql
select cron.schedule('egresos_escalar', '* * * * *', $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/egresos-aprobaciones',
    headers := '{"Content-Type":"application/json","x-admin-secret":"<EGRESOS_ADMIN_SECRET>"}'::jsonb,
    body := '{"action":"escalar"}'::jsonb) $$);
```

### 8. Encender, de a poco
```sql
update sucursales set aprobacion_egresos='sombra' where store_code='S004';  -- Venecia primero
-- 2-3 días observando, y luego:
update sucursales set aprobacion_egresos='bloqueante' where store_code='S004';
```

## Apagado de emergencia

```sql
update sucursales set aprobacion_egresos='off';           -- corta todo al instante
select cron.unschedule('egresos_escalar');                -- detiene el escalamiento
```
El POS deja de pedir aprobación de inmediato (lo consulta en cada egreso). Los pendientes
quedan en la tabla sin bloquear nada.

## Seguridad

- El webhook valida `x-telegram-bot-api-secret-token`; las acciones admin, `x-admin-secret`.
- `app_secretos` y `telegram_aprobadores`: RLS activo y **sin acceso para `anon`** — solo `service_role`.
- `resolver_aprobacion_egreso` es `SECURITY DEFINER` con `revoke` a `anon`/`authenticated`:
  la única vía de resolver es el webhook. El POS **no puede** aprobar.
- `FOR UPDATE` + chequeo de estado ⇒ anti doble-tap y anti carrera entre DM y grupo.
- `crear` exige un **turno abierto** de esa sucursal (regla de negocio y freno al abuso del
  endpoint, que es `anon`).

## Pendiente

- [ ] UI en el POS: pantalla "Solicitar egreso" + modal de espera (aún no hecha)
- [ ] Al cerrar (X/Z): que solo los egresos **aprobados** se descuenten del efectivo
- [ ] Rotar el token de @FreakieDogsMonitor (expuesto en git en kako/kaeru)
