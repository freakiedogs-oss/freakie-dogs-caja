# Recomendaciones de Seguridad Post-Migración RLS

**Fecha:** 2026-03-27  
**Contexto:** Freakie Dogs ERP usa PINs en `usuarios_erp`, no Supabase Auth

---

## 1. VALIDACIÓN EN EDGE FUNCTIONS (CRÍTICO)

### Problema
La app usa ANON_KEY sin JWT válido. RLS en Supabase NO puede validar sucursal.

### Solución
**Todas las Edge Functions que devuelven datos de tablas OPERATIVAS DEBEN:**

1. Obtener usuario actual por PIN
2. Validar sucursal_id del usuario
3. Filtrar datos ANTES de devolverlos al cliente

### Ejemplo INSEGURO
```javascript
// ❌ INSEGURO - devuelve datos de todas sucursales
export async function GET(req: Request) {
  const supabase = createClient(url, ANON_KEY);
  const { data } = await supabase
    .from('ventas_diarias')
    .select('*');
  return new Response(JSON.stringify(data));
}
```

### Ejemplo SEGURO
```javascript
// ✅ SEGURO - filtra por sucursal del usuario
export async function GET(req: Request) {
  const pin = req.headers.get('x-pin');
  
  // 1. Obtener usuario actual
  const supabaseAdmin = createClient(url, SERVICE_ROLE_KEY);
  const { data: usuario } = await supabaseAdmin
    .from('usuarios_erp')
    .select('sucursal_id, rol')
    .eq('pin', pin)
    .single();
  
  if (!usuario) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // 2. Obtener datos de su sucursal
  const { data } = await supabaseAdmin
    .from('ventas_diarias')
    .select('*')
    .eq('sucursal_id', usuario.sucursal_id);  // ← FILTRO OBLIGATORIO
  
  return new Response(JSON.stringify(data));
}
```

---

## 2. TABLA `usuarios_erp` - MÁXIMA PROTECCIÓN

### Riesgo
Contiene PINs (método de autenticación actual).

### Controles Recomendados

1. **Acceso restringido:**
   - Solo `service_role` (backend)
   - Nunca `anon` o `authenticated`
   - ✓ Ya implementado en migración RLS

2. **Validación en backend:**
   ```javascript
   // Edge Function para login
   export async function validatePIN(pin: string) {
     const supabaseAdmin = createClient(url, SERVICE_ROLE_KEY);
     const { data, error } = await supabaseAdmin
       .from('usuarios_erp')
       .select('id, rol, sucursal_id')
       .eq('pin', pin)
       .single();
     
     if (!data) return null;
     return { userId: data.id, rol: data.rol, sucursal_id: data.sucursal_id };
   }
   ```

3. **Nunca enviar PIN en respuesta:**
   ```javascript
   // ❌ NUNCA hacer esto:
   return { pin, rol, sucursal_id };
   
   // ✅ Hacer esto:
   return { sessionToken, rol, sucursal_id };
   ```

4. **Hash de PIN (futuro):**
   ```sql
   -- Actualizar a bcrypt/argon2
   ALTER TABLE public.usuarios_erp
   ADD COLUMN pin_hash varchar(255);
   
   -- Migrar datos
   UPDATE usuarios_erp SET pin_hash = crypt(pin, gen_salt('bf'));
   
   -- Eliminar PIN en texto
   ALTER TABLE public.usuarios_erp DROP COLUMN pin;
   ```

---

## 3. SESIONES Y TOKENS

### Alternativa 1: JWT Custom (Recomendado)
```javascript
// Backend genera JWT con rol + sucursal
import jwt from 'jsonwebtoken';

function createSessionToken(userId: number, rol: string, sucursal_id: number) {
  const token = jwt.sign(
    { userId, rol, sucursal_id },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  return token;
}

// Cliente guarda token
localStorage.setItem('sessionToken', token);

// Cada request envía token
const headers = {
  'Authorization': `Bearer ${token}`
};
```

### Alternativa 2: Session Cookies (Si hay HTTPS)
```javascript
// Backend crea cookie segura
res.setHeader('Set-Cookie', 
  'sessionId=abc123; HttpOnly; Secure; SameSite=Strict; Path=/'
);
```

### Alternativa 3: Supabase Auth Real (Futuro)
```javascript
// Migrar a email/password o SSO
const { data, error } = await supabase.auth.signInWithPassword({
  email: user@example.com,
  password: password
});

// RLS puede validar con auth.uid()
CREATE POLICY "usuarios_can_view_own" ON public.usuarios_erp
  FOR SELECT
  USING (id = auth.uid());
```

---

## 4. AUDITORÍA Y LOGGING

### Tabla de Auditoría
```sql
CREATE TABLE public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  usuario_id INTEGER NOT NULL REFERENCES usuarios_erp(id),
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  tabla VARCHAR(100) NOT NULL,
  operacion VARCHAR(10) NOT NULL, -- SELECT, INSERT, UPDATE, DELETE
  datos_antes JSONB,
  datos_despues JSONB,
  ip_address INET,
  user_agent TEXT
);

-- RLS: Solo service_role puede escribir
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_insert_only" ON public.audit_log
  FOR INSERT
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
```

### Registrar en Edge Functions
```javascript
async function logAudit(
  usuarioId: number,
  tabla: string,
  operacion: string,
  datosDespues: any
) {
  const supabaseAdmin = createClient(url, SERVICE_ROLE_KEY);
  await supabaseAdmin.from('audit_log').insert({
    usuario_id: usuarioId,
    tabla,
    operacion,
    datos_despues: datosDespues,
    ip_address: req.headers.get('x-forwarded-for'),
    user_agent: req.headers.get('user-agent')
  });
}
```

---

## 5. CAMPOS SENSITIVOS EN TABLAS

### `empleados` tabla
Contiene DUI, salarios, información privada.

**Actual:**
```sql
-- Has políticas mixtas (auth-based)
SELECT dui, salario FROM empleados;  -- ✓ Accesible a rrhh/admin
```

**Recomendación:**
```sql
-- Crear vista para anon (sin DUI/salario)
CREATE VIEW empleados_public AS
  SELECT 
    id, 
    nombre, 
    apellido,
    telefono,
    email,
    sucursal_id
  FROM empleados;

-- App cliente accede solo a vista
SELECT * FROM empleados_public;  -- Sin DUI ni salario

-- RRHH/Admin accede tabla completa (con RLS)
SELECT * FROM empleados;  -- Con DUI y salario
```

### `planillas` tabla
Contiene información salarial.

**Control:**
```sql
-- Solo RRHH/Contador/Admin
CREATE POLICY "planillas_admin_only" ON public.planillas
  FOR ALL
  USING (get_user_rol() = ANY(ARRAY['admin', 'rrhh', 'contador']));
```

---

## 6. INTEGRACIÓN CON COMO OPERACIÓN

### Datos de Caja
Las tablas `egresos_cierre`, `ingresos_cierre`, `ventas_diarias` tienen movimientos de dinero.

**Auditoría obligatoria:**
```javascript
// Cada movimiento debe ser registrado
const { data: venta } = await supabaseAdmin
  .from('ventas_diarias')
  .insert({ monto, sucursal_id })
  .select()
  .single();

// Registrar en auditoría inmediatamente
await logAudit(usuarioId, 'ventas_diarias', 'INSERT', venta);
```

**Conciliación:**
```sql
-- Sumatorias validadas automáticamente
SELECT 
  sucursal_id,
  DATE(fecha) as fecha,
  SUM(monto) as total_ventas
FROM ventas_diarias
GROUP BY sucursal_id, DATE(fecha);
```

---

## 7. CIFRADO EN TRÁNSITO Y EN REPOSO

### SSL/TLS (En tránsito)
```javascript
// Supabase da HTTPS gratis
// App SIEMPRE debe usar https://

// Rechazar HTTP
if (!request.secure && !isLocalhost) {
  return new Response('HTTPS required', { status: 403 });
}
```

### Encriptación en reposo (Supabase)
- ✓ Supabase cifra datos automáticamente en PostgreSQL
- ✓ Backups también están cifrados

### Campos muy sensibles (optional)
```sql
-- Si se requiere, cifrar PIN antes de guardar
UPDATE usuarios_erp 
SET pin = pgp_sym_encrypt(pin, 'secret_key')
WHERE pin IS NOT NULL;
```

---

## 8. RATE LIMITING Y PROTECCIÓN

### Login (PIN validation)
```javascript
// Limitar intentos fallidos
const rateLimiter = new Map();

export async function validatePIN(pin: string, ip: string) {
  const key = `login:${ip}`;
  const attempts = rateLimiter.get(key) || 0;
  
  if (attempts > 5) {
    return { error: 'Too many attempts. Try again in 15 minutes.' };
  }
  
  // Validar PIN...
  if (!valid) {
    rateLimiter.set(key, attempts + 1);
    return { error: 'Invalid PIN' };
  }
  
  // Éxito: limpiar contador
  rateLimiter.delete(key);
  return { sessionToken };
}
```

### Queries a BD
```javascript
// Usar conecciones pooled en Edge Functions
// Ya están optimizadas en Supabase

// Tiempo máximo de query: 10 segundos
const timeout = setTimeout(() => {
  throw new Error('Query timeout');
}, 10000);
```

---

## 9. BACKUP Y DISASTER RECOVERY

### Backup automático
```
✓ Supabase hace backups diarios
✓ Retención: 7 días mínimo
```

### Plan de recuperación
```markdown
1. Si RLS se corrompe:
   - Restaurar backup más reciente
   - Tiempo: 5-10 minutos
   - Datos perdidos: últimas horas

2. Si usuarios_erp es comprometida:
   - Invalidar todos los tokens
   - Forzar reset de PINs
   - Revisar audit_log para access
   - Cambiar SERVICE_ROLE_KEY

3. Si Edge Functions falladas:
   - Rollback a versión anterior
   - Implementar circuit breaker
```

---

## 10. CHECKLIST DE SEGURIDAD CONTINUA

### Mensual
- [ ] Revisar `audit_log` para acceso anómalo
- [ ] Verificar que no hay nuevas políticas "open"
- [ ] Testar rate limiting
- [ ] Revisar logs de Edge Functions

### Trimestral
- [ ] Auditoría de permisos (quién tiene acceso a qué)
- [ ] Revisar políticas RLS
- [ ] Test de recuperación de backups
- [ ] Penetration testing (intentos de bypass)

### Anual
- [ ] Seguridad penetration testing completo
- [ ] Revisión de arquitectura
- [ ] Capacitación de seguridad para team
- [ ] Actualización de dependencias

---

## 11. MIGRACIÓN A SUPABASE AUTH (FUTURO)

Cuando esté lista la migración de PINs a Supabase Auth:

### Beneficios
- RLS basado en `auth.uid()` (más fuerte)
- No guardar PINs en tabla
- MFA opcional
- Session management automático
- OAuth/SSO option

### Pasos
```sql
-- 1. Crear tabla de mapeo
CREATE TABLE public.user_pin_map (
  auth_uid UUID PRIMARY KEY REFERENCES auth.users(id),
  usuarios_erp_id INTEGER NOT NULL REFERENCES usuarios_erp(id)
);

-- 2. Migrar usuarios
INSERT INTO auth.users (...)
  SELECT ...
  FROM usuarios_erp;

-- 3. Actualizar RLS
CREATE POLICY "user_access_own_data" ON public.usuarios_erp
  FOR ALL
  USING (id = (SELECT usuarios_erp_id FROM user_pin_map WHERE auth_uid = auth.uid()));
```

---

## Conclusión

El RLS migrado es un paso fundamental. Pero seguridad es un proceso continuo:

1. **Ya hecho:** RLS por categoría de tabla
2. **Ahora:** Validación en Edge Functions
3. **Pronto:** Auditoría completa y rate limiting
4. **Futuro:** Migración a Supabase Auth

**Responsable:** Jose + equipo backend

---

**VERSIÓN:** 1.0  
**PRÓXIMA REVISIÓN:** 2026-06-27

