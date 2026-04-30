-- ============================================================
--  RehabMed ERP — Row Level Security (RLS)
--  Ejecutar DESPUÉS de 001_schema.sql
--  (003_security_fixes.sql complementa y corrige cosas de este)
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
returns rol_usuario
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- ============================================================
--  PROFILES
-- ============================================================
create policy "profiles: ver propio"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: admin ve todos"
  on public.profiles for select
  using (public.mi_rol() = 'admin');

create policy "profiles: admin actualiza"
  on public.profiles for update
  using      (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- ============================================================
--  CONSULTORIOS
-- ============================================================
create policy "consultorios: lectura autenticados"
  on public.consultorios for select
  using (auth.uid() is not null);

create policy "consultorios: admin actualiza"
  on public.consultorios for update
  using      (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

create policy "consultorios: recepcion actualiza estado"
  on public.consultorios for update
  using      (public.mi_rol() in ('admin','recepcion'))
  with check (public.mi_rol() in ('admin','recepcion'));

-- ============================================================
--  PROFESIONALES
-- ============================================================
create policy "profesionales: lectura autenticados"
  on public.profesionales for select
  using (auth.uid() is not null);

create policy "profesionales: admin gestiona"
  on public.profesionales for all
  using      (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- ============================================================
--  PACIENTES
-- ============================================================
create policy "pacientes: admin y recepcion ven todos"
  on public.pacientes for select
  using (public.mi_rol() in ('admin', 'recepcion'));

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

create policy "pacientes: admin y recepcion crean"
  on public.pacientes for insert
  with check (public.mi_rol() in ('admin', 'recepcion'));

-- UPDATE se define en 003_security_fixes.sql con WITH CHECK

-- ============================================================
--  TURNOS
-- ============================================================
create policy "turnos: admin y recepcion ven todos"
  on public.turnos for select
  using (public.mi_rol() in ('admin', 'recepcion'));

create policy "turnos: profesional ve los suyos"
  on public.turnos for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

create policy "turnos: admin y recepcion crean"
  on public.turnos for insert
  with check (public.mi_rol() in ('admin', 'recepcion'));

-- UPDATE se define en 003_security_fixes.sql con WITH CHECK

create policy "turnos: solo admin elimina"
  on public.turnos for delete
  using (public.mi_rol() = 'admin');

-- ============================================================
--  AUTORIZACIONES
-- ============================================================
create policy "autorizaciones: admin y recepcion gestionan"
  on public.autorizaciones for all
  using      (public.mi_rol() in ('admin', 'recepcion'))
  with check (public.mi_rol() in ('admin', 'recepcion'));

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
create policy "evoluciones: profesional y admin leen"
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

create policy "evoluciones: profesional y admin crean"
  on public.evoluciones for insert
  with check (
    public.mi_rol() in ('admin', 'profesional')
  );

-- UPDATE se define en 003_security_fixes.sql con WITH CHECK

-- ============================================================
--  ARCHIVOS CLINICOS
-- ============================================================
create policy "archivos: admin y profesional leen"
  on public.archivos_clinicos for select
  using (public.mi_rol() in ('admin', 'profesional'));

create policy "archivos: admin y profesional suben"
  on public.archivos_clinicos for insert
  with check (public.mi_rol() in ('admin', 'profesional'));

create policy "archivos: solo admin elimina"
  on public.archivos_clinicos for delete
  using (public.mi_rol() = 'admin');

-- ============================================================
--  STOCK — policies se definen/reemplazan en 003
-- ============================================================
create policy "insumos: lectura autenticados"
  on public.insumos for select
  using (auth.uid() is not null);

create policy "movimientos: lectura autenticados"
  on public.movimientos_stock for select
  using (auth.uid() is not null);

create policy "movimientos: insert autenticados"
  on public.movimientos_stock for insert
  with check (auth.uid() is not null);

-- ============================================================
--  LISTA DE ESPERA
-- ============================================================
create policy "lista_espera: admin y recepcion gestionan"
  on public.lista_espera for all
  using      (public.mi_rol() in ('admin', 'recepcion'))
  with check (public.mi_rol() in ('admin', 'recepcion'));

create policy "lista_espera: profesional lee la suya"
  on public.lista_espera for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

-- ============================================================
--  SUPABASE STORAGE — Bucket para historia clínica
--  Las policies se crean en 003_security_fixes.sql (más granulares)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('historias-clinicas', 'historias-clinicas', false)
on conflict (id) do nothing;
