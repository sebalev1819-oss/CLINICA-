# Cambios a aplicar en RehabMed_ERP_1.html

## 1. En el <head> — reemplazar el script de Chart.js con los módulos de Supabase

### ANTES (línea 15):
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
```

### DESPUÉS:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script type="module" src="src/main.js"></script>
```

---

## 2. En el <script> inline — reemplazar el bloque AUTH completo

### ELIMINAR (líneas 2654–2729):
```javascript
const USERS = [ ... ];
const ROLE_PERMISSIONS = { ... };
const ROLE_LABELS = { ... };
let _currentUser = null;
function doLogin(e) { ... }
function doLogout() { ... }
function applyRolePermissions(rol) { ... }
```

### REEMPLAZAR CON:
```javascript
// Auth migrado a src/auth.js
// doLogin y doLogout se importan via src/main.js como globales
```

---

## 3. En el <script> inline — reemplazar AGENDA_DATA

### ELIMINAR:
```javascript
let AGENDA_DATA = [ ... ];   // array hardcodeado con 18 turnos de demo
```

### REEMPLAZAR CON:
```javascript
let AGENDA_DATA = [];   // se carga desde Supabase via src/agenda.js
```

---

## 4. Cambiar las llamadas a filterAgenda y updateTurnoEstado

### ANTES (ejemplo en el HTML):
```javascript
filterAgenda(q)
updateTurnoEstado('Rodrigo Sánchez', 'Confirmado', '✅ Confirmado')
```

### DESPUÉS:
```javascript
window.AgendaMod.filterAgenda(q)
window.AgendaMod.updateTurnoEstado(turnoId, 'Confirmado', '✅ Confirmado')
// Nota: ahora se pasa el UUID del turno, no el nombre del paciente
```

---

## 5. En el formulario de Login — cambiar el label de usuario a email

### ANTES:
```html
<input type="text" id="loginUser" placeholder="Usuario">
```

### DESPUÉS:
```html
<input type="email" id="loginUser" placeholder="tu@email.com" autocomplete="username">
```

---

## 6. Configurar variables de entorno en Netlify

En Netlify > Site settings > Environment variables, agregar:

```
VITE_SUPABASE_URL     = https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON    = tu-anon-key-publica
```

Y en src/lib/supabase.js reemplazar los placeholders:
```javascript
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
```

---

## Orden de ejecución en Supabase SQL Editor

1. Ejecutar `supabase/migrations/001_schema.sql`
2. Ejecutar `supabase/migrations/002_rls_policies.sql`
3. En Supabase > Authentication > Users: crear los usuarios del equipo
4. Asignar roles desde Supabase > Table Editor > profiles

---

## Usuarios a crear en Supabase Auth

| Email                        | Nombre           | Rol         | Iniciales |
|------------------------------|------------------|-------------|-----------|
| admin@rehabmed.com           | Sebastián Levin  | admin       | SL        |
| dra.moreno@rehabmed.com      | Dra. Moreno      | profesional | DM        |
| recepcion@rehabmed.com       | Ana Recepción    | recepcion   | AR        |
| dr.rios@rehabmed.com         | Dr. Ríos         | profesional | DR        |

El trigger `on_auth_user_created` crea el perfil automáticamente al registrar el usuario.
