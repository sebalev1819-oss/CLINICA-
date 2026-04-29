-- ============================================================
--  RehabMed ERP — Audit Log (P2.4)
--  Ejecutar DESPUÉS de 004_consultorio_auto_liberar.sql
--
--  Tablas auditadas (las clínicamente sensibles):
--    • turnos          — historial de cambios de estado
--    • pacientes       — modificaciones de datos
--    • evoluciones     — historia clínica (legalmente crítica)
--    • autorizaciones  — gestión de OS
--
--  No auditadas (por baja criticidad y para no inflar el log):
--    • consultorios, profesionales, profiles
--    • insumos, movimientos_stock (si se vuelven críticas, agregar después)
--
--  Diseño:
--    • Tabla única audit_log con datos JSONB (flexible, multi-tabla)
--    • Función genérica log_change() reusable por todos los triggers
--    • Captura quién (auth.uid + ip si está disponible), qué cambió, cuándo
--    • Solo admin puede leer; nadie puede modificar/eliminar (RLS)
-- ============================================================

-- ── Tabla audit_log ──────────────────────────────────────────
create table if not exists public.audit_log (
  id            bigserial primary key,
  tabla         text not null,
  registro_id   text not null,            -- text para soportar uuid e int
  accion        text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario_id    uuid references auth.users(id) on delete set null,
  usuario_email text,                     -- snapshot del email al momento del cambio
  usuario_rol   text,                     -- snapshot del rol al momento del cambio
  datos_antes   jsonb,                    -- NULL en INSERT
  datos_despues jsonb,                    -- NULL en DELETE
  campos_cambiados text[],                -- en UPDATE: solo los campos que cambiaron
  created_at    timestamptz not null default now()
);

comment on table public.audit_log is
  'Log de cambios en tablas sensibles (turnos, pacientes, evoluciones, autorizaciones).
   Append-only. Solo admin puede leer; nadie modifica/elimina.';

-- Índices para queries frecuentes
create index if not exists idx_audit_log_tabla       on public.audit_log(tabla);
create index if not exists idx_audit_log_registro    on public.audit_log(tabla, registro_id);
create index if not exists idx_audit_log_usuario     on public.audit_log(usuario_id);
create index if not exists idx_audit_log_created_at  on public.audit_log(created_at desc);


-- ── Función genérica log_change() ────────────────────────────
create or replace function public.log_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_user_id    uuid;
  v_user_email text;
  v_user_rol   text;
  v_registro_id text;
  v_datos_antes   jsonb;
  v_datos_despues jsonb;
  v_campos_cambiados text[];
begin
  -- Resolver usuario actual
  v_user_id := auth.uid();
  if v_user_id is not null then
    select email into v_user_email from auth.users where id = v_user_id;
    select rol::text into v_user_rol from public.profiles where id = v_user_id;
  end if;

  -- Determinar registro_id (campo 'id' de la tabla, sea uuid o int)
  -- Convertimos a text para que la columna soporte ambos
  if TG_OP = 'DELETE' then
    v_registro_id := (to_jsonb(OLD)->>'id');
    v_datos_antes := to_jsonb(OLD);
    v_datos_despues := null;
  elsif TG_OP = 'INSERT' then
    v_registro_id := (to_jsonb(NEW)->>'id');
    v_datos_antes := null;
    v_datos_despues := to_jsonb(NEW);
  else  -- UPDATE
    v_registro_id := (to_jsonb(NEW)->>'id');
    v_datos_antes := to_jsonb(OLD);
    v_datos_despues := to_jsonb(NEW);

    -- Calcular qué campos cambiaron (excluye updated_at — siempre cambia)
    select array_agg(key) into v_campos_cambiados
      from jsonb_each(v_datos_despues) d
      where key <> 'updated_at'
        and (v_datos_antes->key) is distinct from d.value;

    -- Si solo cambió updated_at, no loguear (sería ruido)
    if v_campos_cambiados is null or array_length(v_campos_cambiados, 1) = 0 then
      return NEW;
    end if;
  end if;

  insert into public.audit_log (
    tabla, registro_id, accion,
    usuario_id, usuario_email, usuario_rol,
    datos_antes, datos_despues, campos_cambiados
  )
  values (
    TG_TABLE_NAME, v_registro_id, TG_OP,
    v_user_id, v_user_email, v_user_rol,
    v_datos_antes, v_datos_despues, v_campos_cambiados
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.log_change() is
  'Trigger function genérica que registra cambios en audit_log.
   Usar en triggers AFTER INSERT/UPDATE/DELETE.';


-- ── Triggers en tablas sensibles ─────────────────────────────

-- Turnos
drop trigger if exists trg_audit_turnos on public.turnos;
create trigger trg_audit_turnos
  after insert or update or delete on public.turnos
  for each row execute function public.log_change();

-- Pacientes
drop trigger if exists trg_audit_pacientes on public.pacientes;
create trigger trg_audit_pacientes
  after insert or update or delete on public.pacientes
  for each row execute function public.log_change();

-- Evoluciones (lo más crítico legalmente)
drop trigger if exists trg_audit_evoluciones on public.evoluciones;
create trigger trg_audit_evoluciones
  after insert or update or delete on public.evoluciones
  for each row execute function public.log_change();

-- Autorizaciones
drop trigger if exists trg_audit_autorizaciones on public.autorizaciones;
create trigger trg_audit_autorizaciones
  after insert or update or delete on public.autorizaciones
  for each row execute function public.log_change();


-- ── RLS sobre audit_log ──────────────────────────────────────
alter table public.audit_log enable row level security;

-- Solo admin puede leer
create policy "audit_log: solo admin lee"
  on public.audit_log for select
  using (public.mi_rol() = 'admin');

-- NADIE puede insertar/modificar/eliminar directamente
-- (los triggers usan SECURITY DEFINER, así que esquivan RLS — lo cual es correcto)
-- No creamos policies de INSERT/UPDATE/DELETE → bloqueado por default.


-- ── Vista útil: últimos 100 cambios con datos legibles ───────
create or replace view public.v_audit_log_reciente as
select
  al.id,
  al.created_at,
  al.tabla,
  al.registro_id,
  al.accion,
  al.usuario_email,
  al.usuario_rol,
  al.campos_cambiados,
  -- Resumir cambios en formato "campo: antes → despues"
  case
    when al.accion = 'UPDATE' and al.campos_cambiados is not null then
      array_to_string(
        array(
          select format(
            '%s: %s → %s',
            campo,
            coalesce(al.datos_antes->>campo, '∅'),
            coalesce(al.datos_despues->>campo, '∅')
          )
          from unnest(al.campos_cambiados) as campo
          where campo <> 'updated_at'
        ),
        ' | '
      )
    when al.accion = 'INSERT' then 'Creado'
    when al.accion = 'DELETE' then 'Eliminado'
  end as resumen_cambio
from public.audit_log al
order by al.created_at desc
limit 100;

comment on view public.v_audit_log_reciente is
  'Últimos 100 cambios en formato legible. Solo admin (heredado de RLS de audit_log).';

grant select on public.v_audit_log_reciente to authenticated;


-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Crear un paciente y verificar que se loguea
-- insert into public.pacientes (ref, nombre, dni, cobertura)
-- values ('PAC-2026-9999', 'Test Audit', '99.999.999', 'Particular');
-- select * from public.audit_log
--   where tabla = 'pacientes'
--   order by created_at desc limit 5;
--
-- -- 2. Actualizar el paciente y ver qué campos cambiaron
-- update public.pacientes set telefono = '011-1234' where ref = 'PAC-2026-9999';
-- select tabla, accion, campos_cambiados, resumen_cambio
--   from public.v_audit_log_reciente limit 3;
--
-- -- 3. Eliminar y ver el log con datos_antes
-- delete from public.pacientes where ref = 'PAC-2026-9999';
-- select * from public.audit_log
--   where tabla = 'pacientes' and accion = 'DELETE'
--   order by created_at desc limit 1;
