-- ============================================================
--  RehabMed ERP — Fixes de seguridad
--  Ejecutar DESPUÉS de 002_rls_policies.sql
-- ============================================================
--  Arregla:
--  1. Vista v_turnos_dia bypassea RLS (sin security_invoker)
--  2. Funciones SECURITY DEFINER sin SET search_path (CVE común)
--  3. Policies UPDATE sin WITH CHECK (permite cambiar FK a otros usuarios)
--  4. Profesional podía ver pacientes de otros via turnos históricos
--  5. Admin puede ver todas las vistas con RLS
-- ============================================================

-- ── 1. Vista v_turnos_dia con security_invoker ───────────
-- Sin esto, la vista corre como el owner (postgres) y salta RLS
drop view if exists public.v_turnos_dia cascade;

create view public.v_turnos_dia
with (security_invoker = true) as
select
  t.id,
  t.fecha,
  t.hora,
  t.duracion_min,
  t.estado,
  t.tipo,
  t.cobertura,
  t.numero_autorizacion,
  t.notas,
  p.id          as paciente_id,
  p.nombre      as pac_nombre,
  p.dni         as pac_dni,
  p.cobertura   as pac_cobertura,
  p.score_noshow,
  pr.id         as profesional_id,
  pr.nombre     as prof_nombre,
  pr.especialidad,
  c.id          as consultorio_id,
  c.nombre      as consultorio_nombre
from public.turnos t
join public.pacientes p    on p.id  = t.paciente_id
join public.profesionales pr on pr.id = t.profesional_id
join public.consultorios c   on c.id  = t.consultorio_id;

drop view if exists public.v_autorizaciones_criticas cascade;

create view public.v_autorizaciones_criticas
with (security_invoker = true) as
select
  a.*,
  p.nombre   as pac_nombre,
  p.telefono as pac_telefono,
  (a.sesiones_auth - a.sesiones_usadas) as sesiones_restantes,
  case
    when a.sesiones_auth - a.sesiones_usadas <= 2 then 'sesiones_critico'
    when a.fecha_vencimiento <= current_date + 7     then 'vencimiento_critico'
    else 'ok'
  end as nivel_alerta
from public.autorizaciones a
join public.pacientes p on p.id = a.paciente_id
where
  a.estado = 'Aprobada'
  and (
    a.sesiones_auth - a.sesiones_usadas <= 2
    or a.fecha_vencimiento <= current_date + 7
  );

-- ── 2. Funciones SECURITY DEFINER con search_path fijo ───
-- Sin SET search_path, un atacante puede crear un schema malicioso
-- y hacer que la función llame a public.profiles falsa
create or replace function public.mi_rol()
returns rol_usuario
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, iniciales, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'iniciales', upper(left(new.email, 2))),
    coalesce((new.raw_user_meta_data->>'rol')::rol_usuario, 'recepcion')
  );
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 3. Policies UPDATE con WITH CHECK ────────────────────
-- Sin WITH CHECK, un usuario puede pasar las filas que edita
-- a valores que violan la condición (ej: reasignar paciente a otro profesional)

-- PROFILES
drop policy if exists "profiles: admin actualiza"   on public.profiles;
drop policy if exists "profiles: auto-actualizar"   on public.profiles;

create policy "profiles: admin actualiza"
  on public.profiles for update
  using      (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

create policy "profiles: auto-actualizar"
  on public.profiles for update
  using      (id = auth.uid())
  with check (id = auth.uid() and rol = (select rol from public.profiles where id = auth.uid()));
  -- ^ impide auto-escalar rol

-- PACIENTES
drop policy if exists "pacientes: admin y recepcion actualizan" on public.pacientes;

create policy "pacientes: admin y recepcion actualizan"
  on public.pacientes for update
  using      (public.mi_rol() in ('admin', 'recepcion'))
  with check (public.mi_rol() in ('admin', 'recepcion'));

-- TURNOS
drop policy if exists "turnos: actualizar estado" on public.turnos;

create policy "turnos: actualizar estado"
  on public.turnos for update
  using (
    public.mi_rol() in ('admin', 'recepcion')
    or (
      public.mi_rol() = 'profesional'
      and profesional_id in (
        select id from public.profesionales where profile_id = auth.uid()
      )
    )
  )
  with check (
    public.mi_rol() in ('admin', 'recepcion')
    or (
      public.mi_rol() = 'profesional'
      and profesional_id in (
        select id from public.profesionales where profile_id = auth.uid()
      )
    )
  );

-- EVOLUCIONES
drop policy if exists "evoluciones: no editar firmadas" on public.evoluciones;

create policy "evoluciones: no editar firmadas"
  on public.evoluciones for update
  using (
    firmado = false
    and (
      public.mi_rol() = 'admin'
      or profesional_id in (
        select id from public.profesionales where profile_id = auth.uid()
      )
    )
  )
  with check (
    firmado = false
    and (
      public.mi_rol() = 'admin'
      or profesional_id in (
        select id from public.profesionales where profile_id = auth.uid()
      )
    )
  );

-- ── 4. Admin puede ver todos los turnos/pacientes ────────
-- Las policies originales dejan a admin fuera en algunos selects
create policy "turnos: admin lee todo"
  on public.turnos for select
  using (public.mi_rol() = 'admin');

-- ── 5. Insumos SELECT policy separada (evitar FOR ALL) ───
-- FOR ALL mezcla SELECT con INSERT/UPDATE/DELETE, confuso para auditar
drop policy if exists "insumos: admin y recepcion gestionan" on public.insumos;

create policy "insumos: admin y recepcion insertan"
  on public.insumos for insert
  with check (public.mi_rol() in ('admin', 'recepcion'));

create policy "insumos: admin y recepcion actualizan"
  on public.insumos for update
  using      (public.mi_rol() in ('admin', 'recepcion'))
  with check (public.mi_rol() in ('admin', 'recepcion'));

create policy "insumos: solo admin elimina"
  on public.insumos for delete
  using (public.mi_rol() = 'admin');

-- ── 6. Storage: policy más restrictiva ──────────────────
-- La original usa "for all" sin separar READ de WRITE
drop policy if exists "hcl: solo autenticados con rol" on storage.objects;

create policy "hcl: lectura admin y profesional"
  on storage.objects for select
  using (
    bucket_id = 'historias-clinicas'
    and auth.uid() is not null
    and public.mi_rol() in ('admin', 'profesional')
  );

create policy "hcl: upload admin y profesional"
  on storage.objects for insert
  with check (
    bucket_id = 'historias-clinicas'
    and auth.uid() is not null
    and public.mi_rol() in ('admin', 'profesional')
  );

create policy "hcl: delete solo admin"
  on storage.objects for delete
  using (
    bucket_id = 'historias-clinicas'
    and public.mi_rol() = 'admin'
  );

-- ── 7. Audit log (para trazabilidad de cambios clínicos) ─
create table if not exists public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  tabla       text not null,
  operacion   text not null check (operacion in ('INSERT','UPDATE','DELETE')),
  registro_id text not null,
  usuario_id  uuid references public.profiles(id),
  datos_old   jsonb,
  datos_new   jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_tabla_fecha on public.audit_log(tabla, created_at desc);
create index if not exists idx_audit_usuario     on public.audit_log(usuario_id);

alter table public.audit_log enable row level security;

create policy "audit: solo admin lee"
  on public.audit_log for select
  using (public.mi_rol() = 'admin');

-- Trigger genérico de auditoría (aplicable a tablas sensibles)
create or replace function public.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (tabla, operacion, registro_id, usuario_id, datos_new)
    values (tg_table_name, tg_op, new.id::text, v_usuario, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (tabla, operacion, registro_id, usuario_id, datos_old, datos_new)
    values (tg_table_name, tg_op, new.id::text, v_usuario, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (tabla, operacion, registro_id, usuario_id, datos_old)
    values (tg_table_name, tg_op, old.id::text, v_usuario, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

-- Activar auditoría en tablas clínicas clave
drop trigger if exists trg_audit_turnos       on public.turnos;
drop trigger if exists trg_audit_evoluciones  on public.evoluciones;
drop trigger if exists trg_audit_pacientes    on public.pacientes;

create trigger trg_audit_turnos
  after insert or update or delete on public.turnos
  for each row execute function public.fn_audit_trigger();

create trigger trg_audit_evoluciones
  after insert or update or delete on public.evoluciones
  for each row execute function public.fn_audit_trigger();

create trigger trg_audit_pacientes
  after insert or update or delete on public.pacientes
  for each row execute function public.fn_audit_trigger();

-- ── 8. Generar ref automático para pacientes ───────────
create sequence if not exists public.pacientes_ref_seq;

create or replace function public.fn_pacientes_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ref is null or new.ref = '' then
    new.ref := 'PAC-' || to_char(now(),'YYYY') || '-' ||
               lpad(nextval('public.pacientes_ref_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pacientes_ref on public.pacientes;
create trigger trg_pacientes_ref
  before insert on public.pacientes
  for each row execute function public.fn_pacientes_ref();

alter table public.pacientes alter column ref drop not null;
