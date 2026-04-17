-- ============================================================
--  RehabMed ERP — Horarios de atención por profesional
-- ============================================================
--  Permite configurar:
--   - Días y franjas horarias por profesional
--   - Duración por consulta
--   - Excepciones (feriados, ausencias, días extra)
--   - Validación automática al crear turnos
-- ============================================================

-- Duración default de consulta + anticipación mínima por profesional
alter table public.profesionales
  add column if not exists duracion_consulta int not null default 45 check (duracion_consulta between 15 and 240),
  add column if not exists min_anticipacion_hs int not null default 2 check (min_anticipacion_hs >= 0);

-- ============================================================
--  HORARIOS SEMANALES
--  Una fila por franja por día que atiende el profesional
--  Ejemplo: Dr. Bravo atiende L/X/V 9-13 y 14-18 → 6 filas
-- ============================================================
create table public.profesionales_horarios (
  id              uuid primary key default uuid_generate_v4(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  -- 0 = domingo, 1 = lunes, ..., 6 = sábado (ISO con lunes-primero usa 1-7)
  -- Uso convención JS: 0=dom, 1=lun, 2=mar, 3=mie, 4=jue, 5=vie, 6=sab
  dia_semana      int not null check (dia_semana between 0 and 6),
  hora_inicio     time not null,
  hora_fin        time not null,
  consultorio_id  int references public.consultorios(id) on delete set null,
  vigencia_desde  date not null default current_date,
  vigencia_hasta  date,
  activo          boolean not null default true,
  notas           text,
  created_at      timestamptz not null default now(),

  constraint franja_valida check (hora_fin > hora_inicio),
  constraint vigencia_valida check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
comment on table public.profesionales_horarios is
  'Franjas de atención por día de la semana. Un profesional puede tener varias franjas el mismo día (mañana y tarde).';

create index idx_prof_horarios_prof on public.profesionales_horarios(profesional_id, activo);
create index idx_prof_horarios_dia on public.profesionales_horarios(dia_semana);

-- ============================================================
--  EXCEPCIONES (feriados, ausencias, días extra)
-- ============================================================
create type tipo_excepcion_horario as enum (
  'feriado',
  'ausencia',
  'vacaciones',
  'dia_extra',
  'licencia_medica',
  'otro'
);

create table public.profesionales_excepciones (
  id              uuid primary key default uuid_generate_v4(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  fecha           date not null,
  fecha_hasta     date,
  tipo            tipo_excepcion_horario not null,
  -- Si es dia_extra, hora_inicio/fin indican la franja especial
  hora_inicio     time,
  hora_fin        time,
  motivo          text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint rango_valido check (fecha_hasta is null or fecha_hasta >= fecha)
);
comment on table public.profesionales_excepciones is
  'Excepciones al horario normal: feriados, ausencias, vacaciones, o días extra de atención.';

create index idx_prof_exc_prof on public.profesionales_excepciones(profesional_id);
create index idx_prof_exc_fecha on public.profesionales_excepciones(fecha);

-- ============================================================
--  RLS
-- ============================================================
alter table public.profesionales_horarios    enable row level security;
alter table public.profesionales_excepciones enable row level security;

create policy "horarios: lectura autenticados"
  on public.profesionales_horarios for select
  using (auth.uid() is not null);

create policy "horarios: admin gestiona"
  on public.profesionales_horarios for all
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

create policy "horarios: profesional edita los suyos"
  on public.profesionales_horarios for update
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

create policy "excepciones: lectura autenticados"
  on public.profesionales_excepciones for select
  using (auth.uid() is not null);

create policy "excepciones: admin y recepcion gestionan"
  on public.profesionales_excepciones for all
  using (public.mi_rol() in ('admin','recepcion'))
  with check (public.mi_rol() in ('admin','recepcion'));

-- ============================================================
--  FUNCIÓN: ¿El profesional atiende en esa fecha/hora?
-- ============================================================
create or replace function public.puede_atender(
  p_profesional_id uuid,
  p_fecha date,
  p_hora time,
  p_duracion_min int default null
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_dia_semana    int;
  v_duracion      int;
  v_hora_fin      time;
  v_tiene_horario boolean;
  v_es_feriado    boolean;
  v_es_ausencia   boolean;
  v_dia_extra     record;
begin
  -- Día de la semana (0=dom ... 6=sab)
  v_dia_semana := extract(dow from p_fecha)::int;

  -- Duración: si no pasa, usar la del profesional
  v_duracion := coalesce(
    p_duracion_min,
    (select duracion_consulta from public.profesionales where id = p_profesional_id),
    45
  );
  v_hora_fin := (p_hora::interval + make_interval(mins => v_duracion))::time;

  -- ¿Hay excepción por ausencia/feriado ese día?
  select exists (
    select 1 from public.profesionales_excepciones
    where profesional_id = p_profesional_id
      and tipo in ('feriado','ausencia','vacaciones','licencia_medica','otro')
      and p_fecha between fecha and coalesce(fecha_hasta, fecha)
  ) into v_es_ausencia;

  if v_es_ausencia then return false; end if;

  -- ¿Hay día extra que cubre ese horario?
  select * into v_dia_extra
  from public.profesionales_excepciones
  where profesional_id = p_profesional_id
    and tipo = 'dia_extra'
    and p_fecha = fecha
    and hora_inicio is not null
    and hora_fin is not null
    and p_hora >= hora_inicio
    and v_hora_fin <= hora_fin
  limit 1;

  if found then return true; end if;

  -- ¿Tiene horario regular que cubre la franja?
  select exists (
    select 1 from public.profesionales_horarios
    where profesional_id = p_profesional_id
      and dia_semana = v_dia_semana
      and activo = true
      and vigencia_desde <= p_fecha
      and (vigencia_hasta is null or vigencia_hasta >= p_fecha)
      and p_hora >= hora_inicio
      and v_hora_fin <= hora_fin
  ) into v_tiene_horario;

  return v_tiene_horario;
end;
$$;
grant execute on function public.puede_atender(uuid, date, time, int) to authenticated;

-- ============================================================
--  FUNCIÓN: slots disponibles para un profesional en una fecha
--  Devuelve horarios que el profesional atiende y no tienen turno
-- ============================================================
create or replace function public.slots_disponibles(
  p_profesional_id uuid,
  p_fecha date
)
returns table (
  hora_inicio time,
  hora_fin time,
  ocupado boolean,
  turno_id uuid
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_dia_semana int;
  v_duracion   int;
  v_horario    record;
  v_current    time;
  v_fin_franja time;
  v_end_slot   time;
  v_turno      record;
begin
  v_dia_semana := extract(dow from p_fecha)::int;
  select duracion_consulta into v_duracion from public.profesionales where id = p_profesional_id;
  v_duracion := coalesce(v_duracion, 45);

  for v_horario in
    select * from public.profesionales_horarios
    where profesional_id = p_profesional_id
      and dia_semana = v_dia_semana
      and activo = true
      and vigencia_desde <= p_fecha
      and (vigencia_hasta is null or vigencia_hasta >= p_fecha)
    order by hora_inicio
  loop
    v_current := v_horario.hora_inicio;
    v_fin_franja := v_horario.hora_fin;

    while v_current + make_interval(mins => v_duracion) <= v_fin_franja loop
      v_end_slot := (v_current::interval + make_interval(mins => v_duracion))::time;

      -- ¿Hay turno ocupando este slot?
      select id into v_turno.id
      from public.turnos
      where profesional_id = p_profesional_id
        and fecha = p_fecha
        and estado not in ('Cancelado','No Show','Reprogramado')
        and hora < v_end_slot
        and (hora + make_interval(mins => duracion_min)) > v_current
      limit 1;

      hora_inicio := v_current;
      hora_fin    := v_end_slot;
      ocupado     := v_turno.id is not null;
      turno_id    := v_turno.id;
      return next;

      v_current := v_end_slot;
      v_turno.id := null;
    end loop;
  end loop;

  return;
end;
$$;
grant execute on function public.slots_disponibles(uuid, date) to authenticated;

-- ============================================================
--  Audit triggers
-- ============================================================
create trigger trg_audit_horarios
  after insert or update or delete on public.profesionales_horarios
  for each row execute function public.fn_audit_trigger();

create trigger trg_audit_excepciones
  after insert or update or delete on public.profesionales_excepciones
  for each row execute function public.fn_audit_trigger();

-- ============================================================
--  SEED: horarios típicos para los profesionales existentes
--  Lun-Vie 9:00-13:00 y 14:00-19:00
-- ============================================================
do $$
declare
  v_prof record;
  v_dia int;
begin
  for v_prof in select id, consultorio_id from public.profesionales where activo = true loop
    for v_dia in 1..5 loop  -- lunes a viernes
      insert into public.profesionales_horarios
        (profesional_id, dia_semana, hora_inicio, hora_fin, consultorio_id)
      values
        (v_prof.id, v_dia, '09:00', '13:00', v_prof.consultorio_id),
        (v_prof.id, v_dia, '14:00', '19:00', v_prof.consultorio_id)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
