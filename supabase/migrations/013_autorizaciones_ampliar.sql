-- ============================================================
--  RehabMed ERP — Ampliar autorizaciones (P3)
--  Agrega frecuencia, archivo PDF, alertas de vencimiento.
-- ============================================================

-- ============================================================
--  Columnas nuevas
-- ============================================================
alter table public.autorizaciones
  add column if not exists frecuencia_tipo     text check (frecuencia_tipo in ('semanal','mensual','total','sin_limite') or frecuencia_tipo is null),
  add column if not exists frecuencia_cantidad int check (frecuencia_cantidad >= 0),
  add column if not exists fecha_inicio        date,
  add column if not exists descripcion         text,
  add column if not exists archivo_path        text,         -- ruta en bucket 'autorizaciones-docs'
  add column if not exists archivo_nombre      text,
  add column if not exists archivo_mime        text,
  add column if not exists archivo_tamano      bigint,
  add column if not exists profesional_id      uuid references public.profesionales(id) on delete set null,
  add column if not exists notas               text;

comment on column public.autorizaciones.frecuencia_tipo is
  'Cómo se distribuyen las sesiones: semanal (X por semana), mensual (X por mes), total (X totales sin frecuencia), sin_limite';
comment on column public.autorizaciones.frecuencia_cantidad is
  'Cantidad de sesiones por la frecuencia. Ej: 3 si frecuencia_tipo=semanal y son 3 sesiones por semana.';
comment on column public.autorizaciones.fecha_inicio is
  'Cuándo empieza a regir la autorización (puede ser distinta a fecha_solicitud).';

-- ============================================================
--  Bucket de storage para PDFs de autorizaciones
-- ============================================================
insert into storage.buckets (id, name, public)
values ('autorizaciones-docs', 'autorizaciones-docs', false)
on conflict (id) do nothing;

drop policy if exists "auth_docs: lectura autenticados" on storage.objects;
create policy "auth_docs: lectura autenticados"
  on storage.objects for select
  using (
    bucket_id = 'autorizaciones-docs'
    and public.mi_rol() in ('admin','recepcion','profesional')
  );

drop policy if exists "auth_docs: admin recepcion subir" on storage.objects;
create policy "auth_docs: admin recepcion subir"
  on storage.objects for insert
  with check (
    bucket_id = 'autorizaciones-docs'
    and public.mi_rol() in ('admin','recepcion')
  );

drop policy if exists "auth_docs: admin recepcion borrar" on storage.objects;
create policy "auth_docs: admin recepcion borrar"
  on storage.objects for delete
  using (
    bucket_id = 'autorizaciones-docs'
    and public.mi_rol() in ('admin','recepcion')
  );

-- ============================================================
--  VISTA: autorizaciones con datos de alerta
--  - dias_al_vencimiento (negativo si ya venció)
--  - sesiones_restantes
--  - alerta_vencimiento (true si vence en ≤ 10 días o ya venció)
--  - alerta_sesiones (true si quedan ≤ 2 sesiones disponibles)
--  - estado_calculado: 'Activa', 'Por vencer', 'Vencida', 'Sin sesiones', 'Pausada'
-- ============================================================
create or replace view public.v_autorizaciones_full as
select
  a.*,
  p.nombre        as paciente_nombre,
  p.cobertura     as paciente_cobertura,
  p.dni           as paciente_dni,
  pr.nombre       as profesional_nombre,
  -- Días al vencimiento (negativo si ya venció)
  case
    when a.fecha_vencimiento is null then null
    else (a.fecha_vencimiento - current_date)
  end as dias_al_vencimiento,
  -- Sesiones restantes
  greatest(0, a.sesiones_auth - a.sesiones_usadas) as sesiones_restantes,
  -- Alertas
  case
    when a.estado = 'Aprobada'
      and a.fecha_vencimiento is not null
      and a.fecha_vencimiento - current_date <= 10
    then true
    else false
  end as alerta_vencimiento,
  case
    when a.estado = 'Aprobada'
      and (a.sesiones_auth - a.sesiones_usadas) <= 2
    then true
    else false
  end as alerta_sesiones,
  -- Estado calculado para mostrar en UI
  case
    when a.estado = 'Rechazada' then 'Rechazada'
    when a.estado = 'Pendiente' then 'Pendiente'
    when a.estado = 'En revisión' then 'En revisión'
    when a.estado = 'Vencida' then 'Vencida'
    when a.fecha_vencimiento < current_date then 'Vencida'
    when (a.sesiones_auth - a.sesiones_usadas) <= 0 then 'Sin sesiones'
    when a.fecha_vencimiento - current_date <= 10 then 'Por vencer'
    else 'Activa'
  end as estado_calculado
from public.autorizaciones a
left join public.pacientes p on p.id = a.paciente_id
left join public.profesionales pr on pr.id = a.profesional_id;

grant select on public.v_autorizaciones_full to authenticated;

-- ============================================================
--  VISTA: solo las que necesitan alerta (para dashboard)
-- ============================================================
create or replace view public.v_autorizaciones_criticas as
select *
from public.v_autorizaciones_full
where estado in ('Aprobada','Pendiente')
  and (
    estado_calculado in ('Por vencer','Vencida','Sin sesiones')
    or alerta_sesiones = true
  )
order by
  case estado_calculado
    when 'Vencida' then 1
    when 'Sin sesiones' then 2
    when 'Por vencer' then 3
    else 4
  end,
  dias_al_vencimiento asc nulls last;

grant select on public.v_autorizaciones_criticas to authenticated;

-- ============================================================
--  RLS — la tabla autorizaciones ya tiene RLS desde 002, pero
--  agregamos una policy explícita por si hace falta refrescar.
-- ============================================================
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'autorizaciones' and policyname = 'autorizaciones: admin y recepcion gestionan'
  ) then
    create policy "autorizaciones: admin y recepcion gestionan"
      on public.autorizaciones for all
      using (public.mi_rol() in ('admin','recepcion'))
      with check (public.mi_rol() in ('admin','recepcion'));
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'autorizaciones' and policyname = 'autorizaciones: lectura autenticados'
  ) then
    create policy "autorizaciones: lectura autenticados"
      on public.autorizaciones for select
      using (auth.uid() is not null);
  end if;
end $$;

-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Insertar autorización completa de prueba
-- insert into public.autorizaciones (
--   paciente_id, obra_social, prestacion, numero,
--   sesiones_auth, fecha_solicitud, fecha_vencimiento,
--   estado, frecuencia_tipo, frecuencia_cantidad
-- ) values (
--   (select id from public.pacientes limit 1),
--   'OSDE 310', 'Kinesiología post-quirúrgica', 'AUT-2026-001',
--   12, current_date, current_date + 60,
--   'Aprobada', 'semanal', 3
-- );
--
-- -- 2. Ver alertas
-- select numero, paciente_nombre, estado_calculado, dias_al_vencimiento, sesiones_restantes
-- from public.v_autorizaciones_full;
--
-- -- 3. Solo las críticas
-- select * from public.v_autorizaciones_criticas;
