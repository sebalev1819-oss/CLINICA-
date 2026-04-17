-- ============================================================
--  RehabMed ERP — Schema inicial
--  Ejecutar en: Supabase > SQL Editor
-- ============================================================

-- ── EXTENSIONES ──────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "btree_gist";   -- necesario para EXCLUDE en columnas no-geométricas

-- ── ENUM TYPES ───────────────────────────────────────────
create type rol_usuario       as enum ('admin', 'profesional', 'recepcion');
create type estado_turno      as enum ('Pendiente', 'Confirmado', 'En curso', 'Finalizado', 'No Show', 'Cancelado', 'Reprogramado', 'Lista espera');
create type estado_consultorio as enum ('libre', 'ocupado', 'limpieza', 'mantenimiento');
create type tipo_turno        as enum ('Presencial', 'Virtual');
create type tipo_profesional  as enum ('Full Time', 'Part Time', 'Freelance');
create type estado_paciente   as enum ('Activo', 'Inactivo', 'Nuevo', 'Alta');
create type estado_autorizacion as enum ('Pendiente', 'Aprobada', 'Rechazada', 'En revisión', 'Vencida');

-- ============================================================
--  PROFILES (extiende auth.users de Supabase)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  iniciales   text not null,
  rol         rol_usuario not null default 'recepcion',
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Perfil de usuario del sistema, vinculado a auth.users';

-- ============================================================
--  CONSULTORIOS (12 consultorios)
-- ============================================================
create table public.consultorios (
  id              serial primary key,
  nombre          text not null,
  especialidad    text not null,
  estado          estado_consultorio not null default 'libre',
  profesional_id  uuid,                   -- FK se agrega después de crear profesionales
  updated_at      timestamptz not null default now()
);
comment on table public.consultorios is '12 consultorios físicos de la clínica';

-- ============================================================
--  PROFESIONALES
-- ============================================================
create table public.profesionales (
  id              uuid primary key default uuid_generate_v4(),
  profile_id      uuid references public.profiles(id) on delete set null,
  nombre          text not null,
  iniciales       text not null,
  especialidad    text not null,
  matricula       text not null,
  tipo            tipo_profesional not null default 'Full Time',
  consultorio_id  int references public.consultorios(id) on delete set null,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);
comment on table public.profesionales is 'Profesionales clínicos de la institución';

-- FK diferida de consultorios.profesional_id
alter table public.consultorios
  add constraint fk_consultorios_profesional
  foreign key (profesional_id) references public.profesionales(id) on delete set null;

-- ============================================================
--  PACIENTES
-- ============================================================
create table public.pacientes (
  id              uuid primary key default uuid_generate_v4(),
  ref             text unique,                  -- PAC-2025-XXXX — autogenerado por trigger (ver 003)
  nombre          text not null,
  dni             text not null,
  telefono        text,
  email           text,
  fecha_nacimiento date,
  cobertura       text not null default 'Particular',
  numero_afiliado text,
  diagnostico     text,
  estado          estado_paciente not null default 'Nuevo',
  score_noshow    int not null default 100 check (score_noshow between 0 and 100),
  deuda           numeric(12,2) not null default 0,
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.pacientes is 'Registro completo de pacientes';

create index idx_pacientes_dni    on public.pacientes(dni);
create index idx_pacientes_nombre on public.pacientes using gin (to_tsvector('spanish', nombre));

-- ============================================================
--  TURNOS (corazón de la agenda)
-- ============================================================
create table public.turnos (
  id                uuid primary key default uuid_generate_v4(),
  fecha             date not null,
  hora              time not null,
  duracion_min      int not null default 45 check (duracion_min > 0 and duracion_min <= 480),
  paciente_id       uuid not null references public.pacientes(id) on delete restrict,
  profesional_id    uuid not null references public.profesionales(id) on delete restrict,
  consultorio_id    int  not null references public.consultorios(id) on delete restrict,
  especialidad      text not null,
  tipo              tipo_turno   not null default 'Presencial',
  estado            estado_turno not null default 'Pendiente',
  cobertura         text,
  numero_autorizacion text,
  notas             text,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.turnos is 'Agenda de turnos — incluye constraint anti-solapamiento por consultorio';

-- Anti-solapamiento: mismo consultorio no puede tener dos turnos activos al mismo tiempo
alter table public.turnos
  add constraint no_solapamiento_consultorio
  exclude using gist (
    consultorio_id with =,
    tsrange(
      (fecha + hora)::timestamp,
      (fecha + hora + make_interval(mins => duracion_min))::timestamp
    ) with &&
  ) where (estado not in ('Cancelado', 'Reprogramado', 'No Show'));

-- Anti-solapamiento: mismo profesional no puede tener dos turnos a la vez
alter table public.turnos
  add constraint no_solapamiento_profesional
  exclude using gist (
    profesional_id with =,
    tsrange(
      (fecha + hora)::timestamp,
      (fecha + hora + make_interval(mins => duracion_min))::timestamp
    ) with &&
  ) where (estado not in ('Cancelado', 'Reprogramado', 'No Show'));

create index idx_turnos_fecha         on public.turnos(fecha);
create index idx_turnos_paciente      on public.turnos(paciente_id);
create index idx_turnos_profesional   on public.turnos(profesional_id);
create index idx_turnos_consultorio   on public.turnos(consultorio_id);
create index idx_turnos_estado        on public.turnos(estado);
create index idx_turnos_fecha_estado  on public.turnos(fecha, estado);

-- ============================================================
--  LISTA DE ESPERA
-- ============================================================
create table public.lista_espera (
  id              uuid primary key default uuid_generate_v4(),
  paciente_id     uuid not null references public.pacientes(id) on delete cascade,
  especialidad    text not null,
  profesional_id  uuid references public.profesionales(id) on delete set null,
  prioridad       int not null default 5 check (prioridad between 1 and 10),
  notas           text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================
--  AUTORIZACIONES DE OBRA SOCIAL
-- ============================================================
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
comment on table public.autorizaciones is 'Autorizaciones de prestaciones por obra social';

create index idx_autorizaciones_paciente on public.autorizaciones(paciente_id);
create index idx_autorizaciones_estado   on public.autorizaciones(estado);

-- ============================================================
--  HISTORIA CLÍNICA — EVOLUCIONES
-- ============================================================
create table public.evoluciones (
  id              uuid primary key default uuid_generate_v4(),
  turno_id        uuid references public.turnos(id) on delete set null,
  paciente_id     uuid not null references public.pacientes(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete restrict,
  fecha           timestamptz not null default now(),
  texto           text not null,
  firmado         boolean not null default false,
  firmado_at      timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.evoluciones is 'Evoluciones clínicas por sesión — historia clínica';

create index idx_evoluciones_paciente on public.evoluciones(paciente_id, fecha desc);

-- ============================================================
--  ARCHIVOS CLÍNICOS (Supabase Storage)
-- ============================================================
create table public.archivos_clinicos (
  id              uuid primary key default uuid_generate_v4(),
  paciente_id     uuid not null references public.pacientes(id) on delete cascade,
  nombre          text not null,
  storage_path    text not null,     -- path en bucket 'historias-clinicas'
  tipo_mime       text,
  tamano_bytes    bigint,
  descripcion     text,
  uploaded_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);

-- ============================================================
--  STOCK
-- ============================================================
create table public.insumos (
  id              uuid primary key default uuid_generate_v4(),
  nombre          text not null,
  categoria       text not null,
  unidad          text not null default 'unid',
  stock_actual    int not null default 0 check (stock_actual >= 0),
  stock_minimo    int not null default 0 check (stock_minimo >= 0),
  costo_unitario  numeric(10,2) not null default 0 check (costo_unitario >= 0),
  consultorio_id  int references public.consultorios(id) on delete set null,
  activo          boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table public.movimientos_stock (
  id          uuid primary key default uuid_generate_v4(),
  insumo_id   uuid not null references public.insumos(id) on delete cascade,
  tipo        text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  cantidad    int not null check (cantidad > 0),
  motivo      text,
  usuario_id  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ============================================================
--  TRIGGERS — updated_at automático
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at      before update on public.profiles      for each row execute function public.set_updated_at();
create trigger trg_consultorios_updated_at  before update on public.consultorios  for each row execute function public.set_updated_at();
create trigger trg_pacientes_updated_at     before update on public.pacientes     for each row execute function public.set_updated_at();
create trigger trg_turnos_updated_at        before update on public.turnos        for each row execute function public.set_updated_at();
create trigger trg_autorizaciones_updated_at before update on public.autorizaciones for each row execute function public.set_updated_at();
create trigger trg_insumos_updated_at       before update on public.insumos       for each row execute function public.set_updated_at();

-- ============================================================
--  TRIGGER — Crear profile automáticamente al registrar usuario
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer
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

-- ============================================================
--  SEED — 12 Consultorios base
-- ============================================================
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
