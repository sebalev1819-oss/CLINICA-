-- ============================================================
--  RehabMed ERP — Fixes de funciones administrativas
-- ============================================================
--  1. facturar_turno: bug de precedencia AND/OR en WHERE + IN (null,...)
--     no matchea NULL. Se reescribe con OR envuelto en parens y
--     tratamiento explícito de particular.
--  2. generar_liquidacion: mejora lookup de tarifa (prioriza
--     particular cuando cobertura del turno es null o 'Particular').
-- ============================================================

create or replace function public.facturar_turno(p_turno_id uuid)
returns public.facturas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno   record;
  v_tarifa  numeric(12,2);
  v_factura public.facturas;
  v_os_id   uuid;
begin
  if public.mi_rol() not in ('admin','recepcion') then
    raise exception 'Solo admin o recepción pueden facturar';
  end if;

  select * into v_turno from public.turnos where id = p_turno_id;
  if not found then raise exception 'Turno no encontrado'; end if;

  -- Resolver obra_social_id a partir del texto de cobertura (si no es particular)
  v_os_id := null;
  if v_turno.cobertura is not null and v_turno.cobertura <> '' and v_turno.cobertura <> 'Particular' then
    select id into v_os_id
    from public.obras_sociales
    where nombre = v_turno.cobertura
    limit 1;
  end if;

  -- Buscar tarifa vigente (prioriza OS específica, fallback a particular)
  select monto into v_tarifa
  from public.v_tarifas_vigentes
  where especialidad = v_turno.especialidad
    and (
      (v_os_id is not null and obra_social_id = v_os_id)
      or (v_os_id is null and obra_social_id is null)
    )
  order by obra_social_id nulls last
  limit 1;

  -- Fallback: cualquier tarifa vigente de la especialidad
  if v_tarifa is null then
    select monto into v_tarifa
    from public.v_tarifas_vigentes
    where especialidad = v_turno.especialidad
    limit 1;
  end if;

  -- Último fallback: precio por defecto
  v_tarifa := coalesce(v_tarifa, 10000);

  -- Crear factura
  insert into public.facturas (tipo, paciente_id, obra_social_id, fecha_emision,
                                subtotal, total, saldo, estado, created_by)
  values ('Recibo', v_turno.paciente_id, v_os_id, current_date,
          v_tarifa, v_tarifa, v_tarifa, 'Emitida', auth.uid())
  returning * into v_factura;

  insert into public.factura_items (factura_id, turno_id, concepto, cantidad,
                                     monto_unitario, subtotal, orden)
  values (v_factura.id, p_turno_id,
          'Sesión ' || v_turno.especialidad, 1, v_tarifa, v_tarifa, 1);

  return v_factura;
end;
$$;

-- Mejora de generar_liquidacion: usa la misma logica de tarifa por OS
create or replace function public.generar_liquidacion(
  p_profesional_id uuid,
  p_desde date,
  p_hasta date,
  p_comision_pct numeric default 100
)
returns public.liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq    public.liquidaciones;
  v_total  numeric(12,2) := 0;
  v_count  int := 0;
  v_turno  record;
  v_tarifa numeric(12,2);
  v_os_id  uuid;
  v_subtotal numeric(12,2);
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo admin puede generar liquidaciones';
  end if;

  insert into public.liquidaciones (profesional_id, periodo_desde, periodo_hasta,
                                     comision_pct, estado, created_by)
  values (p_profesional_id, p_desde, p_hasta, p_comision_pct, 'Borrador', auth.uid())
  returning * into v_liq;

  for v_turno in
    select * from public.turnos
    where profesional_id = p_profesional_id
      and fecha between p_desde and p_hasta
      and estado = 'Finalizado'
    order by fecha, hora
  loop
    -- Resolver OS
    v_os_id := null;
    if v_turno.cobertura is not null and v_turno.cobertura <> '' and v_turno.cobertura <> 'Particular' then
      select id into v_os_id from public.obras_sociales where nombre = v_turno.cobertura limit 1;
    end if;

    -- Tarifa priorizada
    select monto into v_tarifa
    from public.v_tarifas_vigentes
    where especialidad = v_turno.especialidad
      and (
        (v_os_id is not null and obra_social_id = v_os_id)
        or (v_os_id is null and obra_social_id is null)
      )
    order by obra_social_id nulls last
    limit 1;

    if v_tarifa is null then
      select monto into v_tarifa
      from public.v_tarifas_vigentes
      where especialidad = v_turno.especialidad
      limit 1;
    end if;

    v_tarifa := coalesce(v_tarifa, 10000);
    v_subtotal := v_tarifa * (p_comision_pct / 100.0);

    insert into public.liquidacion_items (liquidacion_id, turno_id, fecha,
                                            concepto, cantidad, monto_unitario, subtotal)
    values (v_liq.id, v_turno.id, v_turno.fecha,
            'Sesión ' || v_turno.especialidad, 1, v_subtotal, v_subtotal);

    v_total := v_total + v_subtotal;
    v_count := v_count + 1;
  end loop;

  update public.liquidaciones
  set total_sesiones = v_count, total_bruto = v_total, total_neto = v_total
  where id = v_liq.id
  returning * into v_liq;

  return v_liq;
end;
$$;

-- ============================================================
--  BONUS: función para traer resumen de actividad por profesional
--  (útil antes de generar liquidación, para saber qué va a facturar)
-- ============================================================
create or replace function public.resumen_profesional(
  p_profesional_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  total_turnos int,
  finalizados int,
  no_show int,
  cancelados int,
  pacientes_unicos int,
  monto_estimado numeric
)
language sql
stable
set search_path = public
as $$
  with turnos_periodo as (
    select t.*,
      coalesce(
        (select monto from public.v_tarifas_vigentes
         where especialidad = t.especialidad limit 1),
        10000
      ) as tarifa
    from public.turnos t
    where t.profesional_id = p_profesional_id
      and t.fecha between p_desde and p_hasta
  )
  select
    count(*)::int as total_turnos,
    count(*) filter (where estado = 'Finalizado')::int as finalizados,
    count(*) filter (where estado = 'No Show')::int as no_show,
    count(*) filter (where estado = 'Cancelado')::int as cancelados,
    count(distinct paciente_id)::int as pacientes_unicos,
    coalesce(sum(tarifa) filter (where estado = 'Finalizado'), 0) as monto_estimado
  from turnos_periodo;
$$;
grant execute on function public.resumen_profesional(uuid, date, date) to authenticated;
