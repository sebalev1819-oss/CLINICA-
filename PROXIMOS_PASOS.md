# RehabMed ERP — Próximos pasos

Estado actual: **Código migrado a Supabase Auth + Realtime**. Falta configurar el backend y desplegar.

Aplicar en este orden:

---

## 1. Crear el proyecto en Supabase  ⏱ 5 min

1. Ir a https://supabase.com → "New project"
2. Nombre: `rehabmed-erp` (o como prefieras)
3. Región: `South America (São Paulo)` (la más cercana a Argentina)
4. Anotar el **Database Password** que generes
5. Esperar ~2 min a que el proyecto esté listo

---

## 2. Cargar las credenciales en el código  ⏱ 2 min

1. En Supabase, ir a **Settings → API**
2. Copiar:
   - `Project URL`
   - `anon public` key
3. Abrir `src/lib/supabase.js` y reemplazar:
   ```js
   const SUPABASE_URL  = 'https://TU_PROYECTO.supabase.co';   // ← REEMPLAZAR
   const SUPABASE_ANON = 'TU_ANON_PUBLIC_KEY';                // ← REEMPLAZAR
   ```

> ⚠️ La `anon public` key es PÚBLICA por diseño. La seguridad real está en las RLS policies (`002_rls_policies.sql`). No usar nunca la `service_role` key en el frontend.

---

## 3. Ejecutar las migrations SQL  ⏱ 5 min

En Supabase ir a **SQL Editor** y ejecutar en orden:

1. `supabase/migrations/001_schema.sql` (schema + tablas + triggers + seed de 12 consultorios)
2. `supabase/migrations/002_rls_policies.sql` (RLS policies + vistas + bucket de storage)
3. `supabase/migrations/003_triggers_negocio.sql` (auto-consumo de sesiones + score_noshow)
4. `supabase/migrations/004_consultorio_auto_liberar.sql` (auto-liberación post-limpieza)
5. `supabase/migrations/005_audit_log.sql` (audit log de tablas sensibles)
6. `supabase/migrations/006_validacion_fechas.sql` (rechazo de fechas inválidas en turnos)
7. `supabase/migrations/007_vistas_dashboard.sql` (vistas agregadas para el dashboard)

**Verificación:** En **Table Editor** debe aparecer: `profiles`, `consultorios` (con 12 filas), `pacientes`, `turnos`, `lista_espera`, `autorizaciones`, `evoluciones`, `archivos_clinicos`, `insumos`, `movimientos_stock`.

**Verificar trigger 003:** En SQL Editor:
```sql
select tgname from pg_trigger
where tgrelid = 'public.turnos'::regclass
  and tgname like 'trg_turnos_sync%';
-- Debe devolver 2 filas: trg_turnos_sync_autorizacion, trg_turnos_sync_autorizacion_delete
```

---

## 4. Crear los usuarios del equipo  ⏱ 5 min

En Supabase ir a **Authentication → Users → Add user → Create new user**:

| Email | Password (cambiar al primer login) | Rol |
|---|---|---|
| `admin@rehabmed.com` | (definir) | admin |
| `dra.moreno@rehabmed.com` | (definir) | profesional |
| `recepcion@rehabmed.com` | (definir) | recepcion |
| `dr.rios@rehabmed.com` | (definir) | profesional |

**Importante** — Tildar "Auto Confirm User" para que no pida verificar email.

Después, en **Table Editor → profiles** ajustar el `rol` y `nombre` de cada usuario (el trigger `on_auth_user_created` los crea con rol default `recepcion`).

---

## 5. Probar en local  ⏱ 5 min

Como es ESM puro, **necesitás un servidor estático** (no podés abrir el HTML con `file://` por restricciones CORS de los módulos).

Opción A — VS Code: instalar extensión "Live Server" → click derecho sobre `RehabMed_ERP_1.html` → "Open with Live Server".

Opción B — Python:
```bash
cd "ruta/al/proyecto"
python -m http.server 8000
# abrir http://localhost:8000/RehabMed_ERP_1.html
```

**Smoke test:**
1. ✅ Pantalla de login carga
2. ✅ Login con `admin@rehabmed.com` funciona
3. ✅ El sidebar muestra el avatar/nombre del usuario
4. ✅ Solo aparecen los módulos permitidos por rol
5. ✅ El módulo Agenda carga sin turnos (porque la tabla está vacía)
6. ✅ El indicador "En vivo" en el sidebar queda verde (Realtime conectado)

---

## 6. Deploy a Netlify  ⏱ 10 min

### Opción A — Drag & drop (rápido)

1. Ir a https://app.netlify.com
2. Arrastrar la carpeta del proyecto al área de "Drop"
3. Listo, te asigna una URL temporal

### Opción B — Git (recomendado, deploy automático en cada push)

1. Subir el proyecto a GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: ERP migrado a Supabase Auth + Realtime"
   gh repo create rehabmed-erp --private --source=. --push
   ```
2. En Netlify → "Add new site" → "Import from Git" → seleccionar el repo
3. Build settings: dejar todo vacío (el `netlify.toml` ya configura `publish = "."`)
4. Deploy

**Verificación:** Tu app responde en `https://<sitio>.netlify.app`. Si Supabase rechaza el origen, agregar la URL en **Supabase → Authentication → URL Configuration**.

---

## 7. Configurar dominio personalizado (opcional)

En Netlify → Domain settings → "Add custom domain" → seguir las instrucciones DNS.

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Pantalla en blanco al abrir el HTML | No estás sirviéndolo desde un servidor (file://). Usar Live Server. |
| Login da "Credenciales incorrectas" siempre | El usuario no existe en Supabase Auth, o no se confirmó el email |
| Login pasa pero sale al toque | El usuario no tiene fila en `profiles` (revisar trigger `on_auth_user_created`) |
| Indicador "Reconectando..." amarillo permanente | La URL/Anon key de Supabase están mal, o la tabla `turnos` no tiene Realtime habilitado (Database → Replication → activar) |
| El módulo Agenda dice "Sin turnos" siempre | Es esperado hasta cargar pacientes y crear turnos. Próximo paso: módulo `pacientes.js` (P1.1 del plan). |

---

## Lo que sigue (plan P1)

Una vez que el ERP arranca limpio y se logueás:

1. ✅ **`pacientes.js`** — CRUD + búsqueda + Realtime (HECHO)
2. ✅ **`evoluciones.js`** — historia clínica con firma digital (HECHO)
3. ✅ **`autorizaciones.js`** — gestión de obra social con alertas (HECHO)
4. **`archivos.js`** — upload al bucket `historias-clinicas`
5. **`stock.js`** — insumos
6. **`lista_espera.js`** — gestión + asignación

---

## P1.1 — Módulo Pacientes (HECHO)

**Archivo:** `src/pacientes.js`
**Integrado en:** `src/main.js` (importa y carga al iniciar el ERP)

**Funcionalidades:**
- ✅ Lista pacientes desde Supabase (ordenados por nombre)
- ✅ Búsqueda local por nombre, DNI, ref, cobertura, diagnóstico
- ✅ Crear paciente desde el modal "Nuevo Paciente" (genera ref `PAC-AAAA-NNNN` automáticamente)
- ✅ Editar paciente desde el modal "Nuevo Paciente" (modo edición)
- ✅ Eliminar paciente (admin only — bloqueado por RLS si tiene turnos asociados)
- ✅ Suscripción Realtime (INSERT/UPDATE/DELETE actualizan la UI)
- ✅ Acciones rápidas: WhatsApp (abre wa.me/), Agendar turno
- ✅ Mantiene `window.PACIENTES_DATA` sincronizado para código legacy del HTML

**Limitaciones conocidas (deuda P2):**
- ⚠️ Campos `ses` (sesiones realizadas) y `prox` (próximo turno) están en `0` y `'—'` por defecto. Se mejoran creando la vista SQL `v_pacientes_extended`.
- ⚠️ El modal "Nuevo Paciente" del HTML tiene muchos campos extra (género, dirección, ocupación, alergias, medicación, contacto de emergencia, etc.) que **no están en la tabla `pacientes`** del schema actual. Hoy se ignoran al guardar. Para persistirlos hay que migrar el schema agregando columnas o una tabla `pacientes_extended`.

**Cómo probar (después de hacer los pasos 1-5 de arriba):**
1. Loguearse como `admin@rehabmed.com`
2. Ir al módulo "Pacientes"
3. Ver el mensaje vacío "Sin pacientes registrados"
4. Click en "Nuevo Paciente" → completar Nombre, Apellido, DNI → "Guardar Paciente"
5. ✅ El paciente aparece en la tabla al instante (Realtime)
6. Click sobre el nombre del paciente → abre la ficha HCl con datos
7. Probar búsqueda escribiendo en el input

**Cómo probar Realtime:**
1. Abrir el ERP en dos pestañas (logueado en ambas)
2. Crear/editar un paciente en la pestaña A
3. ✅ La pestaña B se actualiza automáticamente sin refrescar

---

## P1.2 — Módulo Evoluciones (HECHO)

**Archivo:** `src/evoluciones.js`
**UI usada:** `#hcl-evoluciones` + modal `modalNuevaEvolucion` (ya existían en el HTML)

**Funcionalidades:**
- ✅ Listar evoluciones del paciente (ordenadas más reciente primero)
- ✅ Crear evolución desde el modal del HCl (con texto + mejoras + EVA de dolor)
- ✅ El profesional autor se resuelve automáticamente desde `auth.uid()` → `profesionales.profile_id`
- ✅ **Firmar evolución** (irreversible — bloquea ediciones futuras vía RLS)
- ✅ Editar evolución (solo si NO está firmada)
- ✅ Eliminar evolución (solo si NO está firmada)
- ✅ Realtime: cambios visibles al instante en otras sesiones
- ✅ Badge visual: 📝 Sin firmar / 🔏 Firmada con fecha

**Validaciones de seguridad:**
- 🛡 RLS en backend: el profesional solo puede crear evoluciones para sus pacientes
- 🛡 RLS en backend: una evolución firmada NO se puede editar (filtro `firmado=false` en UPDATE)
- 🛡 Doble check en frontend: confirmación antes de firmar

**Limitación conocida:**
- Si el usuario logueado es admin/recepción, NO puede crear evoluciones (no tiene fila en `profesionales`). Esto es correcto desde lo legal/clínico, pero hay que mostrar mensaje claro. ✅ Hecho.

---

## P1.3 — Módulo Autorizaciones (HECHO)

**Archivo:** `src/autorizaciones.js`
**UI agregada al HTML:**
- Nuevo bloque "Autorizaciones de Obra Social" en el panel HCl (debajo del plan de tratamiento)
- Nuevo modal `modalNuevaAutorizacion` con campos: obra social, prestación, número, sesiones autorizadas, vencimiento

**Funcionalidades:**
- ✅ Listar autorizaciones por paciente con barra de progreso `usadas/totales`
- ✅ Crear autorización desde modal (con validaciones de campos obligatorios)
- ✅ Cambiar estado: Pendiente → Aprobada / Rechazada / En revisión / Vencida
- ✅ **Consumir sesión** — botón `+ 1 sesión` que incrementa `sesiones_usadas` (con check `<= sesiones_auth`)
- ✅ Eliminar autorización
- ✅ Alertas visuales:
  - 🚨 Rojo si quedan ≤ 2 sesiones
  - 🚨 Rojo si vence en ≤ 7 días
- ✅ Panel global de alertas críticas (usa la vista `v_autorizaciones_criticas`)
- ✅ Realtime: cambios sincronizados entre sesiones

**Cómo se usa:**
1. Loguearse como `admin` o `recepcion`
2. Abrir la ficha de un paciente (Pacientes → click en el nombre)
3. En el panel HCl, ver el bloque "Autorizaciones de Obra Social"
4. Click "+ Nueva" → completar los campos del modal → "Guardar"
5. Para registrar una sesión usada: click "+ 1 sesión" en la autorización
6. Para aprobar una autorización pendiente: click "✅ Aprobar"

**Próximo paso recomendado (P2):**
~~Crear un trigger SQL que cuando un turno pase a `Finalizado`, busque la autorización aprobada del paciente y haga `consumirSesion` automáticamente.~~ ✅ HECHO en `003_triggers_negocio.sql`.

---

## P2.1 — Auto-consumo de sesiones por trigger SQL (HECHO)

**Archivo:** `supabase/migrations/003_triggers_negocio.sql`

**Qué hace:**
Cuando un turno cambia a estado `Finalizado`, el trigger busca la autorización del paciente y le incrementa `sesiones_usadas` en 1 — **sin que recepción tenga que hacer nada manualmente**.

**Lógica de matching:**
1. Si el turno tiene `numero_autorizacion` → matchear exacto contra `autorizaciones.numero` del paciente
2. Si no, fallback: tomar la primera autorización **Aprobada** del paciente con sesiones disponibles, **priorizando la que vence antes** (consume primero las que están por vencer — mejor desde lo operativo)

**Garantías:**

| Caso | Comportamiento |
|---|---|
| Turno pasa a `Finalizado` | Suma 1 sesión |
| Turno ya estaba `Finalizado` y se actualiza otra cosa | No hace nada (idempotente) |
| Turno `Finalizado` → otro estado | **Resta 1 sesión** (reversible) |
| Turno `Finalizado` se elimina | **Resta 1 sesión** |
| Paciente sin autorización aprobada | Turno se finaliza igual (no bloquea) — solo deja log |
| Autorización ya consumió todo | Turno se finaliza igual — solo deja log (la sesión ya se hizo) |

**Seguridad:**
- 🛡 Funciones marcadas `SECURITY DEFINER` para que esquiven RLS — un profesional que finaliza un turno no tiene permiso RLS sobre `autorizaciones`, pero el trigger sí debe poder
- 🛡 Guard contra carrera: el `UPDATE` incluye `where sesiones_usadas < sesiones_auth`

**Logs de debugging:**
Cada decisión del trigger emite un `RAISE NOTICE`. Para verlos:
- En Supabase: **Logs → Postgres logs** → buscar `[autorizaciones]`
- En psql: visibles en consola

**Cómo testear:**
Hay un bloque de tests comentados al final del SQL. Para activar:
1. Tener al menos 1 paciente, 1 profesional, 1 consultorio, 1 autorización Aprobada con sesiones disponibles
2. Descomentar el bloque `TESTS rápidos`
3. Reemplazar los `<id_del_turno>` y `<paciente_id>` por valores reales
4. Ejecutar paso a paso, verificando que `total_usadas` cambia

**Impacto operativo:**
- ❌ Antes: recepción tenía que tildar manualmente "+ 1 sesión" después de cada turno → olvidos frecuentes → autorizaciones desactualizadas → caja confundida
- ✅ Ahora: profesional cambia el turno a `Finalizado` desde su agenda → sesión se descuenta automáticamente → caja siempre al día

---

## P2.2 — Auto-update de score_noshow (HECHO)

**Archivo:** `supabase/migrations/003_triggers_negocio.sql` (mismo archivo, agregado al final)

**Qué hace:**
Cuando un turno cambia de estado, ajusta automáticamente el `score_noshow` del paciente:

| Transición | Delta al score |
|---|---|
| → `No Show` | **−10** (mala señal) |
| → `Confirmado` | **+2** (asistió) |
| Salir de `No Show` (revierte el castigo) | **+10** |
| Salir de `Confirmado` (revierte el premio) | **−2** |

**Ejemplo de flujo:**
```
Score inicial:           100
Turno → No Show:         90    (-10)
Operador corrige a Confirmado:  92  (+10 reverso, +2 nuevo, clamp a 100 si supera)
```

**Garantías:**
- ✅ Solo se aplica en la **transición** (no en updates de otros campos)
- ✅ **Reversible**: cambiar de estado revierte el delta anterior y aplica el nuevo
- ✅ **Clamp**: el score se mantiene siempre entre 0 y 100 (CHECK constraint de la tabla)
- ✅ Cambios encadenados (`Pendiente → Confirmado → No Show` en una sesión) calculan delta neto

**Para qué sirve:**
- Identificar rápidamente pacientes con riesgo de no asistir → priorizar confirmaciones telefónicas
- Filtrar para campañas de retención o overbooking inteligente
- Indicador visual ya está en la UI: barra verde/ámbar/roja en la lista de pacientes

**Casos no cubiertos (deuda):**
- `Cancelado` con menos de 24h de aviso → debería restar 5 (no implementado)
- `Reprogramado` repetido (más de 2 veces para el mismo turno original) → no penaliza
- Reset gradual: si un paciente con score bajo asiste consecutivamente a 5 turnos, podría volver a 100 más rápido

---

## P2.3 — Auto-liberar consultorio post-limpieza (HECHO)

**Archivos:**
- `supabase/migrations/004_consultorio_auto_liberar.sql` — schema + trigger + función + vista
- `src/main.js` — polling cada 60s
- `src/agenda.js` — limpieza de código redundante

**Flujo completo:**

```
Profesional finaliza turno
  ↓
[trigger SQL]  consultorio.estado='limpieza'
               consultorio.limpieza_hasta = now() + 15 min
  ↓ (15 minutos después)
[main.js polling cada 60s OR pg_cron cada 60s]
  ↓
Función SQL liberar_consultorios_expirados() corre y pone estado='libre'
  ↓
Realtime emite UPDATE → la UI ve el consultorio liberado al instante
```

**Configuración de los minutos de limpieza:**
- Default: 15 minutos
- Para cambiarlo sin redeploy:
  ```sql
  alter database postgres set rehabmed.limpieza_min = '20';
  ```
  (reemplazar `postgres` por el nombre real de la DB si es distinto)

**3 maneras de activar la liberación (cualquiera funciona, podés combinar):**

### A. Polling client-side (default, ya funcionando)
- `main.js` llama a la función SQL cada 60s
- ✅ Funciona en plan free de Supabase
- ❌ Si nadie tiene el ERP abierto, los consultorios quedan en "limpieza" hasta que alguien entre

### B. pg_cron (recomendado en producción)
- Solo disponible en plan Pro de Supabase ($25/mes)
- Activar:
  ```sql
  create extension if not exists pg_cron;
  select cron.schedule(
    'liberar-consultorios-cada-minuto',
    '* * * * *',
    $$select public.liberar_consultorios_expirados();$$
  );
  ```
- ✅ Funciona aunque no haya nadie en el ERP
- ✅ El polling client-side queda como fallback inocuo

### C. Botón manual (admin)
- Cualquier admin puede llamar la función desde un botón:
  ```js
  await supabase.rpc('liberar_consultorios_expirados');
  ```
- Útil como "rescate" si algo se desincronizó

**Vista bonus para UI:**
`v_consultorios_estado` devuelve cada consultorio con `segundos_restantes_limpieza` — perfecto para hacer un countdown visual en el panel de consultorios.

---

## P2.4 — Audit Log (HECHO)

**Archivo:** `supabase/migrations/005_audit_log.sql`

**Tablas auditadas:**
- ✅ `turnos` (cambios de estado, reagenda, cancelaciones)
- ✅ `pacientes` (modificaciones de ficha)
- ✅ `evoluciones` (historia clínica — el más crítico legalmente)
- ✅ `autorizaciones` (gestión de OS)

**No auditadas** (para no inflar el log): consultorios, profesionales, profiles, insumos, movimientos_stock. Si alguna se vuelve crítica, agregar trigger es 1 línea.

**Qué se captura por cada cambio:**

| Campo | Significado |
|---|---|
| `tabla` | "turnos", "pacientes", etc. |
| `registro_id` | El UUID o ID del registro afectado |
| `accion` | INSERT / UPDATE / DELETE |
| `usuario_id` | `auth.uid()` |
| `usuario_email` | Snapshot del email al momento del cambio |
| `usuario_rol` | Snapshot del rol (admin/profesional/recepcion) |
| `datos_antes` | JSONB del registro anterior (NULL en INSERT) |
| `datos_despues` | JSONB del registro nuevo (NULL en DELETE) |
| `campos_cambiados` | Array de los campos que cambiaron (en UPDATE) |
| `created_at` | Timestamp del cambio |

**Optimizaciones:**
- ✅ Si el único campo que cambió es `updated_at`, NO se loguea (sería puro ruido)
- ✅ 4 índices para queries rápidas (por tabla, por registro, por usuario, por fecha)
- ✅ Append-only: nadie puede UPDATE/DELETE en `audit_log` (RLS sin policies de write)
- ✅ Solo admin puede leer

**Vista útil:** `v_audit_log_reciente` muestra los últimos 100 cambios en formato legible:

```sql
SELECT created_at, tabla, accion, usuario_email, resumen_cambio
FROM v_audit_log_reciente;

-- Resultado ejemplo:
-- 2026-04-29 11:42 | turnos      | UPDATE | dra.moreno@... | estado: Confirmado → Finalizado
-- 2026-04-29 11:30 | evoluciones | INSERT | dra.moreno@... | Creado
-- 2026-04-29 11:25 | pacientes   | UPDATE | recepcion@...  | telefono: ∅ → 011-1234
```

**Cumplimiento legal:**
- HCEE / Historia Clínica Electrónica: ARG y MEX requieren trazabilidad de cambios
- LATAM: cumple con principio de no-repudio para responsabilidad del profesional
- Las evoluciones firmadas (P1.2) ya no se pueden modificar; pero **si alguien intenta**, queda registrado el intento

**Limitaciones honestas:**
- No registra IP del cliente (Supabase RLS no la expone fácilmente — se podría capturar via Edge Function si es crítico)
- No tiene retención automática (la tabla crece indefinidamente; en P3 se puede agregar particionado por mes + archive a storage)

---

## P2.5 — Validación de fechas en turnos (HECHO)

**Archivo:** `supabase/migrations/006_validacion_fechas.sql`

**Reglas:**

| Caso | Comportamiento |
|---|---|
| Crear turno con fecha < hoy | ❌ ERROR claro |
| Crear turno con fecha > hoy + 1 año | ❌ ERROR (probable typo) |
| Crear turno para hoy | ✅ OK (incluso si la hora ya pasó — puede ser captura tardía) |
| Editar `estado`/`notas`/etc. de un turno pasado | ✅ OK (fundamental para finalizar turnos de ayer) |
| Mover turno a fecha pasada | ❌ ERROR (cancelar y crear nuevo) |
| Mover turno a fecha > hoy + 1 año | ❌ ERROR |

**Por qué trigger BEFORE en vez de CHECK constraint:**
Un CHECK simple como `fecha >= current_date` rompe en UPDATE de turnos pasados. El trigger BEFORE distingue INSERT de UPDATE y solo restringe cuando la **fecha cambió**.

**Configuración del límite futuro:**
- Default: 365 días (1 año)
- Override sin redeploy:
  ```sql
  alter database postgres set rehabmed.max_dias_futuro_turno = '180';
  -- o reset al default:
  alter database postgres reset rehabmed.max_dias_futuro_turno;
  ```

**Mensajes de error:**
Los `RAISE EXCEPTION` devuelven texto claro al cliente (no códigos crípticos):
- *"No se puede crear un turno con fecha pasada (fecha=2024-01-01, hoy=2026-04-29). Si necesitás cargar histórico, hacelo con una migración admin."*
- *"Fecha del turno demasiado lejana (X > 365 días en el futuro). ¿Es un typo?"*

Estos mensajes ya llegan al frontend a través de `error.message` de Supabase. Si querés UX mejor, en `agenda.js → crearTurno` podés mapear el `errcode = '22023'` a un toast personalizado.

**Bypass para histórico:**
Si necesitás cargar turnos de 2024 (importación inicial, ej.):
1. Como admin, conectarse al SQL Editor
2. `alter table public.turnos disable trigger trg_turnos_validar_fecha;`
3. Insertar histórico
4. `alter table public.turnos enable trigger trg_turnos_validar_fecha;`

(El admin que hace esto queda registrado en `audit_log` por las inserciones — trazabilidad mantenida.)

---

## P3.1 — Dashboard de KPIs (HECHO)

**Archivos:**
- `supabase/migrations/007_vistas_dashboard.sql` — 6 vistas SQL pre-agregadas
- `src/dashboard.js` — carga, render y realtime
- `RehabMed_ERP_1.html` — placeholders "Cargando..." y label "Facturación" → "Sesiones del Mes"

**6 vistas SQL:**

| Vista | Para qué sirve |
|---|---|
| `v_dashboard_stats` | Una fila con todos los KPIs (turnos hoy, mes, pacientes, consultorios, autorizaciones críticas, stock crítico) |
| `v_turnos_por_dia` | 30 días de turnos finalizados / no-show / cancelados / total → chart de tendencia |
| `v_distribucion_coberturas` | % de turnos por OS en el mes → doughnut chart |
| `v_noshow_por_dia` | 7 días con no-show absoluto y % → bar chart |
| `v_ranking_profesionales` | Ranking de turnos finalizados del mes |
| `v_actividad_reciente` | Últimos 10 cambios del audit log con etiquetas amigables (solo admin lo lee) |

**4 KPI cards:**

| # | Card | Reemplazó |
|---|---|---|
| 1 | **Turnos Hoy** (realizados/total) | mock estático |
| 2 | **Sesiones del Mes** | "Facturación Mar" — no se podía calcular sin tabla de pagos |
| 3 | **No-Show Rate del mes** | mock |
| 4 | **Pacientes Activos + Nuevos** | mock |

**3 charts:**
- 📈 **Línea: Turnos · Últimos 30 días** (Total / Finalizados / No-Show) — reemplaza "Facturación vs Cobrado"
- 🍩 **Doughnut: Coberturas del mes** — top 5 + "Otros"
- 📊 **Bar: No-Show Semanal** — barras rojas si > 8%

**Grid de consultorios:**
- 12 cards en tiempo real con estado: libre / ocupado / limpieza / mantenimiento
- Si está en limpieza, muestra **countdown** restante (`⏱ 7:42`) usando `consultorio.limpieza_hasta`

**Alertas dinámicas (panel inferior):**
- Autorizaciones críticas (vencimientos / sin sesiones) — usa `v_autorizaciones_criticas`
- Stock crítico (insumos < mínimo)
- No-show registrados hoy
- Si no hay alertas: "✅ Sin alertas. Todo bajo control."

**Realtime:**
- Suscribe a cambios en `turnos`, `pacientes`, `autorizaciones`, `consultorios`
- **Throttle de 3 segundos** para no recalcular en cascada
- **Solo refresca si el módulo dashboard está visible** (no gasta queries en background)
- Auto-refresh cada 60s adicional (para que el countdown de limpieza se actualice)

**Limitación honesta:**
La card "Sesiones del Mes" reemplaza "Facturación" porque **no existe tabla de pagos/facturas** en el schema. Cuando se construya el módulo de facturación, hay que:
1. Migrar el schema con tabla `facturas` o `pagos`
2. Agregar columnas a `v_dashboard_stats`: `facturado_mes`, `cobrado_mes`, `deuda_total`
3. Actualizar el render del card en `dashboard.js`

**Cómo testear:**
1. Aplicar migration 007
2. Loguearse como admin
3. Ver el módulo Dashboard:
   - Si la DB está vacía: cards en 0, charts vacíos, "✅ Sin alertas"
   - Crear un paciente, una autorización, un turno → ver que los cards y charts se actualizan al instante
   - Finalizar un turno → la sesión se descuenta, el consultorio pasa a limpieza, todo en realtime sin refrescar

**Cómo testear:**
1. Aplicar migration 004
2. Override temporal: `alter database postgres set rehabmed.limpieza_min = '1';`
3. Crear un turno y finalizarlo
4. Verificar: `select * from consultorios where id = X` → `estado='limpieza'`, `limpieza_hasta` ~1 min en el futuro
5. Esperar 1 min + 5s
6. `select liberar_consultorios_expirados();` → devuelve 1
7. Verificar: estado='libre', limpieza_hasta=NULL
8. Reset: `alter database postgres reset rehabmed.limpieza_min;`
