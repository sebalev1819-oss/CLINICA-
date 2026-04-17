-- ============================================================
--  RehabMed ERP — SETUP COMPLETO (una sola ejecución)
--  Pega todo este archivo en Supabase SQL Editor → Run
-- ============================================================

-- ════════ PARTE 1 — LIMPIEZA ═══════════════════════════════
drop trigger if exists on_auth_user_created          on auth.users;
drop trigger if exists trg_profiles_updated_at       on public.profiles;
drop trigger if exists trg_consultorios_updated_at   on public.consultorios;
drop trigger if exists trg_pacientes_updated_at      on public.pacientes;
drop trigger if exists trg_turnos_updated_at         on public.turnos;
drop trigger if exists trg_autorizaciones_updated_at on public.autorizaciones;
drop trigger if exists trg_insumos_updated_at        on public.insumos;
drop trigger if exists trg_audit_turnos              on public.turnos;
drop trigger if exists trg_audit_evoluciones         on public.evoluciones;
drop trigger if exists trg_audit_pacientes           on public.pacientes;
drop trigger if exists trg_pacientes_ref             on public.pacientes;

drop function if exists public.fn_audit_trigger()  cascade;
drop function if exists public.fn_pacientes_ref()  cascade;
drop function if exists public.handle_new_user()   cascade;
drop function if exists public.set_updated_at()    cascade;
drop function if exists public.mi_rol()            cascade;

drop policy if exists "hcl: lectura admin y profesional" on storage.objects;
drop policy if exists "hcl: upload admin y profesional"  on storage.objects;
drop policy if exists "hcl: delete solo admin"           on storage.objects;
drop policy if exists "hcl: solo autenticados con rol"   on storage.objects;

drop view if exists public.v_turnos_dia              cascade;
drop view if exists public.v_autorizaciones_criticas cascade;

drop table if exists public.audit_log           cascade;
drop table if exists public.movimientos_stock   cascade;
drop table if exists public.insumos             cascade;
drop table if exists public.archivos_clinicos   cascade;
drop table if exists public.evoluciones         cascade;
drop table if exists public.autorizaciones      cascade;
drop table if exists public.lista_espera        cascade;
drop table if exists public.turnos              cascade;
drop table if exists public.pacientes           cascade;
drop table if exists public.profesionales       cascade;
drop table if exists public.consultorios        cascade;
drop table if exists public.profiles            cascade;

drop sequence if exists public.pacientes_ref_seq cascade;

drop type if exists public.estado_autorizacion  cascade;
drop type if exists public.estado_paciente      cascade;
drop type if exists public.tipo_profesional     cascade;
drop type if exists public.tipo_turno           cascade;
drop type if exists public.estado_consultorio   cascade;
drop type if exists public.estado_turno         cascade;
drop type if exists public.rol_usuario          cascade;

-- ════════ PARTE 2 — SCHEMA ═════════════════════════════════
create extension if not exists "uuid-ossp";
create extension if not exists "btree_gist";

create type rol_usuario       as enum ('admin', 'profesional', 'recepcion');
create type estado_turno      as enum ('Pendiente', 'Confirmado', 'En curso', 'Finalizado', 'No Show', 'Cancelado', 'Reprogramado', 'Lista espera');
create type estado_consultorio as enum ('libre', 'ocupado', 'limpieza', 'mantenimiento');
create type tipo_turno        as enum ('Presencial', 'Virtual');
create type tipo_profesional  as enum ('Full Time', 'Part Time', 'Freelance');
create type estado_paciente   as enum ('Activo', 'Inactivo', 'Nuevo', 'Alta');
create type estado_autorizacion as enum ('Pendiente', 'Aprobada', 'Rechazada', 'En revisión', 'Vencida');

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  iniciales  text not null,
  rol        rol_usuario not null default 'recepcion',
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consultorios (
  id             serial primary key,
  nombre         text not null,
  especialidad   text not null,
  estado         estado_consultorio not null default 'libre',
  profesional_id uuid,
  updated_at     timestamptz not null default now()
);

create table public.profesionales (
  id             uuid primary key default uuid_generate_v4(),
  profile_id     uuid references public.profiles(id) on delete set null,
  nombre         text not null,
  iniciales      text not null,
  especialidad   text not null,
  matricula      text not null,
  tipo           tipo_profesional not null default 'Full Time',
  consultorio_id int references public.consultorios(id) on delete set null,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.consultorios
  add constraint fk_consultorios_profesional
  foreign key (profesional_id) references public.profesionales(id) on delete set null;

create table public.pacientes (
  id               uuid primary key default uuid_generate_v4(),
  ref              text unique,
  nombre           text not null,
  dni              text not null,
  telefono         text,
  email            text,
  fecha_nacimiento date,
  cobertura        text not null default 'Particular',
  numero_afiliado  text,
  diagnostico      text,
  estado           estado_paciente not null default 'Nuevo',
  score_noshow     int not null default 100 check (score_noshow between 0 and 100),
  deuda            numeric(12,2) not null default 0,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_pacientes_dni    on public.pacientes(dni);
create index idx_pacientes_nombre on public.pacientes using gin (to_tsvector('spanish', nombre));

create table public.turnos (
  id                  uuid primary key default uuid_generate_v4(),
  fecha               date not null,
  hora                time not null,
  duracion_min        int not null default 45 check (duracion_min > 0 and duracion_min <= 480),
  paciente_id         uuid not null references public.pacientes(id) on delete restrict,
  profesional_id      uuid not null references public.profesionales(id) on delete restrict,
  consultorio_id      int  not null references public.consultorios(id) on delete restrict,
  especialidad        text not null,
  tipo                tipo_turno   not null default 'Presencial',
  estado              estado_turno not null default 'Pendiente',
  cobertura           text,
  numero_autorizacion text,
  notas               text,
  created_by          uuid references public.profiles(id),
  updated_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.turnos
  add constraint no_solapamiento_consultorio
  exclude using gist (
    consultorio_id with =,
    tsrange(
      (fecha + hora)::timestamp,
      (fecha + hora + make_interval(mins => duracion_min))::timestamp
    ) with &&
  ) where (estado not in ('Cancelado', 'Reprogramado', 'No Show'));

alter table public.turnos
  add constraint no_solapamiento_profesional
  exclude using gist (
    profesional_id with =,
    tsrange(
      (fecha + hora)::timestamp,
      (fecha + hora + make_interval(mins => duracion_min))::timestamp
    ) with &&
  ) where (estado not in ('Cancelado', 'Reprogramado', 'No Show'));

create index idx_turnos_fecha        on public.turnos(fecha);
create index idx_turnos_paciente     on public.turnos(paciente_id);
create index idx_turnos_profesional  on public.turnos(profesional_id);
create index idx_turnos_consultorio  on public.turnos(consultorio_id);
create index idx_turnos_estado       on public.turnos(estado);
create index idx_turnos_fecha_estado on public.turnos(fecha, estado);

create table public.lista_espera (
  id             uuid primary key default uuid_generate_v4(),
  paciente_id    uuid not null references public.pacientes(id) on delete cascade,
  especialidad   text not null,
  profesional_id uuid references public.profesionales(id) on delete set null,
  prioridad      int not null default 5 check (prioridad between 1 and 10),
  notas          text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.autorizaciones (
  id                uuid primary key default uuid_generate_v4(),
  paciente_id       uuid not null references public.pacientes(id) on delete cascade,
  obra_social       text not null,
  prestacion        text not null,
  numero            text not null,
  sesiones_auth     int not null default 0 check (sesiones_auth >= 0),
  sesiones_usadas   int not null default 0 check (sesiones_usadas >= 0),
  fecha_solicitud   date not null default current_date,
  fecha_vencimiento date,
  estado            estado_autorizacion not null default 'Pendiente',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sesiones_validas check (sesiones_usadas <= sesiones_auth)
);
create index idx_autorizaciones_paciente on public.autorizaciones(paciente_id);
create index idx_autorizaciones_estado   on public.autorizaciones(estado);

create table public.evoluciones (
  id             uuid primary key default uuid_generate_v4(),
  turno_id       uuid references public.turnos(id) on delete set null,
  paciente_id    uuid not null references public.pacientes(id) on delete cascade,
  profesional_id uuid not null references public.profesionales(id) on delete restrict,
  fecha          timestamptz not null default now(),
  texto          text not null,
  firmado        boolean not null default false,
  firmado_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_evoluciones_paciente on public.evoluciones(paciente_id, fecha desc);

create table public.archivos_clinicos (
  id           uuid primary key default uuid_generate_v4(),
  paciente_id  uuid not null references public.pacientes(id) on delete cascade,
  nombre       text not null,
  storage_path text not null,
  tipo_mime    text,
  tamano_bytes bigint,
  descripcion  text,
  uploaded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.insumos (
  id             uuid primary key default uuid_generate_v4(),
  nombre         text not null,
  categoria      text not null,
  unidad         text not null default 'unid',
  stock_actual   int not null default 0 check (stock_actual >= 0),
  stock_minimo   int not null default 0 check (stock_minimo >= 0),
  costo_unitario numeric(10,2) not null default 0 check (costo_unitario >= 0),
  consultorio_id int references public.consultorios(id) on delete set null,
  activo         boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table public.movimientos_stock (
  id         uuid primary key default uuid_generate_v4(),
  insumo_id  uuid not null references public.insumos(id) on delete cascade,
  tipo       text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  cantidad   int not null check (cantidad > 0),
  motivo     text,
  usuario_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Seed 12 consultorios
insert into public.consultorios (nombre, especialidad) values
  ('Consultorio 1',  'Kinesiología'),
  ('Consultorio 2',  'Fisioterapia'),
  ('Consultorio 3',  'Psicología'),
  ('Consultorio 4',  'Traumatología'),
  ('Consultorio 5',  'Neurología'),
  ('Consultorio 6',  'Reumatología'),
  ('Consultorio 7',  'Pediatría'),
  ('Consultorio 8',  'Deportología'),
  ('Consultorio 9',  'Kinesiología'),
  ('Consultorio 10', 'Fisioterapia'),
  ('Consultorio 11', 'Psicología'),
  ('Consultorio 12', 'Traumatología');

-- ════════ PARTE 3 — FUNCIONES + RLS ════════════════════════
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_profiles_updated_at       before update on public.profiles       for each row execute function public.set_updated_at();
create trigger trg_consultorios_updated_at   before update on public.consultorios   for each row execute function public.set_updated_at();
create trigger trg_pacientes_updated_at      before update on public.pacientes      for each row execute function public.set_updated_at();
create trigger trg_turnos_updated_at         before update on public.turnos         for each row execute function public.set_updated_at();
create trigger trg_autorizaciones_updated_at before update on public.autorizaciones for each row execute function public.set_updated_at();
create trigger trg_insumos_updated_at        before update on public.insumos        for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles          enable row level security;
alter table public.consultorios      enable row level security;
alter table public.profesionales     enable row level security;
alter table public.pacientes         enable row level security;
alter table public.turnos            enable row level security;
alter table public.lista_espera      enable row level security;
alter table public.autorizaciones    enable row level security;
alter table public.evoluciones       enable row level security;
alter table public.archivos_clinicos enable row level security;
alter table public.insumos           enable row level security;
alter table public.movimientos_stock enable row level security;

create or replace function public.mi_rol()
returns rol_usuario language sql security definer stable
set search_path = public as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- Policies
create policy "profiles: ver propio"      on public.profiles for select using (id = auth.uid());
create policy "profiles: admin ve todos"  on public.profiles for select using (public.mi_rol() = 'admin');
create policy "profiles: admin actualiza" on public.profiles for update using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
create policy "profiles: auto-actualizar" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and rol = (select rol from public.profiles where id = auth.uid()));

create policy "consultorios: lectura autenticados"       on public.consultorios for select using (auth.uid() is not null);
create policy "consultorios: admin actualiza"            on public.consultorios for update using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
create policy "consultorios: recepcion actualiza estado" on public.consultorios for update using (public.mi_rol() in ('admin','recepcion')) with check (public.mi_rol() in ('admin','recepcion'));

create policy "profesionales: lectura autenticados" on public.profesionales for select using (auth.uid() is not null);
create policy "profesionales: admin gestiona"       on public.profesionales for all    using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

create policy "pacientes: admin y recepcion ven todos"     on public.pacientes for select using (public.mi_rol() in ('admin', 'recepcion'));
create policy "pacientes: profesional ve sus pacientes"    on public.pacientes for select
  using (
    public.mi_rol() = 'profesional'
    and id in (select t.paciente_id from public.turnos t join public.profesionales p on p.id = t.profesional_id where p.profile_id = auth.uid())
  );
create policy "pacientes: admin y recepcion crean"         on public.pacientes for insert with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "pacientes: admin y recepcion actualizan"    on public.pacientes for update using (public.mi_rol() in ('admin', 'recepcion')) with check (public.mi_rol() in ('admin', 'recepcion'));

create policy "turnos: admin y recepcion ven todos"        on public.turnos for select using (public.mi_rol() in ('admin', 'recepcion'));
create policy "turnos: admin lee todo"                     on public.turnos for select using (public.mi_rol() = 'admin');
create policy "turnos: profesional ve los suyos"           on public.turnos for select
  using (public.mi_rol() = 'profesional' and profesional_id in (select id from public.profesionales where profile_id = auth.uid()));
create policy "turnos: admin y recepcion crean"            on public.turnos for insert with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "turnos: actualizar estado"                  on public.turnos for update
  using (public.mi_rol() in ('admin', 'recepcion') or (public.mi_rol() = 'profesional' and profesional_id in (select id from public.profesionales where profile_id = auth.uid())))
  with check (public.mi_rol() in ('admin', 'recepcion') or (public.mi_rol() = 'profesional' and profesional_id in (select id from public.profesionales where profile_id = auth.uid())));
create policy "turnos: solo admin elimina"                 on public.turnos for delete using (public.mi_rol() = 'admin');

create policy "autorizaciones: admin y recepcion gestionan" on public.autorizaciones for all using (public.mi_rol() in ('admin', 'recepcion')) with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "autorizaciones: profesional lee las de sus pacientes" on public.autorizaciones for select
  using (public.mi_rol() = 'profesional' and paciente_id in (select t.paciente_id from public.turnos t join public.profesionales p on p.id = t.profesional_id where p.profile_id = auth.uid()));

create policy "evoluciones: profesional y admin leen" on public.evoluciones for select
  using (public.mi_rol() in ('admin', 'recepcion') or (public.mi_rol() = 'profesional' and profesional_id in (select id from public.profesionales where profile_id = auth.uid())));
create policy "evoluciones: profesional y admin crean" on public.evoluciones for insert with check (public.mi_rol() in ('admin', 'profesional'));
create policy "evoluciones: no editar firmadas" on public.evoluciones for update
  using (firmado = false and (public.mi_rol() = 'admin' or profesional_id in (select id from public.profesionales where profile_id = auth.uid())))
  with check (firmado = false and (public.mi_rol() = 'admin' or profesional_id in (select id from public.profesionales where profile_id = auth.uid())));

create policy "archivos: admin y profesional leen"  on public.archivos_clinicos for select using (public.mi_rol() in ('admin', 'profesional'));
create policy "archivos: admin y profesional suben" on public.archivos_clinicos for insert with check (public.mi_rol() in ('admin', 'profesional'));
create policy "archivos: solo admin elimina"        on public.archivos_clinicos for delete using (public.mi_rol() = 'admin');

create policy "insumos: lectura autenticados"        on public.insumos for select using (auth.uid() is not null);
create policy "insumos: admin y recepcion insertan"  on public.insumos for insert with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "insumos: admin y recepcion actualizan" on public.insumos for update using (public.mi_rol() in ('admin', 'recepcion')) with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "insumos: solo admin elimina"          on public.insumos for delete using (public.mi_rol() = 'admin');

create policy "movimientos: lectura autenticados" on public.movimientos_stock for select using (auth.uid() is not null);
create policy "movimientos: insert autenticados"  on public.movimientos_stock for insert with check (auth.uid() is not null);

create policy "lista_espera: admin y recepcion gestionan" on public.lista_espera for all using (public.mi_rol() in ('admin', 'recepcion')) with check (public.mi_rol() in ('admin', 'recepcion'));
create policy "lista_espera: profesional lee la suya" on public.lista_espera for select
  using (public.mi_rol() = 'profesional' and profesional_id in (select id from public.profesionales where profile_id = auth.uid()));

insert into storage.buckets (id, name, public) values ('historias-clinicas', 'historias-clinicas', false)
on conflict (id) do nothing;

create policy "hcl: lectura admin y profesional" on storage.objects for select
  using (bucket_id = 'historias-clinicas' and auth.uid() is not null and public.mi_rol() in ('admin', 'profesional'));
create policy "hcl: upload admin y profesional" on storage.objects for insert
  with check (bucket_id = 'historias-clinicas' and auth.uid() is not null and public.mi_rol() in ('admin', 'profesional'));
create policy "hcl: delete solo admin" on storage.objects for delete
  using (bucket_id = 'historias-clinicas' and public.mi_rol() = 'admin');

-- ════════ PARTE 4 — VISTAS + AUDIT + REF ═════════════════════
create view public.v_turnos_dia with (security_invoker = true) as
select
  t.id, t.fecha, t.hora, t.duracion_min, t.estado, t.tipo, t.cobertura,
  t.numero_autorizacion, t.notas,
  p.id as paciente_id, p.nombre as pac_nombre, p.dni as pac_dni,
  p.cobertura as pac_cobertura, p.score_noshow,
  pr.id as profesional_id, pr.nombre as prof_nombre, pr.especialidad,
  c.id as consultorio_id, c.nombre as consultorio_nombre
from public.turnos t
join public.pacientes p     on p.id  = t.paciente_id
join public.profesionales pr on pr.id = t.profesional_id
join public.consultorios c   on c.id  = t.consultorio_id;

create view public.v_autorizaciones_criticas with (security_invoker = true) as
select a.*, p.nombre as pac_nombre, p.telefono as pac_telefono,
  (a.sesiones_auth - a.sesiones_usadas) as sesiones_restantes,
  case
    when a.sesiones_auth - a.sesiones_usadas <= 2 then 'sesiones_critico'
    when a.fecha_vencimiento <= current_date + 7  then 'vencimiento_critico'
    else 'ok'
  end as nivel_alerta
from public.autorizaciones a
join public.pacientes p on p.id = a.paciente_id
where a.estado = 'Aprobada'
  and (a.sesiones_auth - a.sesiones_usadas <= 2 or a.fecha_vencimiento <= current_date + 7);

create table public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  tabla       text not null,
  operacion   text not null check (operacion in ('INSERT','UPDATE','DELETE')),
  registro_id text not null,
  usuario_id  uuid references public.profiles(id),
  datos_old   jsonb,
  datos_new   jsonb,
  created_at  timestamptz not null default now()
);
create index idx_audit_tabla_fecha on public.audit_log(tabla, created_at desc);
create index idx_audit_usuario     on public.audit_log(usuario_id);

alter table public.audit_log enable row level security;
create policy "audit: solo admin lee" on public.audit_log for select using (public.mi_rol() = 'admin');

create or replace function public.fn_audit_trigger()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_usuario uuid := auth.uid();
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

create trigger trg_audit_turnos      after insert or update or delete on public.turnos      for each row execute function public.fn_audit_trigger();
create trigger trg_audit_evoluciones after insert or update or delete on public.evoluciones for each row execute function public.fn_audit_trigger();
create trigger trg_audit_pacientes   after insert or update or delete on public.pacientes   for each row execute function public.fn_audit_trigger();

create sequence public.pacientes_ref_seq;

create or replace function public.fn_pacientes_ref()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.ref is null or new.ref = '' then
    new.ref := 'PAC-' || to_char(now(),'YYYY') || '-' ||
               lpad(nextval('public.pacientes_ref_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger trg_pacientes_ref before insert on public.pacientes for each row execute function public.fn_pacientes_ref();

-- ════════ FIN ═════════════════════════════════════════════════
-- Ahora:
-- 1. Authentication > Users > Add user (tildar "Auto Confirm User")
-- 2. Table Editor > profiles > editar rol a 'admin'
-- 3. Volver al ERP y loguearte
