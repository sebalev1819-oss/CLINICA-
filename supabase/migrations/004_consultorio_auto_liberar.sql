-- ============================================================
--  RehabMed ERP — Auto-liberación de consultorios (P2.3)
--  Ejecutar DESPUÉS de 003_triggers_negocio.sql
--
--  Flujo:
--    Turno → 'Finalizado'
--      → Trigger SQL pone consultorio.estado = 'limpieza'
--                    y consultorio.limpieza_hasta = now() + 15 min
--      → Función liberar_consultorios_expirados() (llamada por
--        el cliente cada 60s, o por pg_cron si está habilitado)
--        revierte a 'libre' los que ya cumplieron el plazo
-- ============================================================

-- ── 1. Agregar columna limpieza_hasta ────────────────────────
alter table public.consultorios
  add column if not exists limpieza_hasta timestamptz;

comment on column public.consultorios.limpieza_hasta is
  'Cuando estado=''limpieza'', momento estimado en que vuelve a libre.
   Una función auto-libera los que pasaron de este tiempo.';

-- ── 2. Configuración: cuántos minutos dura la limpieza ────────
-- (Si querés cambiarlo después, sin redeploy de SQL,
--  podés overridear con: alter database <db> set rehabmed.limpieza_min = '20';)
do $$
begin
  -- Establecer el default solo si no existe
  perform 1 from pg_settings where name = 'rehabmed.limpieza_min';
  -- Como pg_settings no muestra custom GUCs no seteados, igual lo seteamos
  perform set_config('rehabmed.limpieza_min', '15', false);
exception when others then null;
end $$;


-- ── 3. Trigger: turno → Finalizado pone consultorio en limpieza ──
create or replace function public.consultorio_a_limpieza()
returns trigger
language plpgsql
security definer
as $$
declare
  v_min int;
begin
  -- Solo aplica en la transición a Finalizado
  if NEW.estado = 'Finalizado' and (OLD.estado is distinct from 'Finalizado') then
    -- Leer minutos de limpieza desde GUC, default 15
    begin
      v_min := coalesce(current_setting('rehabmed.limpieza_min', true)::int, 15);
    exception when others then
      v_min := 15;
    end;

    update public.consultorios
      set estado          = 'limpieza',
          limpieza_hasta  = now() + (v_min || ' minutes')::interval,
          updated_at      = now()
      where id = NEW.consultorio_id
        and estado <> 'mantenimiento';   -- nunca pisar mantenimiento

    raise notice '[consultorio] C% → limpieza por % min (turno %)',
      NEW.consultorio_id, v_min, NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_turnos_consultorio_limpieza on public.turnos;

create trigger trg_turnos_consultorio_limpieza
  after update of estado on public.turnos
  for each row
  when (OLD.estado is distinct from NEW.estado)
  execute function public.consultorio_a_limpieza();


-- ── 4. Función para liberar consultorios cuya limpieza venció ──
-- Esta función es la que llama el cliente periódicamente, o pg_cron.
-- Devuelve la cantidad de consultorios liberados.
create or replace function public.liberar_consultorios_expirados()
returns int
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  with liberados as (
    update public.consultorios
      set estado         = 'libre',
          limpieza_hasta = null,
          updated_at     = now()
      where estado          = 'limpieza'
        and limpieza_hasta  is not null
        and limpieza_hasta  <= now()
      returning id
  )
  select count(*) into v_count from liberados;

  if v_count > 0 then
    raise notice '[consultorio] Liberados % consultorios tras limpieza', v_count;
  end if;
  return v_count;
end;
$$;

comment on function public.liberar_consultorios_expirados() is
  'Cambia consultorios estado=limpieza con limpieza_hasta vencido a estado=libre.
   Llamar periódicamente desde el cliente (cada 60s) o desde pg_cron.';

-- Permitir que cualquier usuario autenticado llame esta función
-- (la lógica interna está protegida por SECURITY DEFINER + filtro WHERE)
grant execute on function public.liberar_consultorios_expirados() to authenticated;


-- ── 5. SETUP OPCIONAL: pg_cron (solo en plan Pro de Supabase) ─
-- Si tenés pg_cron habilitado, descomentá las siguientes líneas
-- para que la liberación corra automáticamente cada minuto sin
-- depender de que algún cliente tenga el ERP abierto.
--
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'liberar-consultorios-cada-minuto',
--   '* * * * *',
--   $$select public.liberar_consultorios_expirados();$$
-- );
--
-- Para listar jobs activos:
--   select jobid, jobname, schedule, command from cron.job;
--
-- Para desactivar:
--   select cron.unschedule('liberar-consultorios-cada-minuto');


-- ── 6. Vista útil: consultorios con tiempo restante de limpieza ─
create or replace view public.v_consultorios_estado as
select
  c.id,
  c.nombre,
  c.especialidad,
  c.estado,
  c.profesional_id,
  c.limpieza_hasta,
  case
    when c.estado = 'limpieza' and c.limpieza_hasta is not null
      then greatest(0, extract(epoch from (c.limpieza_hasta - now()))::int)
    else null
  end as segundos_restantes_limpieza,
  c.updated_at
from public.consultorios c;

comment on view public.v_consultorios_estado is
  'Estado de consultorios con segundos restantes de limpieza (útil para UI countdown).';

grant select on public.v_consultorios_estado to authenticated;


-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Override de minutos para testear (1 min en vez de 15)
-- alter database postgres set rehabmed.limpieza_min = '1';
-- -- (después: alter database postgres reset rehabmed.limpieza_min;)
--
-- -- 2. Finalizar un turno → consultorio queda en limpieza
-- update public.turnos set estado = 'Finalizado' where id = '<id_turno>';
-- select id, estado, limpieza_hasta from public.consultorios where id = <id_consultorio>;
--
-- -- 3. Esperar 1 minuto + 5 segundos, después llamar la función
-- select public.liberar_consultorios_expirados();    -- debería devolver 1
-- select id, estado, limpieza_hasta from public.consultorios where id = <id_consultorio>;
-- -- → estado = 'libre', limpieza_hasta = NULL
--
-- -- 4. Ver tiempo restante en la vista
-- select * from public.v_consultorios_estado where estado = 'limpieza';
