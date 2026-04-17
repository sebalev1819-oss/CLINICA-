# RehabMed ERP

ERP para clínica de rehabilitación — gestión de 12 consultorios, agenda, historia clínica, stock, facturación.

## Stack

- Frontend: HTML + Vanilla JS + Vite (build)
- Backend: Supabase (Postgres + Auth + Realtime + Storage)
- Deploy: Netlify

## Setup local

```bash
# 1. Clonar
git clone https://github.com/sebalev1819-oss/CLINICA-.git
cd CLINICA-

# 2. Instalar
npm install

# 3. Variables de entorno
cp .env.example .env.local
# Editar .env.local con las credenciales de tu proyecto Supabase

# 4. Levantar dev server
npm run dev
# abre http://localhost:5173/RehabMed_ERP_1.html

# 5. Build producción
npm run build
```

## Setup de Supabase

Ejecutar en **SQL Editor** de Supabase en este orden:

1. `supabase/migrations/001_schema.sql` — tablas, enums, triggers
2. `supabase/migrations/002_rls_policies.sql` — Row Level Security
3. `supabase/migrations/003_security_fixes.sql` — **obligatorio**: arregla RLS en vistas, SECURITY DEFINER con `search_path`, policies UPDATE con `WITH CHECK`, audit log
4. `supabase/migrations/004_pacientes_ampliar.sql` — columnas ampliadas de paciente (cobertura detallada, contacto de emergencia, antecedentes médicos, consentimiento informado)
5. `supabase/migrations/005_profiles_email_y_admin.sql` — columna email en profiles + función `admin_actualizar_usuario` (panel admin usuarios)
6. `supabase/migrations/006_erp_administracion.sql` — schema administrativo/contable: obras sociales, tarifas, facturas, pagos, caja, liquidaciones (+ RPCs `facturar_turno`, `generar_liquidacion`, `abrir_caja`, `cerrar_caja`, `saldo_cta_cte_paciente`)

> Alternativa: `SUPABASE_SETUP.sql` (en raíz) ejecuta las primeras 3 migraciones en una sola corrida.
> `000_drop_all.sql` solo si necesitás resetear desde cero — borra todos los datos.

### Crear usuarios iniciales

En **Authentication > Users** de Supabase crear los emails (con password temporal).
El trigger `on_auth_user_created` genera el `profile` automáticamente. Después editar el rol en la tabla `profiles`:

| Email                    | Rol         |
|--------------------------|-------------|
| admin@rehabmed.com       | admin       |
| dra.moreno@rehabmed.com  | profesional |
| recepcion@rehabmed.com   | recepcion   |

## Variables de entorno (Netlify)

En **Site settings > Environment variables**:

- `VITE_SUPABASE_URL` — URL del proyecto Supabase
- `VITE_SUPABASE_ANON_KEY` — anon public key

## Estructura

```
├── RehabMed_ERP_1.html       ← UI (monolito HTML + CSS embebido)
├── index.html                 ← redirige a RehabMed_ERP_1.html
├── src/
│   ├── main.js                ← punto de entrada
│   ├── auth.js                ← login/logout con Supabase
│   ├── agenda.js              ← agenda + Realtime + event delegation
│   └── lib/
│       ├── supabase.js        ← cliente Supabase (usa env vars)
│       └── dom.js             ← escapeHtml, showToast
├── supabase/migrations/
│   ├── 000_drop_all.sql       ← reset (NO ejecutar en prod)
│   ├── 001_schema.sql         ← schema inicial
│   ├── 002_rls_policies.sql   ← RLS base
│   └── 003_security_fixes.sql ← fixes de seguridad + audit log
├── netlify.toml               ← build + redirects + CSP headers
├── vite.config.js
└── package.json
```

## Seguridad — notas importantes

- Nunca commitear `.env` ni `.env.local`.
- La `anon key` es pública (sale al cliente) — la seguridad real vive en RLS (migration 003).
- Storage bucket `historias-clinicas` es **privado** — solo acceso vía signed URLs.
- La tabla `audit_log` registra todos los INSERT/UPDATE/DELETE en `turnos`, `pacientes` y `evoluciones`. Solo admin lee.
