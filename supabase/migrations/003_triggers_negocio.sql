-- ============================================================
--  RehabMed ERP — Triggers de negocio (P2.1)
--  Ejecutar DESPUÉS de 002_rls_policies.sql
--
--  Implementa: auto-consumo de sesiones de autorización
--  cuando un turno pasa a 'Finalizado'.
--
--  Comportamiento:
--   • Idempotente: solo cuenta una vez por transición a Finalizado
--   • Reversible:  si Finalizado → otro estado, restituye la sesión
--   • Defensivo:   si no hay autorización vinculada o ya está al
--                  máximo, NO bloquea la finalización (la sesión
--                  ya se realizó, el turno debe poder finalizarse)
--   • Match:       prioriza turno.numero_autorizacion exacto;
--                  fallback a la primera autorización Aprobada
--                  del paciente con sesiones disponibles
--   • Audit:       deja un log en RAISE NOTICE para debugging
--
--  Seguridad: las funciones son SECURITY DEFINER para esquivar
--  RLS — el profesional que finaliza un turno no tiene permiso
--  para escribir en autorizaciones, pero el trigger sí debe.
-- ============================================================

-- ── Helper: encontrar autorización candidata para un turno ────
-- Devuelve el id de la autorización a consumir, o NULL si no hay match.
create or replace function public._buscar_autorizacion_para_turno(
  p_paciente_id uuid,
  p_numero_autorizacion text
)
returns uuid
language plpgsql
security definer
stable
as $$
declare
  v_id uuid;
begin
  -- 1) Si el turno trae número de autorización, matchear exacto
  if p_numero_autorizacion is not null and length(trim(p_numero_autorizacion)) > 0 then
    select id into v_id
    from public.autorizaciones
    where paciente_id = p_paciente_id
      and numero      = p_numero_autorizacion
      and estado      = 'Aprobada'
      and sesiones_usadas < sesiones_auth
    order by fecha_solicitud desc
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 2) Fallback: primera autorización Aprobada del paciente con cupo
  --    Prioriza la que vence antes (para consumir las que están por vencer)
  select id into v_id
  from public.autorizaciones
  where paciente_id = p_paciente_id
    and estado      = 'Aprobada'
    and sesiones_usadas < sesiones_auth
  order by
    coalesce(fecha_vencimiento, '9999-12-31'::date) asc,
    fecha_solicitud asc
  limit 1;

  return v_id;   -- puede ser NULL si no hay ninguna
end;
$$;

comment on function public._buscar_autorizacion_para_turno(uuid, text) is
  'Encuentra la autorización candidata a consumir cuando un turno se finaliza.
   Prioriza match exacto por numero_autorizacion; fallback a la próxima a vencer.';


-- ── Función principal: consumir/restituir sesión ──────────────
create or replace function public.sync_autorizacion_por_turno()
returns trigger
language plpgsql
security definer
as $$
declare
  v_autorizacion_id uuid;
  v_paciente_nombre text;
begin
  -- ============================================================
  --  Caso 1: transición A → 'Finalizado' (consumir sesión)
  -- ============================================================
  if NEW.estado = 'Finalizado' and (OLD.estado is distinct from 'Finalizado') then

    v_autorizacion_id := public._buscar_autorizacion_para_turno(
      NEW.paciente_id,
      NEW.numero_autorizacion
    );

    if v_autorizacion_id is not null then
      update public.autorizaciones
        set sesiones_usadas = sesiones_usadas + 1,
            updated_at      = now()
      where id = v_autorizacion_id
        and sesiones_usadas < sesiones_auth;   -- guard contra carrera
      raise notice '[autorizaciones] Consumida 1 sesión de autorización %, turno %',
        v_autorizacion_id, NEW.id;
    else
      -- No bloqueamos la finalización; solo dejamos rastro
      select nombre into v_paciente_nombre
        from public.pacientes where id = NEW.paciente_id;
      raise notice '[autorizaciones] Turno % finalizado sin autorización vinculada (paciente %, num=%)',
        NEW.id, coalesce(v_paciente_nombre, NEW.paciente_id::text), NEW.numero_autorizacion;
    end if;

    return NEW;
  end if;

  -- ============================================================
  --  Caso 2: transición 'Finalizado' → otro estado (restituir)
  -- ============================================================
  if OLD.estado = 'Finalizado' and (NEW.estado is distinct from 'Finalizado') then

    v_autorizacion_id := public._buscar_autorizacion_para_turno(
      NEW.paciente_id,
      NEW.numero_autorizacion
    );

    -- Para restituir, buscamos también autorizaciones que YA tengan al menos 1 sesión usada
    -- (la búsqueda anterior puede no devolver nada si la autorización ya se consumió toda).
    -- Si no encontramos por la búsqueda primaria, ampliamos:
    if v_autorizacion_id is null and NEW.numero_autorizacion is not null then
      select id into v_autorizacion_id
        from public.autorizaciones
        where paciente_id = NEW.paciente_id
          and numero      = NEW.numero_autorizacion
          and sesiones_usadas > 0
        order by fecha_solicitud desc
        limit 1;
    end if;

    if v_autorizacion_id is not null then
      update public.autorizaciones
        set sesiones_usadas = greatest(sesiones_usadas - 1, 0),
            updated_at      = now()
      where id = v_autorizacion_id
        and sesiones_usadas > 0;
      raise notice '[autorizaciones] Restituida 1 sesión a autorización % (turno % salió de Finalizado)',
        v_autorizacion_id, NEW.id;
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.sync_autorizacion_por_turno() is
  'Mantiene sesiones_usadas de autorizaciones sincronizado con turnos en estado Finalizado.
   Idempotente y reversible. SECURITY DEFINER para esquivar RLS.';


-- ── Trigger sobre turnos ──────────────────────────────────────
drop trigger if exists trg_turnos_sync_autorizacion on public.turnos;

create trigger trg_turnos_sync_autorizacion
  after update of estado on public.turnos
  for each row
  when (OLD.estado is distinct from NEW.estado)
  execute function public.sync_autorizacion_por_turno();


-- ── Manejo de DELETE: si un turno Finalizado se elimina ──────
-- Restituye la sesión al eliminar.
create or replace function public.sync_autorizacion_por_turno_delete()
returns trigger
language plpgsql
security definer
as $$
declare
  v_autorizacion_id uuid;
begin
  if OLD.estado = 'Finalizado' then
    -- Buscar autorización candidata para restituir
    if OLD.numero_autorizacion is not null then
      select id into v_autorizacion_id
        from public.autorizaciones
        where paciente_id = OLD.paciente_id
          and numero      = OLD.numero_autorizacion
          and sesiones_usadas > 0
        order by fecha_solicitud desc
        limit 1;
    end if;

    if v_autorizacion_id is null then
      select id into v_autorizacion_id
        from public.autorizaciones
        where paciente_id = OLD.paciente_id
          and sesiones_usadas > 0
        order by fecha_solicitud desc
        limit 1;
    end if;

    if v_autorizacion_id is not null then
      update public.autorizaciones
        set sesiones_usadas = greatest(sesiones_usadas - 1, 0),
            updated_at      = now()
      where id = v_autorizacion_id
        and sesiones_usadas > 0;
      raise notice '[autorizaciones] Restituida 1 sesión por eliminación de turno % (estaba Finalizado)', OLD.id;
    end if;
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_turnos_sync_autorizacion_delete on public.turnos;

create trigger trg_turnos_sync_autorizacion_delete
  after delete on public.turnos
  for each row
  execute function public.sync_autorizacion_por_turno_delete();


-- ============================================================
--  P2.2 — AUTO-UPDATE de score_noshow del paciente
-- ============================================================
--  Reglas:
--    Turno → 'No Show'      → score -10  (mala señal fuerte)
--    Turno → 'Confirmado'   → score +2   (confirma asistencia)
--
--  Idempotencia: solo aplica en la TRANSICIÓN al estado.
--                Editar otros campos de un turno ya 'No Show'
--                no resta de nuevo.
--
--  Reversión:    si un 'No Show' se cambia a otro estado,
--                se RESTITUYEN los 10 puntos.
--                Si un 'Confirmado' se cambia, se restituyen
--                los 2 puntos.
--
--  Clamp:        score se mantiene en [0, 100] (CHECK constraint
--                de la tabla pacientes).
-- ============================================================

create or replace function public.sync_score_noshow_por_turno()
returns trigger
language plpgsql
security definer
as $$
declare
  v_delta int := 0;
begin
  -- Calcular el delta neto de la transición
  -- (puede ser que cambie de Confirmado a No Show: -2 -10 = -12)

  -- Salida del estado anterior: revertir su efecto
  if OLD.estado = 'No Show'    then v_delta := v_delta + 10; end if;
  if OLD.estado = 'Confirmado' then v_delta := v_delta -  2; end if;

  -- Entrada al estado nuevo: aplicar su efecto
  if NEW.estado = 'No Show'    then v_delta := v_delta - 10; end if;
  if NEW.estado = 'Confirmado' then v_delta := v_delta +  2; end if;

  if v_delta <> 0 then
    update public.pacientes
      set score_noshow = greatest(0, least(100, score_noshow + v_delta)),
          updated_at   = now()
      where id = NEW.paciente_id;

    raise notice '[score_noshow] Paciente % delta=% (% → %)',
      NEW.paciente_id, v_delta, OLD.estado, NEW.estado;
  end if;

  return NEW;
end;
$$;

comment on function public.sync_score_noshow_por_turno() is
  'Mantiene pacientes.score_noshow sincronizado con transiciones de turnos.
   No Show: -10, Confirmado: +2. Reversible y clamp 0..100.';

drop trigger if exists trg_turnos_sync_score on public.turnos;

create trigger trg_turnos_sync_score
  after update of estado on public.turnos
  for each row
  when (OLD.estado is distinct from NEW.estado)
  execute function public.sync_score_noshow_por_turno();


-- ============================================================
--  TESTS rápidos (comentados — descomentar para verificar)
-- ============================================================
-- Pre-requisitos para los tests: tener al menos 1 paciente, 1 profesional,
-- 1 consultorio y 1 autorización Aprobada con sesiones disponibles.
--
-- -- 1. Crear un turno y finalizarlo → debe incrementar sesiones_usadas
-- with t as (
--   insert into public.turnos (
--     fecha, hora, paciente_id, profesional_id, consultorio_id,
--     especialidad, estado
--   )
--   select current_date, '10:00', p.id, pr.id, 1, 'Test', 'Confirmado'
--   from public.pacientes p, public.profesionales pr
--   limit 1
--   returning id, paciente_id
-- )
-- select 'Antes:' as paso,
--        sum(sesiones_usadas) as total_usadas
-- from public.autorizaciones a
-- where a.paciente_id = (select paciente_id from t);
--
-- -- Ejecutar después:
-- update public.turnos set estado='Finalizado' where id = '<id_del_turno>';
-- select 'Después:' as paso,
--        sum(sesiones_usadas) as total_usadas
-- from public.autorizaciones a
-- where a.paciente_id = '<paciente_id>';
--
-- -- 2. Revertir: Finalizado → Confirmado debe restar
-- update public.turnos set estado='Confirmado' where id = '<id_del_turno>';
--
-- -- 3. Re-finalizar: vuelve a sumar
-- update public.turnos set estado='Finalizado' where id = '<id_del_turno>';
--
-- -- 4. Eliminar el turno Finalizado: debe restituir
-- delete from public.turnos where id = '<id_del_turno>';

-- ─── Tests de score_noshow ────────────────────────────────────
-- -- 5. score parte en 100 (default), después No Show → 90
-- select score_noshow from public.pacientes where id = '<paciente_id>';
-- update public.turnos set estado = 'No Show' where id = '<id_del_turno>';
-- select score_noshow from public.pacientes where id = '<paciente_id>';   -- → 90
--
-- -- 6. Volver a Confirmado: restituye los 10 y suma 2 → 102, clampa a 100
-- update public.turnos set estado = 'Confirmado' where id = '<id_del_turno>';
-- select score_noshow from public.pacientes where id = '<paciente_id>';   -- → 100
--
-- -- 7. Confirmado → No Show: -2 (reverso) -10 = -12 → 88
-- update public.turnos set estado = 'No Show' where id = '<id_del_turno>';
-- select score_noshow from public.pacientes where id = '<paciente_id>';   -- → 88
