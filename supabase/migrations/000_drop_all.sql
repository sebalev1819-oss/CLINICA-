-- ============================================================
--  RehabMed ERP — Limpieza completa (reset)
--  Ejecutar SOLO si necesitás empezar desde cero
--  IMPORTANTE: borra todos los datos existentes
-- ============================================================

-- Triggers
drop trigger if exists on_auth_user_created         on auth.users;
drop trigger if exists trg_profiles_updated_at      on public.profiles;
drop trigger if exists trg_consultorios_updated_at  on public.consultorios;
drop trigger if exists trg_pacientes_updated_at     on public.pacientes;
drop trigger if exists trg_turnos_updated_at        on public.turnos;
drop trigger if exists trg_autorizaciones_updated_at on public.autorizaciones;
drop trigger if exists trg_insumos_updated_at       on public.insumos;

-- Funciones
drop function if exists public.handle_new_user()  cascade;
drop function if exists public.set_updated_at()   cascade;
drop function if exists public.mi_rol()            cascade;

-- Tablas (en orden inverso por foreign keys)
drop table if exists public.movimientos_stock   cascade;
drop table if exists public.insumos             cascade;
drop table if exists public.archivos_clinicos   cascade;
drop table if exists public.evoluciones         cascade;
drop table if exists public.autorizaciones      cascade;
drop table if exists public.lista_espera        cascade;
drop table if exists public.turnos              cascade;
drop table if exists public.pacientes           cascade;
drop table if exists public.profesionales       cascade;
drop table if exists public.consultorios        cascade;
drop table if exists public.profiles            cascade;

-- Tipos ENUM
drop type if exists public.estado_autorizacion  cascade;
drop type if exists public.estado_paciente      cascade;
drop type if exists public.tipo_profesional     cascade;
drop type if exists public.tipo_turno           cascade;
drop type if exists public.estado_consultorio   cascade;
drop type if exists public.estado_turno         cascade;
drop type if exists public.rol_usuario          cascade;

-- Vistas
drop view if exists public.v_turnos_dia              cascade;
drop view if exists public.v_autorizaciones_criticas cascade;
