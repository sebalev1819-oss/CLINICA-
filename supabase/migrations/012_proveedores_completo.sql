-- ============================================================
--  RehabMed ERP — Proveedores completo (P3)
--  Tabla proveedores con datos fiscales, comerciales, bancarios
--  + Tabla proveedores_archivos para contratos y documentos
--  + Bucket de storage para los archivos
-- ============================================================

-- ============================================================
--  ENUM TYPES
-- ============================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'condicion_iva') then
    create type condicion_iva as enum (
      'Responsable Inscripto',
      'Monotributista',
      'Exento',
      'Consumidor Final',
      'No Responsable',
      'Sujeto No Categorizado'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'condicion_pago_prov') then
    create type condicion_pago_prov as enum (
      'Contado',
      '7 dias',
      '15 dias',
      '21 dias',
      '30 dias',
      '30/60',
      '30/60/90',
      '60 dias',
      '90 dias',
      'Anticipado',
      'A convenir'
    );
  end if;
end $$;

-- ============================================================
--  TABLA: proveedores
-- ============================================================
create table if not exists public.proveedores (
  id                  uuid primary key default uuid_generate_v4(),
  -- Datos básicos
  razon_social        text not null,
  nombre_fantasia     text,
  cuit                text,
  categoria           text,
  rubro               text,

  -- Datos fiscales
  condicion_iva       condicion_iva,
  ingresos_brutos_nro text,
  iibb_jurisdiccion   text,
  iibb_exento         boolean default false,
  agente_retencion    boolean default false,
  agente_percepcion   boolean default false,

  -- Contacto
  email               text,
  telefono            text,
  telefono_secundario text,
  persona_contacto    text,
  cargo_contacto      text,
  web                 text,

  -- Domicilio fiscal
  direccion           text,
  localidad           text,
  provincia           text,
  codigo_postal       text,
  pais                text default 'Argentina',

  -- Condiciones comerciales
  condicion_pago      condicion_pago_prov default 'Contado',
  dias_plazo          int default 0 check (dias_plazo >= 0),
  limite_credito      numeric(12,2) default 0,
  moneda              text default 'ARS',
  descuento_pct       numeric(5,2) default 0 check (descuento_pct between 0 and 100),

  -- Datos bancarios
  banco               text,
  tipo_cuenta         text,                -- 'Cuenta Corriente', 'Caja de Ahorro'
  nro_cuenta          text,
  cbu                 text,
  alias_cbu           text,
  titular             text,
  titular_cuit        text,

  -- Estado y auditoría
  activo              boolean not null default true,
  notas               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.proveedores is 'Catálogo de proveedores con datos fiscales, comerciales y bancarios.';

-- CUIT único cuando se carga
create unique index if not exists uniq_proveedores_cuit
  on public.proveedores (cuit)
  where cuit is not null;

create index if not exists idx_proveedores_categoria on public.proveedores (categoria) where activo = true;
create index if not exists idx_proveedores_activo on public.proveedores (activo);

-- Trigger updated_at
create or replace function public._fn_prov_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_proveedores_updated_at on public.proveedores;
create trigger trg_proveedores_updated_at
  before update on public.proveedores
  for each row execute function public._fn_prov_set_updated_at();

-- ============================================================
--  TABLA: proveedores_archivos (contratos, facturas, comprobantes)
-- ============================================================
create table if not exists public.proveedores_archivos (
  id              uuid primary key default uuid_generate_v4(),
  proveedor_id    uuid not null references public.proveedores(id) on delete cascade,
  nombre          text not null,                -- "Contrato 2026", "Última factura"
  tipo            text not null default 'otro', -- 'contrato', 'factura', 'comprobante', 'remito', 'otro'
  storage_path    text not null,                -- path en bucket 'proveedores-docs'
  tipo_mime       text,
  tamano_bytes    bigint,
  descripcion     text,
  vencimiento     date,                         -- opcional: cuándo vence el contrato
  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.proveedores_archivos is
  'Archivos del proveedor (contratos, facturas, etc) — los binarios viven en el bucket "proveedores-docs".';

create index if not exists idx_prov_arch_proveedor on public.proveedores_archivos (proveedor_id);
create index if not exists idx_prov_arch_tipo on public.proveedores_archivos (tipo);
create index if not exists idx_prov_arch_vencimiento on public.proveedores_archivos (vencimiento) where vencimiento is not null;

-- ============================================================
--  RLS — Solo admin/recepción gestionan; profesional solo lee
-- ============================================================
alter table public.proveedores          enable row level security;
alter table public.proveedores_archivos enable row level security;

-- Proveedores
drop policy if exists "proveedores: lectura autenticados" on public.proveedores;
create policy "proveedores: lectura autenticados"
  on public.proveedores for select
  using (auth.uid() is not null);

drop policy if exists "proveedores: admin y recepcion gestionan" on public.proveedores;
create policy "proveedores: admin y recepcion gestionan"
  on public.proveedores for all
  using (public.mi_rol() in ('admin','recepcion'))
  with check (public.mi_rol() in ('admin','recepcion'));

-- Archivos
drop policy if exists "prov_archivos: lectura autenticados" on public.proveedores_archivos;
create policy "prov_archivos: lectura autenticados"
  on public.proveedores_archivos for select
  using (auth.uid() is not null);

drop policy if exists "prov_archivos: admin y recepcion gestionan" on public.proveedores_archivos;
create policy "prov_archivos: admin y recepcion gestionan"
  on public.proveedores_archivos for all
  using (public.mi_rol() in ('admin','recepcion'))
  with check (public.mi_rol() in ('admin','recepcion'));

-- ============================================================
--  STORAGE BUCKET: proveedores-docs
-- ============================================================
insert into storage.buckets (id, name, public)
values ('proveedores-docs', 'proveedores-docs', false)
on conflict (id) do nothing;

-- Policies del bucket: solo admin/recepcion suben/leen/borran
drop policy if exists "prov_docs: admin recepcion lectura" on storage.objects;
create policy "prov_docs: admin recepcion lectura"
  on storage.objects for select
  using (
    bucket_id = 'proveedores-docs'
    and public.mi_rol() in ('admin','recepcion','profesional')
  );

drop policy if exists "prov_docs: admin recepcion subir" on storage.objects;
create policy "prov_docs: admin recepcion subir"
  on storage.objects for insert
  with check (
    bucket_id = 'proveedores-docs'
    and public.mi_rol() in ('admin','recepcion')
  );

drop policy if exists "prov_docs: admin recepcion borrar" on storage.objects;
create policy "prov_docs: admin recepcion borrar"
  on storage.objects for delete
  using (
    bucket_id = 'proveedores-docs'
    and public.mi_rol() in ('admin','recepcion')
  );

-- ============================================================
--  VISTA: proveedores con conteo de archivos y próximo vencimiento
-- ============================================================
create or replace view public.v_proveedores_full as
select
  p.*,
  coalesce(arc.cantidad_archivos, 0) as cantidad_archivos,
  arc.proximo_vencimiento
from public.proveedores p
left join lateral (
  select
    count(*)                       as cantidad_archivos,
    min(vencimiento) filter (
      where vencimiento >= current_date
    ) as proximo_vencimiento
  from public.proveedores_archivos
  where proveedor_id = p.id
) arc on true;

grant select on public.v_proveedores_full to authenticated;

-- ============================================================
--  TESTS rápidos (comentados)
-- ============================================================
-- -- 1. Insertar proveedor de prueba
-- insert into public.proveedores (
--   razon_social, cuit, condicion_iva, email, condicion_pago, dias_plazo
-- ) values (
--   'Test Proveedor SA', '30-12345678-9', 'Responsable Inscripto',
--   'test@proveedor.com', '30 dias', 30
-- );
--
-- -- 2. Verificar
-- select * from public.v_proveedores_full;
--
-- -- 3. Cleanup
-- delete from public.proveedores where razon_social = 'Test Proveedor SA';
