-- ============================================================
--  RehabMed ERP — Ampliar columnas de profesionales (P3)
--  Ejecutar DESPUÉS de 010_horarios_profesionales.sql
--
--  Agrega datos de contacto y administrativos al alta de
--  profesionales. Todos los campos nuevos son opcionales para
--  no romper la creación existente.
-- ============================================================

alter table public.profesionales
  add column if not exists email                text,
  add column if not exists telefono             text,
  add column if not exists telefono_secundario  text,
  add column if not exists dni                  text,
  add column if not exists fecha_nacimiento     date,
  add column if not exists genero               text check (genero in ('Masculino','Femenino','Otro','No especifica') or genero is null),
  add column if not exists direccion            text,
  add column if not exists nacionalidad         text default 'Argentina',
  add column if not exists observaciones        text,
  add column if not exists updated_at           timestamptz not null default now();

comment on column public.profesionales.email is 'Email de contacto del profesional (no se usa para login — eso va por profile_id).';
comment on column public.profesionales.dni is 'DNI/CUIL para liquidaciones y documentación.';

-- DNI debe ser único (si se carga)
create unique index if not exists uniq_profesionales_dni
  on public.profesionales (dni)
  where dni is not null;

-- Helper local para updated_at (idempotente)
create or replace function public._fn_prof_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profesionales_updated_at on public.profesionales;
create trigger trg_profesionales_updated_at
  before update on public.profesionales
  for each row execute function public._fn_prof_set_updated_at();

-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Verificar columnas nuevas
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'profesionales'
-- order by ordinal_position;
--
-- -- 2. Insertar profesional con datos completos
-- insert into public.profesionales (
--   nombre, iniciales, especialidad, matricula, tipo,
--   email, telefono, dni, fecha_nacimiento
-- )
-- values (
--   'Dra. Test', 'DT', 'Kinesiología', 'MK-9999', 'Full Time',
--   'test@rehabmed.com', '+54 11 1234-5678', '99.999.999', '1985-06-15'
-- );
--
-- -- 3. Cleanup
-- delete from public.profesionales where matricula = 'MK-9999';
