-- ============================================================
--  RehabMed ERP — Email en profiles + helpers de admin
-- ============================================================
--  Agrega:
--  1. columna email en profiles (se popula desde auth.users)
--  2. trigger actualizado para que copie el email al crear perfil
--  3. backfill de emails para los perfiles existentes
--  4. funcion admin_listar_usuarios(): vista segura para admin
-- ============================================================

-- 1. Columna email
alter table public.profiles add column if not exists email text;

create index if not exists idx_profiles_email on public.profiles(email);

-- 2. Trigger handle_new_user actualizado (copia email)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre, iniciales, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'iniciales', upper(left(new.email, 2))),
    coalesce((new.raw_user_meta_data->>'rol')::rol_usuario, 'recepcion')
  );
  return new;
end;
$$;

-- 3. Backfill: copia emails de auth.users a profiles.email (para perfiles existentes)
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- 4. Policy SELECT para admin: ver todos los perfiles (ya existe en 002 pero la repito
--    idempotente por si ejecutan esto standalone)
-- La policy "profiles: admin ve todos" ya existe y permite SELECT con mi_rol()='admin'.
--    Reusamos esa.

-- 5. Funcion para cambiar rol / activo desde la UI (solo admin)
--    Alternativa mas segura que hacer UPDATE directo: fuerza validacion
--    en el backend.
create or replace function public.admin_actualizar_usuario(
  p_user_id uuid,
  p_rol     rol_usuario default null,
  p_activo  boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.profiles;
begin
  -- Solo admin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo el administrador puede actualizar usuarios';
  end if;

  -- No permitir que admin se auto-desactive (evita lockout)
  if p_user_id = auth.uid() and p_activo = false then
    raise exception 'No podes desactivar tu propio usuario';
  end if;

  -- No permitir que admin se quite a si mismo el rol admin
  if p_user_id = auth.uid() and p_rol is not null and p_rol <> 'admin' then
    raise exception 'No podes cambiar tu propio rol de admin';
  end if;

  update public.profiles
  set rol    = coalesce(p_rol, rol),
      activo = coalesce(p_activo, activo)
  where id = p_user_id
  returning * into v_result;

  if v_result is null then
    raise exception 'Usuario % no encontrado', p_user_id;
  end if;

  return v_result;
end;
$$;

-- Permisos: cualquier usuario autenticado puede llamar; el control esta adentro
grant execute on function public.admin_actualizar_usuario(uuid, rol_usuario, boolean) to authenticated;
