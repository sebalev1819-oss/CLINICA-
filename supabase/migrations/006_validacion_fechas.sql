-- ============================================================
--  RehabMed ERP — Validación de fechas en turnos (P2.5)
--  Ejecutar DESPUÉS de 005_audit_log.sql
--
--  Reglas:
--    1. INSERT: la fecha del turno debe ser >= hoy
--    2. UPDATE: si cambió la fecha, la nueva debe ser >= hoy
--               (permite editar otros campos de turnos pasados:
--                cambiar estado a Finalizado, agregar notas, etc.)
--    3. INSERT/UPDATE: la fecha no puede ser más de 1 año en el futuro
--                     (probable typo de captura)
--
--  Por qué BEFORE trigger en lugar de CHECK constraint:
--    Un CHECK constraint de "fecha >= current_date" rompe en
--    UPDATE de turnos pasados (no podrías cambiar el estado de
--    un turno de ayer). El trigger BEFORE permite distinguir
--    INSERT de UPDATE y solo restringe cuando la fecha cambia.
-- ============================================================

create or replace function public.validar_fecha_turno()
returns trigger
language plpgsql
as $$
declare
  v_max_futuro_dias int := 365;
begin
  -- Configurable por DBA si querés cambiar el límite:
  --   alter database postgres set rehabmed.max_dias_futuro_turno = '180';
  begin
    v_max_futuro_dias := coalesce(
      current_setting('rehabmed.max_dias_futuro_turno', true)::int,
      365
    );
  exception when others then
    v_max_futuro_dias := 365;
  end;

  -- ── Caso INSERT ────────────────────────────────────────────
  if TG_OP = 'INSERT' then
    if NEW.fecha < current_date then
      raise exception
        'No se puede crear un turno con fecha pasada (fecha=%, hoy=%). Si necesitás cargar histórico, hacelo con una migración admin.',
        NEW.fecha, current_date
        using errcode = '22023';   -- invalid_parameter_value
    end if;

    if NEW.fecha > current_date + (v_max_futuro_dias || ' days')::interval then
      raise exception
        'Fecha del turno demasiado lejana (% > % días en el futuro). ¿Es un typo? Si no, ajustá rehabmed.max_dias_futuro_turno.',
        NEW.fecha, v_max_futuro_dias
        using errcode = '22023';
    end if;
  end if;

  -- ── Caso UPDATE ────────────────────────────────────────────
  if TG_OP = 'UPDATE' then
    -- Solo validamos si la fecha realmente cambió
    if NEW.fecha is distinct from OLD.fecha then
      if NEW.fecha < current_date then
        raise exception
          'No se puede mover un turno a una fecha pasada (nueva=%, hoy=%). Cancelar y crear uno nuevo si es necesario.',
          NEW.fecha, current_date
          using errcode = '22023';
      end if;

      if NEW.fecha > current_date + (v_max_futuro_dias || ' days')::interval then
        raise exception
          'Fecha demasiado lejana (% > % días). Verificá si es un typo.',
          NEW.fecha, v_max_futuro_dias
          using errcode = '22023';
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.validar_fecha_turno() is
  'Valida que turnos.fecha esté entre hoy y +1 año (configurable).
   Permite editar turnos pasados (no cambiar la fecha).';

drop trigger if exists trg_turnos_validar_fecha on public.turnos;

create trigger trg_turnos_validar_fecha
  before insert or update of fecha on public.turnos
  for each row
  execute function public.validar_fecha_turno();


-- ============================================================
--  Bonus: validar que la hora tenga formato razonable
--  (evita typos como '25:00' que postgres acepta como 25 horas)
-- ============================================================
-- (Ya está cubierto por el tipo `time` que rechaza horas inválidas
--  como '25:00' por sintaxis. No hace falta trigger adicional.)


-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Intentar crear turno con fecha pasada → debe fallar
-- insert into public.turnos (
--   fecha, hora, paciente_id, profesional_id, consultorio_id, especialidad
-- )
-- select '2020-01-01', '10:00', p.id, pr.id, 1, 'Test'
-- from public.pacientes p, public.profesionales pr
-- limit 1;
-- -- ERROR: No se puede crear un turno con fecha pasada
--
-- -- 2. Crear turno futuro → OK
-- insert into public.turnos (
--   fecha, hora, paciente_id, profesional_id, consultorio_id, especialidad
-- )
-- select current_date + 7, '10:00', p.id, pr.id, 1, 'Test'
-- from public.pacientes p, public.profesionales pr
-- limit 1;
--
-- -- 3. Editar otro campo de un turno pasado (después de avanzar la fecha) → OK
-- update public.turnos
-- set estado = 'Finalizado', notas = 'Test post-fechita'
-- where id = '<id_de_turno_existente>';
--
-- -- 4. Mover turno a fecha pasada → debe fallar
-- update public.turnos set fecha = '2020-01-01' where id = '<id>';
-- -- ERROR: No se puede mover un turno a una fecha pasada
--
-- -- 5. Crear turno a 2 años → debe fallar
-- insert into public.turnos (
--   fecha, hora, paciente_id, profesional_id, consultorio_id, especialidad
-- )
-- select current_date + interval '2 years', '10:00', p.id, pr.id, 1, 'Test'
-- from public.pacientes p, public.profesionales pr
-- limit 1;
-- -- ERROR: Fecha del turno demasiado lejana

-- -- 6. Override del límite a 6 meses (180 días)
-- alter database postgres set rehabmed.max_dias_futuro_turno = '180';
-- (recordá hacer reset cuando termines el override)
