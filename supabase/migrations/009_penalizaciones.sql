-- ============================================================
--  RehabMed ERP — Sistema de penalizaciones a profesionales
-- ============================================================
--  Tabla para registrar descuentos por cancelación tardía,
--  no-show del profesional, llegada tarde, ausencias, etc.
--  Se aplican automáticamente al generar liquidación.
-- ============================================================

create type tipo_penalizacion as enum (
  'Cancelación tardía',
  'No-show profesional',
  'Llegada tarde',
  'Ausencia injustificada',
  'Reclamo paciente',
  'Otro'
);

create table public.penalizaciones (
  id              uuid primary key default uuid_generate_v4(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  turno_id        uuid references public.turnos(id) on delete set null,
  fecha           date not null default current_date,
  tipo            tipo_penalizacion not null,
  motivo          text,
  monto           numeric(12,2) not null check (monto > 0),

  -- Estado
  aplicada        boolean not null default false,
  liquidacion_id  uuid references public.liquidaciones(id) on delete set null,
  aplicada_at     timestamptz,

  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.penalizaciones is
  'Descuentos aplicados al profesional por incumplimientos. Se descuentan del neto de la liquidación del período correspondiente.';

create index idx_penal_profesional on public.penalizaciones(profesional_id);
create index idx_penal_fecha       on public.penalizaciones(fecha desc);
create index idx_penal_pendientes  on public.penalizaciones(profesional_id, aplicada)
  where aplicada = false;

create trigger trg_penalizaciones_updated_at
  before update on public.penalizaciones
  for each row execute function public.set_updated_at();

-- Audit log
create trigger trg_audit_penalizaciones
  after insert or update or delete on public.penalizaciones
  for each row execute function public.fn_audit_trigger();

-- ============================================================
--  RLS
-- ============================================================
alter table public.penalizaciones enable row level security;

create policy "penal: admin gestiona"
  on public.penalizaciones for all
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

create policy "penal: profesional lee las suyas"
  on public.penalizaciones for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (
      select id from public.profesionales where profile_id = auth.uid()
    )
  );

-- ============================================================
--  FUNCIÓN: aplicar penalizaciones pendientes a una liquidación
-- ============================================================
create or replace function public.aplicar_penalizaciones_liquidacion(p_liquidacion_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq      public.liquidaciones;
  v_total    numeric(12,2) := 0;
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo admin puede aplicar penalizaciones';
  end if;

  select * into v_liq from public.liquidaciones where id = p_liquidacion_id;
  if not found then raise exception 'Liquidación no encontrada'; end if;
  if v_liq.estado not in ('Borrador') then
    raise exception 'Solo se pueden aplicar penalizaciones a liquidaciones en borrador';
  end if;

  -- Sumar penalizaciones pendientes del período
  select coalesce(sum(monto), 0) into v_total
  from public.penalizaciones
  where profesional_id = v_liq.profesional_id
    and aplicada = false
    and fecha between v_liq.periodo_desde and v_liq.periodo_hasta;

  -- Marcar como aplicadas
  update public.penalizaciones
  set aplicada = true,
      liquidacion_id = p_liquidacion_id,
      aplicada_at = now()
  where profesional_id = v_liq.profesional_id
    and aplicada = false
    and fecha between v_liq.periodo_desde and v_liq.periodo_hasta;

  -- Actualizar liquidación
  update public.liquidaciones
  set total_descuentos = v_total,
      total_neto = total_bruto - v_total
  where id = p_liquidacion_id;

  return v_total;
end;
$$;
grant execute on function public.aplicar_penalizaciones_liquidacion(uuid) to authenticated;

-- ============================================================
--  FUNCIÓN: registrar penalización automática por no-show
--  Cuando un turno pasa a "No Show" y la cancelación fue responsabilidad
--  del profesional (no del paciente), se puede llamar a esto.
--  (El uso queda a criterio admin — por defecto no se invoca)
-- ============================================================
create or replace function public.registrar_penalizacion_cancel_tardia(
  p_turno_id uuid,
  p_tipo tipo_penalizacion default 'Cancelación tardía',
  p_monto numeric default 1000
)
returns public.penalizaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno record;
  v_penal public.penalizaciones;
begin
  if public.mi_rol() not in ('admin','recepcion') then
    raise exception 'Solo admin o recepción pueden aplicar penalizaciones';
  end if;

  select * into v_turno from public.turnos where id = p_turno_id;
  if not found then raise exception 'Turno no encontrado'; end if;

  insert into public.penalizaciones (
    profesional_id, turno_id, fecha, tipo,
    motivo, monto, created_by
  ) values (
    v_turno.profesional_id, p_turno_id, v_turno.fecha, p_tipo,
    'Auto-generada desde turno ' || p_turno_id::text, p_monto, auth.uid()
  ) returning * into v_penal;

  return v_penal;
end;
$$;
grant execute on function public.registrar_penalizacion_cancel_tardia(uuid, tipo_penalizacion, numeric) to authenticated;
