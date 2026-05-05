-- ============================================================
--  RehabMed ERP — Vistas SQL para reportería (BI)
--
--  Estas vistas son consultadas por el módulo de reportes y
--  también pueden conectarse desde Power BI Desktop / Excel
--  vía conexión directa a Postgres (host de Supabase).
-- ============================================================

-- ============================================================
--  REPORTE 1 — Turnos por período
--  Una fila por turno con todos los datos cruzados (paciente,
--  profesional, cobertura, especialidad, estado).
--  Filtrar por fecha en el cliente: where fecha between :ini and :fin
-- ============================================================
create or replace view public.v_rep_turnos as
select
  t.id,
  t.fecha,
  t.hora,
  t.duracion_min,
  t.estado,
  t.tipo,
  t.cobertura          as cobertura_turno,
  t.numero_autorizacion,
  t.notas,
  t.created_at,
  t.updated_at,
  -- Paciente
  p.id                 as paciente_id,
  p.nombre             as paciente_nombre,
  p.dni                as paciente_dni,
  p.cobertura          as paciente_cobertura,
  p.estado             as paciente_estado,
  p.score_noshow       as paciente_score,
  -- Profesional
  pr.id                as profesional_id,
  pr.nombre            as profesional_nombre,
  pr.especialidad      as profesional_especialidad,
  pr.matricula         as profesional_matricula,
  pr.tipo              as profesional_tipo,
  -- Consultorio
  c.id                 as consultorio_id,
  c.nombre             as consultorio_nombre,
  -- Año / Mes / Día (útil para agrupaciones en BI)
  extract(year from t.fecha)::int    as anio,
  extract(month from t.fecha)::int   as mes,
  extract(week from t.fecha)::int    as semana,
  to_char(t.fecha, 'YYYY-MM')        as anio_mes,
  to_char(t.fecha, 'TMDay')          as dia_semana_label
from public.turnos t
left join public.pacientes p     on p.id = t.paciente_id
left join public.profesionales pr on pr.id = t.profesional_id
left join public.consultorios c  on c.id = t.consultorio_id;

grant select on public.v_rep_turnos to authenticated;

-- ============================================================
--  REPORTE 2 — Autorizaciones por OS
--  Ranking de OS por cantidad de autorizaciones, sesiones
--  totales, sesiones usadas, % de uso.
-- ============================================================
create or replace view public.v_rep_autorizaciones_os as
select
  a.obra_social,
  count(*)                                                  as cantidad_autorizaciones,
  count(distinct a.paciente_id)                             as pacientes_distintos,
  sum(a.sesiones_auth)                                      as sesiones_totales_autorizadas,
  sum(a.sesiones_usadas)                                    as sesiones_totales_usadas,
  sum(a.sesiones_auth - a.sesiones_usadas)                  as sesiones_disponibles,
  round(
    (sum(a.sesiones_usadas)::numeric * 100)
    / nullif(sum(a.sesiones_auth), 0),
    1
  )                                                         as pct_uso,
  count(*) filter (where a.estado = 'Aprobada')             as aprobadas,
  count(*) filter (where a.estado = 'Pendiente')            as pendientes,
  count(*) filter (where a.estado = 'Rechazada')            as rechazadas,
  count(*) filter (
    where a.fecha_vencimiento >= current_date
      and a.fecha_vencimiento - current_date <= 10
  )                                                         as por_vencer_10_dias,
  count(*) filter (where a.fecha_vencimiento < current_date) as vencidas
from public.autorizaciones a
group by a.obra_social
order by cantidad_autorizaciones desc;

grant select on public.v_rep_autorizaciones_os to authenticated;

-- ============================================================
--  REPORTE 3 — Facturación por OS / mes
--  (solo funciona si la migration 006_erp_administracion.sql
--   creó la tabla 'facturas')
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'facturas'
  ) then
    execute $VIEW$
      create or replace view public.v_rep_facturacion_mensual as
      select
        to_char(f.fecha_emision, 'YYYY-MM')          as anio_mes,
        coalesce(f.cobertura_descriptiva, 'Otra')    as cobertura,
        f.tipo,
        count(*)                                      as cantidad_facturas,
        sum(f.total)                                  as total_facturado,
        sum(f.saldo)                                  as saldo_pendiente,
        sum(f.total - f.saldo)                        as total_cobrado,
        round(
          (sum(f.total - f.saldo)::numeric * 100)
          / nullif(sum(f.total), 0),
          1
        )                                             as pct_cobrado
      from public.facturas f
      where f.estado <> 'Anulada'
      group by 1, 2, 3
      order by 1 desc, 5 desc;

      grant select on public.v_rep_facturacion_mensual to authenticated;
    $VIEW$;
  else
    -- Vista vacía si no existe la tabla facturas (para evitar errores)
    execute $VIEW$
      create or replace view public.v_rep_facturacion_mensual as
      select
        ''::text  as anio_mes,
        ''::text  as cobertura,
        ''::text  as tipo,
        0::bigint as cantidad_facturas,
        0::numeric as total_facturado,
        0::numeric as saldo_pendiente,
        0::numeric as total_cobrado,
        0::numeric as pct_cobrado
      where false;

      grant select on public.v_rep_facturacion_mensual to authenticated;
    $VIEW$;
  end if;
end $$;

-- ============================================================
--  REPORTE 4 — Ocupación por profesional
--  Compara cantidad de turnos asignados vs cantidad de slots
--  disponibles según los horarios configurados.
-- ============================================================
create or replace view public.v_rep_ocupacion_profesional as
with rango as (
  -- Últimos 30 días
  select current_date - interval '30 days' as desde,
         current_date                       as hasta
),
turnos_periodo as (
  select
    t.profesional_id,
    count(*)                                      as turnos_total,
    count(*) filter (where t.estado = 'Finalizado')    as turnos_finalizados,
    count(*) filter (where t.estado = 'No Show')        as turnos_noshow,
    count(*) filter (where t.estado = 'Cancelado')      as turnos_cancelados,
    count(*) filter (where t.estado in ('Confirmado','Pendiente','En curso')) as turnos_activos
  from public.turnos t, rango r
  where t.fecha between r.desde and r.hasta
  group by t.profesional_id
)
select
  pr.id                                       as profesional_id,
  pr.nombre                                   as profesional_nombre,
  pr.especialidad,
  pr.matricula,
  pr.tipo,
  coalesce(tp.turnos_total, 0)                as turnos_total,
  coalesce(tp.turnos_finalizados, 0)          as turnos_finalizados,
  coalesce(tp.turnos_noshow, 0)               as turnos_noshow,
  coalesce(tp.turnos_cancelados, 0)           as turnos_cancelados,
  coalesce(tp.turnos_activos, 0)              as turnos_activos,
  round(
    (coalesce(tp.turnos_noshow, 0)::numeric * 100)
    / nullif(coalesce(tp.turnos_total, 0), 0),
    1
  )                                           as pct_noshow
from public.profesionales pr
left join turnos_periodo tp on tp.profesional_id = pr.id
where pr.activo = true
order by tp.turnos_total desc nulls last;

grant select on public.v_rep_ocupacion_profesional to authenticated;

-- ============================================================
--  REPORTE 5 — Ranking de no-show (pacientes y profesionales)
-- ============================================================
create or replace view public.v_rep_noshow_pacientes as
select
  p.id                            as paciente_id,
  p.nombre                        as paciente_nombre,
  p.dni,
  p.cobertura,
  p.score_noshow,
  count(t.id) filter (where t.estado = 'No Show')     as noshow_count,
  count(t.id)                                          as turnos_total,
  round(
    (count(t.id) filter (where t.estado = 'No Show')::numeric * 100)
    / nullif(count(t.id), 0),
    1
  )                                                    as pct_noshow
from public.pacientes p
left join public.turnos t on t.paciente_id = p.id
group by p.id, p.nombre, p.dni, p.cobertura, p.score_noshow
having count(t.id) filter (where t.estado = 'No Show') > 0
order by noshow_count desc, pct_noshow desc;

grant select on public.v_rep_noshow_pacientes to authenticated;

-- ============================================================
--  REPORTE 6 — Pacientes activos / inactivos
-- ============================================================
create or replace view public.v_rep_pacientes_estado as
select
  p.id                                                                  as paciente_id,
  p.nombre                                                              as paciente_nombre,
  p.dni,
  p.cobertura,
  p.estado,
  p.score_noshow,
  p.deuda,
  p.created_at                                                          as fecha_alta,
  (
    select max(fecha) from public.turnos
    where paciente_id = p.id and estado = 'Finalizado'
  )                                                                     as ultimo_turno,
  (
    select count(*) from public.turnos
    where paciente_id = p.id and estado = 'Finalizado'
  )                                                                     as sesiones_realizadas,
  (
    select count(*) from public.turnos
    where paciente_id = p.id
      and fecha >= current_date
      and estado in ('Pendiente','Confirmado')
  )                                                                     as turnos_futuros,
  case
    when p.estado = 'Inactivo' then 'Inactivo'
    when (select max(fecha) from public.turnos
          where paciente_id = p.id and estado = 'Finalizado') is null
      then 'Sin sesiones'
    when (select max(fecha) from public.turnos
          where paciente_id = p.id and estado = 'Finalizado')
         < current_date - interval '90 days'
      then 'Sin actividad reciente'
    else 'Activo'
  end                                                                   as situacion
from public.pacientes p
order by p.created_at desc;

grant select on public.v_rep_pacientes_estado to authenticated;

-- ============================================================
--  Resumen del KPI dashboard (compatible con BI tools)
-- ============================================================
create or replace view public.v_rep_kpi_diario as
with hoy as (
  select
    current_date                                                  as fecha,
    count(*) filter (where t.fecha = current_date)                as turnos_hoy,
    count(*) filter (where t.fecha = current_date and t.estado = 'Finalizado') as turnos_hoy_finalizados,
    count(*) filter (where t.fecha = current_date and t.estado = 'No Show')    as turnos_hoy_noshow,
    count(*) filter (where t.fecha = current_date and t.estado = 'Confirmado') as turnos_hoy_confirmados
  from public.turnos t
)
select
  hoy.fecha,
  hoy.turnos_hoy,
  hoy.turnos_hoy_finalizados,
  hoy.turnos_hoy_noshow,
  hoy.turnos_hoy_confirmados,
  (select count(*) from public.pacientes where estado = 'Activo')          as pacientes_activos,
  (select count(*) from public.profesionales where activo = true)          as profesionales_activos,
  (select count(*) from public.consultorios where estado = 'libre')        as consultorios_libres
from hoy;

grant select on public.v_rep_kpi_diario to authenticated;
