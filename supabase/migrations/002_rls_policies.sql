-- ============================================================
--  RehabMed ERP — Row Level Security (RLS)
--  Ejecutar DESPUÉS de 001_schema.sql
-- ============================================================

-- ── Habilitar RLS en todas las tablas ────────────────────
alter table public.profiles           enable row level security;
alter table public.consultorios       enable row level security;
alter table public.profesionales      enable row level security;
alter table public.pacientes          enable row level security;
alter table public.turnos             enable row level security;
alter table public.lista_espera       enable row level security;
alter table public.autorizaciones     enable row level security;
alter table public.evoluciones        enable row level security;
alter table public.archivos_clinicos  enable row level security;
alter table public.insumos            enable row level security;
alter table public.movimientos_stock  enable row level security;

-- ============================================================
--  HELPER FUNCTION — rol del usuario logueado
-- ============================================================
create or replace function public.mi_rol()
returns rol_usuario language sql security definer stable as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- ============================================================
--  PROFILES
-- ============================================================

-- Cada usuario ve su propio perfil
create policy "profiles: ver propio"
  on public.profiles for select
  using (id = auth.uid());

-- Admin ve todos los perfiles
create policy "profiles: admin ve todos"
  on public.profiles for select
  using (public.mi_rol() = 'admin');

-- Admin puede actualizar perfiles
create policy "profiles: admin actualiza"
  on public.profiles for update
  using (public.mi_rol() = 'admin');

-- Cada usuario actualiza su propio perfil (nombre, iniciales)
create policy "profiles: auto-actualizar"
  on public.profiles for update
  using (id = auth.uid());

-- ============================================================
--  CONSULTORIOS
-- ============================================================

-- Todos los usuarios autenticados ven los consultorios
create policy "consultorios: lectura autenticados"
  on public.consultorios for select
  using (auth.uid() is not null);

-- Solo admin actualiza estado de consultorios
create policy "consultorios: admin actualiza"
  on public.consultorios for update
  using (public.mi_rol() = 'admin');

-- ============================================================
--  PROFESIONALES
-- ============================================================

-- Todos los autenticados ven lista de profesionales
create policy "profesionales: lectura autenticados"
  on public.profesionales for select
  using (auth.uid() is not null);

-- Admin gestiona profesionales
create policy "profesionales: admin gestiona"
  on public.profesionales for all
  using (public.mi_rol() = 'admin');

-- ============================================================
--  PACIENTES
-- ============================================================

-- Admin y recepción ven todos los pacientes
create policy "pacientes: admin y recepcion ven todos"
  on public.pacientes for select
  using (public.mi_rol() in ('admin', 'recepcion'));

-- Profesional ve solo sus pacientes (tienen turno con él)
create policy "pacientes: profesional ve sus pacientes"
  on public.pacientes for select
  using (
    public.mi_rol() = 'profesional'
    and id in (
      select t.paciente_id from public.turnos t
      join public.profesionales p on p.id = t.profesional_id
      where p.profile_id = auth.uid()
    )
  );

-- Admin y recepción crean/actualizan pacientes
create policy "pacientes: admin y recepcion gestionan"
  on public.pacientes for insert
  with check (public.mi_rol() in ('admin', 'recepcion'));

create policy "pacientes: admin y recepcion actualizan"
  on public.pacientes for update
  using (public.mi_rol() in ('admin', 'recepcion'));

-- ============================================================
--  TURNOS
-- ============================================================

-- Admin y recepción ven todos los turnos
create policy "turnos: admin y recepcion ven todos"
  on public.turnos for select
  using (public.mi_rol() in ('admin', 'recepcion'));

-- Profesional ve solo sus propios turnos
create policy "turnos: profesional ve los suyos"
  on public.turnos for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

-- Admin y recepción crean turnos
create policy "turnos: admin y recepcion crean"
  on public.turnos for insert
  with check (public.mi_rol() in ('admin', 'recepcion'));

-- Admin, recepción y el profesional asignado pueden actualizar estado
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
  );

-- Solo admin puede eliminar turnos
create policy "turnos: solo admin elimina"
  on public.turnos for delete
  using (public.mi_rol() = 'admin');

-- ============================================================
--  AUTORIZACIONES
-- ============================================================

create policy "autorizaciones: admin y recepcion gestionan"
  on public.autorizaciones for all
  using (public.mi_rol() in ('admin', 'recepcion'));

create policy "autorizaciones: profesional lee las de sus pacientes"
  on public.autorizaciones for select
  using (
    public.mi_rol() = 'profesional'
    and paciente_id in (
      select t.paciente_id from public.turnos t
      join public.profesionales p on p.id = t.profesional_id
      where p.profile_id = auth.uid()
    )
  );

-- ============================================================
--  EVOLUCIONES (Historia Clínica)
-- ============================================================

-- Profesional solo ve/crea evoluciones de sus pacientes
create policy "evoluciones: profesional sus pacientes"
  on public.evoluciones for select
  using (
    public.mi_rol() in ('admin', 'recepcion')
    or (
      public.mi_rol() = 'profesional'
      and profesional_id in (
        select id from public.profesionales where profile_id = auth.uid()
      )
    )
  );

create policy "evoluciones: profesional crea"
  on public.evoluciones for insert
  with check (
    public.mi_rol() in ('admin', 'profesional')
  );

-- Una evolución firmada no se puede modificar
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
  );

-- ============================================================
--  ARCHIVOS CLINICOS
-- ============================================================

create policy "archivos: admin y profesional leen"
  on public.archivos_clinicos for select
  using (
    public.mi_rol() in ('admin', 'profesional')
  );

create policy "archivos: admin y profesional suben"
  on public.archivos_clinicos for insert
  with check (public.mi_rol() in ('admin', 'profesional'));

create policy "archivos: solo admin elimina"
  on public.archivos_clinicos for delete
  using (public.mi_rol() = 'admin');

-- ============================================================
--  STOCK
-- ============================================================

-- Todos los autenticados ven el stock
create policy "insumos: lectura autenticados"
  on public.insumos for select
  using (auth.uid() is not null);

-- Admin y recepción gestionan stock
create policy "insumos: admin y recepcion gestionan"
  on public.insumos for all
  using (public.mi_rol() in ('admin', 'recepcion'));

create policy "movimientos: lectura autenticados"
  on public.movimientos_stock for select
  using (auth.uid() is not null);

create policy "movimientos: todos pueden registrar salidas"
  on public.movimientos_stock for insert
  with check (auth.uid() is not null);

-- ============================================================
--  LISTA DE ESPERA
-- ============================================================

create policy "lista_espera: admin y recepcion gestionan"
  on public.lista_espera for all
  using (public.mi_rol() in ('admin', 'recepcion'));

create policy "lista_espera: profesional lee la suya"
  on public.lista_espera for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

-- ============================================================
--  VISTA ÚTIL: turnos del día con datos JOIN
-- ============================================================
create or replace view public.v_turnos_dia as
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
join public.pacientes p   on p.id  = t.paciente_id
join public.profesionales pr on pr.id = t.profesional_id
join public.consultorios c   on c.id  = t.consultorio_id;

-- ============================================================
--  VISTA: autorizaciones próximas a vencer
-- ============================================================
create or replace view public.v_autorizaciones_criticas as
select
  a.*,
  p.nombre  as pac_nombre,
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

-- ============================================================
--  SUPABASE STORAGE — Bucket para historia clínica
-- ============================================================
-- Ejecutar desde el SQL Editor de Supabase:
insert into storage.buckets (id, name, public)
values ('historias-clinicas', 'historias-clinicas', false);

-- Policy: solo usuarios autenticados con rol adecuado acceden
create policy "hcl: solo autenticados con rol"
  on storage.objects for all
  using (
    bucket_id = 'historias-clinicas'
    and auth.uid() is not null
    and public.mi_rol() in ('admin', 'profesional')
  );
