# Flujo de Sesión de Usuario - ERP Freakie Dogs

**Pregunta**: ¿Cómo se procesa la sesión de usuario cuando ingreso con el PIN al sistema?

---

## 🔄 Ciclo Completo de Sesión

### **Fase 1: Autenticación con PIN (LoginScreen.jsx)**

```
Usuario ingresa PIN (4-6 dígitos)
        ↓
LoginScreen captura cada dígito en state [pin, setPin]
        ↓
Cuando pin.length >= 4:
  - Consulta Supabase:
    db.from('usuarios_erp')
      .select('*')
      .eq('pin', pin)
      .eq('activo', true)
      .maybeSingle()
        ↓
Si encuentra usuario:
  - Llama onLogin(userData) 
        ↓
Si no encuentra o pin=6 dígitos sin match:
  - Muestra "PIN incorrecto"
  - Limpia el PIN
```

**Tabla involucrada**: `usuarios_erp`
- Campos clave: `pin`, `nombre`, `store_code`, `sucursal`, `rol`, `activo`

---

### **Fase 2: Almacenamiento de Sesión (App.jsx)**

```
onLogin(userData) es en realidad setUser()
        ↓
State de React se actualiza:
  const [user, setUser] = useState(null)
        ↓
user = {
  id: "...",
  nombre: "Jose Isart",
  pin: "1000",
  store_code: "M001",
  sucursal: "Cafetalón",
  rol: "ejecutivo",      ← Campo crítico para control de acceso
  activo: true,
  ... otros campos
}
        ↓
Componente App.jsx renderiza:
  - Sidebar (con user como prop)
  - HomeScreen (pantalla de inicio)
  - Toast para notificaciones
```

**Nota**: La sesión se mantiene EN MEMORIA (React state), no en localStorage. Si la pestaña se cierra, se pierde.

---

### **Fase 3: Control de Acceso Basado en Rol (Sidebar.jsx)**

El Sidebar filtra el menú según el rol del usuario:

```
Sidebar carga permisos desde BD:
  
1. Query a tabla permisos_rol:
   db.from('permisos_rol')
     .select('rol, nav_key')
        ↓
   Ejemplo de resultados:
   [
     { rol: "ejecutivo", nav_key: "finanzas-dashboard" },
     { rol: "ejecutivo", nav_key: "gastos" },
     { rol: "bodeguero", nav_key: "recepcion" },
     ...
   ]
        ↓
2. Se crea un mapa: { nav_key: [roles] }
   
   dbPermisos = {
     "finanzas-dashboard": ["ejecutivo", "superadmin"],
     "gastos": ["ejecutivo", "contador", "admin"],
     "recepcion": ["bodeguero", "jefe_casa_matriz", "admin"],
     ...
   }
        ↓
3. Para cada módulo, se ejecuta hasAccess():
   
   hasAccess(item) {
     if (user.rol === 'superadmin') return true
     const roles = dbPermisos[item.key] || item.roles
     if (roles.includes('*')) return true
     return roles.includes(user.rol)
   }
```

**Resultado**: El menú solo muestra módulos que el usuario puede acceder:

```
✅ VISIBLE (ejecutivo):
  - Dashboards → Ejecutivo
  - Finanzas → Dashboard Financiero, Gastos, etc.
  - RRHH → Recursos Humanos, Planilla, etc.

❌ OCULTO (ejecutivo):
  - Almacén → Recepción, Despacho (solo bodeguero/admin)
  - Caja → Cierre de Caja (solo cajero/gerente)
```

---

### **Fase 4: Navegación y Renderizado de Pantallas (App.jsx)**

```
User hace click en módulo del menú
        ↓
handleNavigate(key) → setScreen(key)
        ↓
Sidebar cierra en mobile (si aplica)
        ↓
Switch en renderScreen() determina qué componente renderizar:
  
  case 'finanzas-dashboard':
    return <FinanzasDashboard user={user} onBack={() => setScreen('home')} />
  
  case 'gastos':
    return <FinanzasGastosView user={user} />
  
  case 'rrhh':
    return <RRHHView user={user} />
        ↓
Componente renderizado recibe user como prop:
  - Puede acceder a user.rol, user.store_code, user.nombre
  - Puede hacer lógica específica por rol dentro del componente
  - Puede hacer filtrados adicionales (ej: mostrar solo datos de su sucursal)
```

**Layout durante sesión**:
```
┌─────────────────────────────────────────┐
│  Topbar (móvil): ☰ | Título | Sucursal │
├──────────────────┬──────────────────────┤
│                  │                      │
│   Sidebar        │  Main Content        │
│  (Menú filtrado  │  (Componente actual) │
│   por rol)       │                      │
│                  │                      │
│  User info:      │                      │
│  Avatar + nombre │  Toast notifications │
│  rol · sucursal  │                      │
│                  │                      │
│  [⏻ Logout]      │                      │
└──────────────────┴──────────────────────┘
```

---

### **Fase 5: Logout (App.jsx)**

```
User hace click en botón [⏻] en Sidebar
        ↓
onLogout() executa:
  - setUser(null)
  - setScreen('home')
  - setEditCierre(null)
        ↓
Condición en App.jsx:
  if (!user) return <LoginScreen onLogin={setUser} />
        ↓
Se muestra LoginScreen nuevamente
Usuario puede ingresar con otro PIN
```

---

## 📊 Diagrama de Flujo de Permisos

```
Usuario ingresa PIN
      ↓
      ├─→ Valida en usuarios_erp
      │         ↓
      │    ¿PIN activo existe?
      │      /              \
      │    SÍ               NO
      │    ↓                ↓
      │  user              Error
      │    ↓               ↓
      │    └─→ setUser() ←─┘
      │         ↓
      │    user en state
      │         ↓
      │    Sidebar carga permisos_rol
      │         ↓
      │    dbPermisos = { nav_key: [roles] }
      │         ↓
      │    .filter(item => hasAccess(item))
      │         ↓
      │    Menú filtrado + Componentes con user prop
      │         ↓
      │    User navega por módulos
      │         ↓
      │    [Logout] → setUser(null) → LoginScreen
      ↓
```

---

## 🔑 Campos Clave en `usuarios_erp`

| Campo | Tipo | Uso |
|-------|------|-----|
| `id` | UUID | Identificador único |
| `pin` | TEXT | Autenticación (4-6 dígitos) |
| `nombre` | TEXT | Muestra en UI y HomeScreen |
| `rol` | TEXT | Control de acceso principal |
| `store_code` | TEXT | Filtra datos por sucursal (M001, S001, S003, etc.) |
| `sucursal` | TEXT | Nombre de sucursal |
| `activo` | BOOLEAN | Si es true, permite login; si es false, rechaza |
| Otros | JSONB, etc. | Datos adicionales específicos del rol |

---

## 🛡️ Roles y Permisos (config.js + permisos_rol tabla)

**Roles definidos en config.js** como fallback hardcoded:

```javascript
// Ejemplo: Finanzas Dashboard
{ 
  key: 'finanzas-dashboard', 
  label: 'Dashboard Financiero', 
  icon: '📊', 
  roles: ['ejecutivo', 'superadmin'] 
}
```

**Roles en BD** (`permisos_rol`) pueden sobrescribir:

```
rol: "ejecutivo" → nav_key: "finanzas-dashboard" ✅
rol: "bodeguero" → nav_key: "finanzas-dashboard" ❌
rol: "superadmin" → TODO (línea 31 en Sidebar: if (user.rol === 'superadmin') return true)
```

---

## 💾 Ejemplo Real: Usuario Jose (PIN 1000)

### 1️⃣ Login
```
→ PIN: 1000
→ Supabase: SELECT * FROM usuarios_erp WHERE pin='1000' AND activo=true
← Retorna:
{
  id: "jose-uuid",
  pin: "1000",
  nombre: "Jose Isart",
  rol: "ejecutivo",
  store_code: "M001",
  sucursal: "Cafetalón",
  activo: true,
  ...
}
```

### 2️⃣ Sesión
```
App.jsx: setUser(userData)
→ user state = userData
→ Renderiza Sidebar + HomeScreen
```

### 3️⃣ Acceso a Módulos
```
Sidebar carga permisos_rol:
→ ejecutivo puede ver:
  - Dashboards (ejecutivo, ventas diarias, inventario global)
  - Finanzas (dashboard, gastos, conciliación, rentabilidad, pagos)
  - RRHH (recursos, planilla, recibos, amonestaciones)
  - Supply Chain (conteo, entregas)
  - Marketing
  
→ ejecutivo NO puede ver:
  - Caja (solo cajero/gerente)
  - Almacén (solo bodeguero/jefe casa matriz)
  - Admin Dashboard (solo admin)
```

### 4️⃣ Dentro de Componentes
```
<FinanzasGastosView user={user} />
  ↓
if (user.store_code !== 'M001' && user.rol !== 'admin') {
  // Filtrar gastos de su sucursal solo
}
```

### 5️⃣ Logout
```
→ Click [⏻]
→ setUser(null)
→ App renderiza LoginScreen nuevamente
```

---

## 🚀 Flujo en Tiempo Real

```
T0:00  User: ingresa PIN "1000"
T0:01  LoginScreen: pin="1000", length=4 → query Supabase
T0:02  Supabase: retorna userData
T0:03  LoginScreen: onLogin(userData) → App.setUser(userData)
T0:04  App: user="Jose", rol="ejecutivo" → renderiza Sidebar + HomeScreen
T0:05  Sidebar: carga permisos_rol, filtra menú
T0:06  HomeScreen: muestra "Buenos días, Jose" + "M001 · ejecutivo"
T0:07  User: click en "Gastos"
T0:08  App: setScreen('gastos')
T0:09  App: renderiza <FinanzasGastosView user={user} />
T0:10  FinanzasGastosView: renderiza formulario con acceso a user.store_code
...
T1:00  User: click [⏻]
T1:01  App: handleLogout() → setUser(null)
T1:02  App: renderiza <LoginScreen /> nuevamente
```

---

## 📌 Resumen Técnico

| Aspecto | Implementación |
|---------|-----------------|
| **Almacenamiento de sesión** | React state (`user` en App.jsx) |
| **Persistencia** | En memoria (se pierde al cerrar pestaña) |
| **Autenticación** | PIN en `usuarios_erp`, validado por Supabase |
| **Control de acceso** | Tabla `permisos_rol` + fallback `config.js` |
| **Filtrado de menú** | Sidebar.jsx función `hasAccess()` |
| **Propagación de usuario** | Props en cada componente (`<Component user={user} />`) |
| **Logout** | Limpia state y vuelve a LoginScreen |

---

## 🔐 Seguridad

1. **RLS (Row Level Security)** en Supabase protege datos por rol
2. **Supabase client-side** solo permite queries autorizadas (sin token explícito, usa anon role con RLS)
3. **Permisos en BD** (`permisos_rol`) es la fuente de verdad
4. **Fallback hardcoded** en `config.js` como respaldo si BD no carga
5. **Superadmin** tiene acceso total (línea 31 en Sidebar)
6. **Logout** limpia todo el estado en memoria

---

**Archivo de referencia**: `/Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.md`
