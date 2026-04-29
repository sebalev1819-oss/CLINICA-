-- ============================================================
--  RehabMed ERP — Vistas pre-agregadas para Dashboard (P3.1)
--  Ejecutar DESPUÉS de 006_validacion_fechas.sql
--
--  Vistas:
--    v_dashboard_stats         — KPIs principales (1 fila)
--    v_turnos_por_dia          — últimos 30 días
--    v_distribucion_coberturas — % de turnos por obra social (mes actual)
--    v_noshow_por_dia          — no-show absoluto y % por día (últimos 7 días)
--    v_ranking_profesionales   — ranking de turnos finalizados (mes actual)
--
--  Todas heredan RLS de las tablas base (turnos, pacientes, etc.)
-- ============================================================

-- ── 1. KPIs principales (1 fila) ─────────────────────────────
create or replace view public.v_dashboard_stats as
select
  -- Turnos hoy
  (select count(*) from public.turnos where fecha = current_date)
    as turnos_hoy_total,
  (select count(*) from public.turnos
    where fecha = current_date
      and estado in ('Confirmado', 'En curso', 'Finalizado'))
    as turnos_hoy_realizados,
  (select count(*) from public.turnos
    where fecha = current_date
      and estado = 'No Show')
    as turnos_hoy_noshow,

  -- Mes actual
  (select count(*) from public.turnos
    where fecha >= date_trunc('month', current_date)
      and fecha <= current_date)
    as turnos_mes_total,
  (select count(*) from public.turnos
    where fecha >= date_trunc('month', current_date)
      and fecha <= current_date
      and estado = 'Finalizado')
    as sesiones_mes_realizadas,
  (select count(*) from public.turnos
    where fecha >= date_trunc('month', current_date)
      and fecha <= current_date
      and estado = 'No Show')
    as turnos_mes_noshow,

  -- No-show rate del mes (en porcentaje, 0-100)
  case
    when (select count(*) from public.turnos
          where fecha >= date_trunc('month', current_date)
            and fecha <= current_date) > 0
    then round(
      (select count(*)::numeric from public.turnos
        where fecha >= date_trunc('month', current_date)
          and fecha <= current_date
          and estado = 'No Show')
      /
      (select count(*) from public.turnos
        where fecha >= date_trunc('month', current_date)
          and fecha <= current_date)
      * 100, 1)
    else 0
  end as noshow_rate_mes_pct,

  -- Pacientes
  (select count(*) from public.pacientes where estado = 'Activo')
    as pacientes_activos,
  (select count(*) from public.pacientes where estado = 'Nuevo')
    as pacientes_nuevos,
  (select count(*) from public.pacientes
    where created_at >= date_trunc('month', current_date))
    as pacientes_alta_mes,

  -- Consultorios (instantáneo)
  (select count(*) from public.consultorios where estado = 'ocupado')
    as consultorios_ocupados,
  (select count(*) from public.consultorios where estado = 'libre')
    as consultorios_libres,
  (select count(*) from public.consultorios where estado = 'limpieza')
    as consultorios_limpieza,
  (select count(*) from public.consultorios)
    as consultorios_total,

  -- Autorizaciones críticas (cantidad en alerta)
  (select count(*) from public.v_autorizaciones_criticas)
    as autorizaciones_criticas,

  -- Stock crítico (insumos por debajo del mínimo)
  (select count(*) from public.insumos
    where activo = true and stock_actual < stock_minimo)
    as insumos_criticos
;

comment on view public.v_dashboard_stats is
  'KPIs principales del dashboard. Una sola fila con todos los contadores.';

grant select on public.v_dashboard_stats to authenticated;


-- ── 2. Turnos por día (últimos 30) ───────────────────────────
create or replace view public.v_turnos_por_dia as
with dias as (
  select generate_series(
    current_date - interval '29 days',
    current_date,
    '1 day'::interval
  )::date as fecha
)
select
  d.fecha,
  to_char(d.fecha, 'TMDy DD') as fecha_label,
  coalesce(count(t.id) filter (where t.estado = 'Finalizado'), 0)::int as finalizados,
  coalesce(count(t.id) filter (where t.estado = 'No Show'), 0)::int    as noshow,
  coalesce(count(t.id) filter (where t.estado = 'Cancelado'), 0)::int  as cancelados,
  coalesce(count(t.id), 0)::int as total
from dias d
left join public.turnos t on t.fecha = d.fecha
group by d.fecha
order by d.fecha;

comment on view public.v_turnos_por_dia is
  '30 días con conteo de turnos por estado. Para chart de tendencia.';

grant select on public.v_turnos_por_dia to authenticated;


-- ── 3. Distribución por cobertura (mes actual) ───────────────
create or replace view public.v_distribucion_coberturas as
select
  coalesce(t.cobertura, p.cobertura, 'Sin especificar') as cobertura,
  count(*)::int as cantidad,
  round(
    count(*)::numeric * 100.0
    / nullif((select count(*) from public.turnos
              where fecha >= date_trunc('month', current_date)
                and fecha <= current_date), 0),
    1
  ) as porcentaje
from public.turnos t
join public.pacientes p on p.id = t.paciente_id
where t.fecha >= date_trunc('month', current_date)
  and t.fecha <= current_date
group by coalesce(t.cobertura, p.cobertura, 'Sin especificar')
order by cantidad desc;

comment on view public.v_distribucion_coberturas is
  '% de turnos por obra social en el mes actual. Para chart de coberturas.';

grant select on public.v_distribucion_coberturas to authenticated;


-- ── 4. No-Show por día (últimos 7 días) ──────────────────────
create or replace view public.v_noshow_por_dia as
with dias as (
  select generate_series(
    current_date - interval '6 days',
    current_date,
    '1 day'::interval
  )::date as fecha
)
select
  d.fecha,
  to_char(d.fecha, 'TMDy') as fecha_label,
  coalesce(count(t.id) filter (where t.estado = 'No Show'), 0)::int as noshow,
  coalesce(count(t.id), 0)::int as total,
  case
    when count(t.id) > 0
    then round(
      (count(t.id) filter (where t.estado = 'No Show'))::numeric
      / count(t.id) * 100, 1)
    else 0
  end as porcentaje
from dias d
left join public.turnos t on t.fecha = d.fecha
group by d.fecha
order by d.fecha;

comment on view public.v_noshow_por_dia is
  'Últimos 7 días: no-show absoluto y porcentual por día.';

grant select on public.v_noshow_por_dia to authenticated;


-- ── 5. Ranking de profesionales (mes actual) ─────────────────
create or replace view public.v_ranking_profesionales as
select
  pr.id,
  pr.nombre,
  pr.especialidad,
  pr.iniciales,
  count(t.id) filter (where t.estado = 'Finalizado')::int as turnos_finalizados,
  count(t.id) filter (where t.estado = 'No Show')::int    as turnos_noshow,
  count(t.id)::int as turnos_total_mes,
  case
    when count(t.id) > 0
    then round(
      (count(t.id) filter (where t.estado = 'No Show'))::numeric
      / count(t.id) * 100, 1)
    else 0
  end as noshow_rate_pct
from public.profesionales pr
left join public.turnos t
  on t.profesional_id = pr.id
 and t.fecha >= date_trunc('month', current_date)
 and t.fecha <= current_date
where pr.activo = true
group by pr.id, pr.nombre, pr.especialidad, pr.iniciales
order by turnos_finalizados desc, pr.nombre;

comment on view public.v_ranking_profesionales is
  'Ranking de profesionales por turnos finalizados en el mes actual.';

grant select on public.v_ranking_profesionales to authenticated;


-- ── 6. Actividad reciente (últimas 10 entradas del audit) ────
-- Útil para feed de "Últimas acciones" en el dashboard.
-- Solo admin puede ver (heredado de RLS de audit_log).
create or replace view public.v_actividad_reciente as
select
  al.id,
  al.created_at,
  al.tabla,
  al.accion,
  al.usuario_email,
  al.usuario_rol,
  al.campos_cambiados,
  -- Etiqueta amigable
  case
    when al.tabla = 'turnos' and al.accion = 'INSERT'      then '📅 Nuevo turno'
    when al.tabla = 'turnos' and al.accion = 'UPDATE'      then '✏️ Turno modificado'
    when al.tabla = 'turnos' and al.accion = 'DELETE'      then '🗑️ Turno eliminado'
    when al.tabla = 'pacientes' and al.accion = 'INSERT'   then '👤 Nuevo paciente'
    when al.tabla = 'pacientes' and al.accion = 'UPDATE'   then '✏️ Paciente actualizado'
    when al.tabla = 'evoluciones' and al.accion = 'INSERT' then '📝 Nueva evolución'
    when al.tabla = 'evoluciones' and al.accion = 'UPDATE' then '✏️ Evolución modificada'
    when al.tabla = 'autorizaciones' and al.accion = 'INSERT' then '📋 Nueva autorización'
    when al.tabla = 'autorizaciones' and al.accion = 'UPDATE' then '✏️ Autorización modificada'
    else al.accion || ' en ' || al.tabla
  end as etiqueta
from public.audit_log al
order by al.created_at desc
limit 10;

grant select on public.v_actividad_reciente to authenticated;


-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- select * from public.v_dashboard_stats;
-- select * from public.v_turnos_por_dia limit 30;
-- select * from public.v_distribucion_coberturas;
-- select * from public.v_noshow_por_dia;
-- select * from public.v_ranking_profesionales;
-- select * from public.v_actividad_reciente;
