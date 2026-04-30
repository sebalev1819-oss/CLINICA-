-- ============================================================
--  RehabMed ERP — Schema administrativo / contable
--  Inspiración: Odoo Healthcare + ERP argentinos (Tango Gestión)
-- ============================================================
--  Agrega:
--   1. obras_sociales   — convenios con OS / prepagas / ART
--   2. tarifas          — precios por especialidad/cobertura/vigencia
--   3. facturas         — documentos fiscales emitidos
--   4. factura_items    — detalle (sesiones, consultas, productos)
--   5. pagos            — cobros aplicados a facturas
--   6. caja_movimientos — movimientos de caja diarios
--   7. caja_cierres     — cierre de caja por día/usuario
--   8. liquidaciones    — liquidación periódica de profesionales
--   9. liquidacion_items
-- ============================================================

-- ── ENUMs ───────────────────────────────────────────────
create type tipo_cobertura        as enum ('Particular', 'Obra Social', 'Prepaga', 'ART', 'Mutual');
create type tipo_factura          as enum ('A', 'B', 'C', 'M', 'Recibo', 'Presupuesto');
create type estado_factura        as enum ('Borrador', 'Emitida', 'Pagada', 'Parcial', 'Anulada', 'Vencida');
create type medio_pago            as enum ('Efectivo', 'Transferencia', 'Tarjeta Débito', 'Tarjeta Crédito', 'Cheque', 'Mercado Pago', 'Modo', 'Crédito OS', 'Otro');
create type tipo_mov_caja         as enum ('ingreso', 'egreso', 'transferencia', 'apertura', 'cierre');
create type estado_liquidacion    as enum ('Borrador', 'Cerrada', 'Pagada', 'Anulada');

-- ============================================================
--  1. OBRAS SOCIALES / CONVENIOS
-- ============================================================
create table public.obras_sociales (
  id              uuid primary key default uuid_generate_v4(),
  nombre          text not null unique,
  razon_social    text,
  cuit            text,
  tipo            tipo_cobertura not null default 'Obra Social',
  codigo_interno  text,                    -- código corto (ej: 'OSDE', 'SMED')
  -- Configuración económica
  alicuota_iva    numeric(5,2) not null default 21.00 check (alicuota_iva >= 0),
  comision_pct    numeric(5,2) not null default 0    check (comision_pct >= 0 and comision_pct <= 100),
  dia_presentacion int                      check (dia_presentacion between 1 and 31),
  dia_cobro       int                      check (dia_cobro between 1 and 31),
  -- Contacto
  telefono        text,
  email           text,
  contacto        text,
  notas           text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.obras_sociales is 'Catalogo de obras sociales, prepagas, ART y mutuales con las que opera la clinica';

create index idx_obras_activo on public.obras_sociales(activo);

-- ============================================================
--  2. TARIFARIO
--  Una fila por combinación (especialidad, obra_social, vigencia)
--  Si obra_social_id es NULL = tarifa particular / por defecto
-- ============================================================
create table public.tarifas (
  id               uuid primary key default uuid_generate_v4(),
  especialidad     text not null,
  obra_social_id   uuid references public.obras_sociales(id) on delete cascade,
  monto            numeric(12,2) not null check (monto >= 0),
  moneda           text not null default 'ARS',
  vigencia_desde   date not null default current_date,
  vigencia_hasta   date,
  codigo_prestacion text,                  -- código nomenclador (ej: '27.01.01')
  descripcion      text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vigencia_valida check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
comment on table public.tarifas is 'Tarifario por especialidad + cobertura + vigencia. obra_social_id NULL = particular.';

create index idx_tarifas_esp on public.tarifas(especialidad, activo);
create index idx_tarifas_os  on public.tarifas(obra_social_id);

-- Vista: tarifa vigente por especialidad/OS
create or replace view public.v_tarifas_vigentes
with (security_invoker = true) as
select
  t.id, t.especialidad, t.obra_social_id,
  coalesce(os.nombre, 'Particular') as cobertura_nombre,
  t.monto, t.moneda, t.codigo_prestacion, t.descripcion,
  t.vigencia_desde, t.vigencia_hasta
from public.tarifas t
left join public.obras_sociales os on os.id = t.obra_social_id
where t.activo = true
  and t.vigencia_desde <= current_date
  and (t.vigencia_hasta is null or t.vigencia_hasta >= current_date);

-- ============================================================
--  3. FACTURAS
--  Numeración correlativa por tipo (implementada con sequence)
-- ============================================================
create sequence if not exists public.factura_numero_seq;

create table public.facturas (
  id                  uuid primary key default uuid_generate_v4(),
  numero              int not null default nextval('public.factura_numero_seq'),
  tipo                tipo_factura not null default 'Recibo',
  punto_venta         int not null default 1,

  -- Destinatario
  paciente_id         uuid references public.pacientes(id) on delete restrict,
  obra_social_id      uuid references public.obras_sociales(id) on delete restrict,
  razon_social        text,                -- si es a nombre de terceros
  cuit_destinatario   text,

  -- Fechas
  fecha_emision       date not null default current_date,
  fecha_vencimiento   date,

  -- Importes
  subtotal            numeric(12,2) not null default 0 check (subtotal >= 0),
  iva                 numeric(12,2) not null default 0 check (iva >= 0),
  descuento           numeric(12,2) not null default 0 check (descuento >= 0),
  total               numeric(12,2) not null default 0 check (total >= 0),
  saldo               numeric(12,2) not null default 0,        -- total - pagos aplicados
  moneda              text not null default 'ARS',

  -- Estado y metadata
  estado              estado_factura not null default 'Borrador',
  cae                 text,                -- CAE si se integra con AFIP
  cae_vto             date,
  observaciones       text,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Un paciente O una OS, pero al menos uno
  constraint destinatario_obligatorio check (paciente_id is not null or obra_social_id is not null or razon_social is not null)
);
comment on table public.facturas is 'Documentos fiscales emitidos (facturas, recibos, presupuestos)';

create unique index idx_facturas_numero on public.facturas(tipo, punto_venta, numero);
create index idx_facturas_paciente     on public.facturas(paciente_id);
create index idx_facturas_obra_social  on public.facturas(obra_social_id);
create index idx_facturas_fecha        on public.facturas(fecha_emision desc);
create index idx_facturas_estado       on public.facturas(estado);

-- ============================================================
--  4. ITEMS DE FACTURA
-- ============================================================
create table public.factura_items (
  id              uuid primary key default uuid_generate_v4(),
  factura_id      uuid not null references public.facturas(id) on delete cascade,
  turno_id        uuid references public.turnos(id) on delete set null,
  concepto        text not null,
  cantidad        numeric(10,2) not null default 1 check (cantidad > 0),
  monto_unitario  numeric(12,2) not null check (monto_unitario >= 0),
  descuento_pct   numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  subtotal        numeric(12,2) not null check (subtotal >= 0),
  orden           int not null default 0
);

create index idx_factura_items_factura on public.factura_items(factura_id);
create index idx_factura_items_turno   on public.factura_items(turno_id);

-- ============================================================
--  5. PAGOS
--  Cobros aplicados a facturas (pueden ser parciales)
-- ============================================================
create table public.pagos (
  id              uuid primary key default uuid_generate_v4(),
  factura_id      uuid references public.facturas(id) on delete cascade,
  paciente_id     uuid references public.pacientes(id) on delete set null,
  obra_social_id  uuid references public.obras_sociales(id) on delete set null,
  fecha           date not null default current_date,
  medio           medio_pago not null,
  monto           numeric(12,2) not null check (monto > 0),
  referencia      text,                    -- número de operación, cheque, transferencia
  banco           text,
  notas           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index idx_pagos_factura  on public.pagos(factura_id);
create index idx_pagos_paciente on public.pagos(paciente_id);
create index idx_pagos_fecha    on public.pagos(fecha desc);

-- Trigger: al insertar pago, actualizar saldo y estado de la factura
create or replace function public.fn_actualizar_saldo_factura()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total_pagado numeric(12,2);
  v_factura record;
begin
  if new.factura_id is null then return new; end if;

  select * into v_factura from public.facturas where id = new.factura_id;
  if not found then return new; end if;

  select coalesce(sum(monto), 0) into v_total_pagado
  from public.pagos where factura_id = new.factura_id;

  update public.facturas
  set saldo  = v_factura.total - v_total_pagado,
      estado = case
                 when v_total_pagado >= v_factura.total then 'Pagada'::estado_factura
                 when v_total_pagado > 0 then 'Parcial'::estado_factura
                 else v_factura.estado
               end
  where id = new.factura_id;

  return new;
end;
$$;

create trigger trg_actualizar_saldo_factura
  after insert or update of monto on public.pagos
  for each row execute function public.fn_actualizar_saldo_factura();

-- ============================================================
--  6. CAJA — Movimientos
-- ============================================================
create table public.caja_movimientos (
  id              uuid primary key default uuid_generate_v4(),
  fecha           timestamptz not null default now(),
  tipo            tipo_mov_caja not null,
  concepto        text not null,
  monto           numeric(12,2) not null check (monto >= 0),
  medio           medio_pago,
  -- Referencias opcionales
  factura_id      uuid references public.facturas(id) on delete set null,
  pago_id         uuid references public.pagos(id) on delete set null,
  cierre_id       uuid,                    -- FK circular, se agrega después
  --
  categoria       text,                    -- 'Consultas', 'Sueldos', 'Insumos', etc.
  referencia      text,
  notas           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index idx_caja_fecha     on public.caja_movimientos(fecha desc);
create index idx_caja_tipo      on public.caja_movimientos(tipo);
create index idx_caja_cierre    on public.caja_movimientos(cierre_id);

-- ============================================================
--  7. CIERRES DE CAJA
-- ============================================================
create table public.caja_cierres (
  id              uuid primary key default uuid_generate_v4(),
  fecha           date not null,
  apertura_at     timestamptz not null default now(),
  cierre_at       timestamptz,
  usuario_id      uuid references public.profiles(id),

  -- Saldos calculados al cierre (snapshot)
  saldo_inicial   numeric(12,2) not null default 0,
  total_ingresos  numeric(12,2) not null default 0,
  total_egresos   numeric(12,2) not null default 0,
  saldo_teorico   numeric(12,2) not null default 0,
  saldo_real      numeric(12,2),            -- lo que cuenta el cajero
  diferencia      numeric(12,2),            -- real - teorico

  -- Desglose por medio
  efectivo        numeric(12,2) not null default 0,
  transferencia   numeric(12,2) not null default 0,
  tarjeta_debito  numeric(12,2) not null default 0,
  tarjeta_credito numeric(12,2) not null default 0,
  mercado_pago    numeric(12,2) not null default 0,
  otros           numeric(12,2) not null default 0,

  estado          text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  observaciones   text,
  created_at      timestamptz not null default now()
);

create unique index idx_caja_cierres_fecha_abierta on public.caja_cierres(fecha)
  where estado = 'abierta';

alter table public.caja_movimientos
  add constraint fk_caja_mov_cierre foreign key (cierre_id) references public.caja_cierres(id) on delete set null;

-- ============================================================
--  8. LIQUIDACIONES DE PROFESIONALES
-- ============================================================
create table public.liquidaciones (
  id              uuid primary key default uuid_generate_v4(),
  profesional_id  uuid not null references public.profesionales(id) on delete restrict,
  periodo_desde   date not null,
  periodo_hasta   date not null,

  total_sesiones  int not null default 0,
  total_bruto     numeric(12,2) not null default 0,
  comision_pct    numeric(5,2) not null default 100 check (comision_pct >= 0 and comision_pct <= 100),
  total_descuentos numeric(12,2) not null default 0 check (total_descuentos >= 0),
  total_neto      numeric(12,2) not null default 0,

  estado          estado_liquidacion not null default 'Borrador',
  pagado_at       timestamptz,
  medio_pago      medio_pago,
  observaciones   text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint periodo_valido check (periodo_hasta >= periodo_desde)
);

create index idx_liquidaciones_profesional on public.liquidaciones(profesional_id);
create index idx_liquidaciones_periodo     on public.liquidaciones(periodo_desde desc);

create table public.liquidacion_items (
  id              uuid primary key default uuid_generate_v4(),
  liquidacion_id  uuid not null references public.liquidaciones(id) on delete cascade,
  turno_id        uuid references public.turnos(id) on delete set null,
  fecha           date not null,
  concepto        text not null,
  cantidad        numeric(10,2) not null default 1,
  monto_unitario  numeric(12,2) not null,
  subtotal        numeric(12,2) not null
);

create index idx_liq_items_liquidacion on public.liquidacion_items(liquidacion_id);

-- ============================================================
--  TRIGGERS updated_at
-- ============================================================
create trigger trg_obras_sociales_updated_at before update on public.obras_sociales
  for each row execute function public.set_updated_at();
create trigger trg_tarifas_updated_at before update on public.tarifas
  for each row execute function public.set_updated_at();
create trigger trg_facturas_updated_at before update on public.facturas
  for each row execute function public.set_updated_at();
create trigger trg_liquidaciones_updated_at before update on public.liquidaciones
  for each row execute function public.set_updated_at();

-- Audit en facturación y pagos
create trigger trg_audit_facturas after insert or update or delete on public.facturas
  for each row execute function public.fn_audit_trigger();
create trigger trg_audit_pagos after insert or update or delete on public.pagos
  for each row execute function public.fn_audit_trigger();
create trigger trg_audit_caja after insert or update or delete on public.caja_movimientos
  for each row execute function public.fn_audit_trigger();

-- ============================================================
--  RLS
-- ============================================================
alter table public.obras_sociales      enable row level security;
alter table public.tarifas             enable row level security;
alter table public.facturas            enable row level security;
alter table public.factura_items       enable row level security;
alter table public.pagos               enable row level security;
alter table public.caja_movimientos    enable row level security;
alter table public.caja_cierres        enable row level security;
alter table public.liquidaciones       enable row level security;
alter table public.liquidacion_items   enable row level security;

-- Obras sociales y tarifas: todos los autenticados leen, admin gestiona
create policy "os: lectura autenticados"   on public.obras_sociales for select using (auth.uid() is not null);
create policy "os: admin gestiona"         on public.obras_sociales for all
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

create policy "tarifas: lectura autenticados" on public.tarifas for select using (auth.uid() is not null);
create policy "tarifas: admin gestiona"       on public.tarifas for all
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

-- Facturas: admin y recepción leen todo; profesional solo las de sus pacientes
create policy "facturas: admin y recepcion leen"    on public.facturas for select
  using (public.mi_rol() in ('admin','recepcion'));
create policy "facturas: admin y recepcion crean"   on public.facturas for insert
  with check (public.mi_rol() in ('admin','recepcion'));
create policy "facturas: admin y recepcion editan"  on public.facturas for update
  using (public.mi_rol() in ('admin','recepcion')) with check (public.mi_rol() in ('admin','recepcion'));
create policy "facturas: solo admin elimina"        on public.facturas for delete
  using (public.mi_rol() = 'admin');

create policy "factura_items: admin y recepcion" on public.factura_items for all
  using (public.mi_rol() in ('admin','recepcion')) with check (public.mi_rol() in ('admin','recepcion'));

-- Pagos: admin y recepción
create policy "pagos: admin y recepcion leen"  on public.pagos for select
  using (public.mi_rol() in ('admin','recepcion'));
create policy "pagos: admin y recepcion crean" on public.pagos for insert
  with check (public.mi_rol() in ('admin','recepcion'));
create policy "pagos: solo admin elimina"      on public.pagos for delete
  using (public.mi_rol() = 'admin');

-- Caja: admin y recepción
create policy "caja_mov: admin y recepcion" on public.caja_movimientos for all
  using (public.mi_rol() in ('admin','recepcion')) with check (public.mi_rol() in ('admin','recepcion'));
create policy "caja_cierres: admin y recepcion" on public.caja_cierres for all
  using (public.mi_rol() in ('admin','recepcion')) with check (public.mi_rol() in ('admin','recepcion'));

-- Liquidaciones: admin gestiona; profesional solo lee las suyas
create policy "liquidaciones: admin gestiona" on public.liquidaciones for all
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
create policy "liquidaciones: profesional lee las suyas" on public.liquidaciones for select
  using (
    public.mi_rol() = 'profesional'
    and profesional_id in (select id from public.profesionales where profile_id = auth.uid())
  );
create policy "liq_items: admin gestiona" on public.liquidacion_items for all
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
create policy "liq_items: profesional lee las suyas" on public.liquidacion_items for select
  using (
    public.mi_rol() = 'profesional'
    and liquidacion_id in (
      select l.id from public.liquidaciones l
      join public.profesionales p on p.id = l.profesional_id
      where p.profile_id = auth.uid()
    )
  );

-- ============================================================
--  FUNCIONES DE NEGOCIO
-- ============================================================

/**
 * Obtiene el saldo de cuenta corriente de un paciente
 * (suma de facturas impagas - pagos no aplicados a factura)
 */
create or replace function public.saldo_cta_cte_paciente(p_paciente_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select sum(saldo) from public.facturas where paciente_id = p_paciente_id and estado in ('Emitida','Parcial','Vencida'))
    - coalesce((select sum(monto) from public.pagos where paciente_id = p_paciente_id and factura_id is null), 0)
    , 0);
$$;

/**
 * Genera una factura desde un turno finalizado (emite recibo particular).
 * Returns la factura creada.
 */
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
begin
  if public.mi_rol() not in ('admin','recepcion') then
    raise exception 'Solo admin o recepción pueden facturar';
  end if;

  select * into v_turno from public.turnos where id = p_turno_id;
  if not found then raise exception 'Turno no encontrado'; end if;

  -- Buscar tarifa vigente para la especialidad
  select monto into v_tarifa
  from public.v_tarifas_vigentes
  where especialidad = v_turno.especialidad
    and (obra_social_id is null and v_turno.cobertura in (null,'Particular')
         or obra_social_id in (select id from public.obras_sociales where nombre = v_turno.cobertura))
  order by obra_social_id nulls last
  limit 1;

  v_tarifa := coalesce(v_tarifa, 10000);

  -- Crear factura
  insert into public.facturas (tipo, paciente_id, fecha_emision, subtotal, total, saldo, estado, created_by)
  values ('Recibo', v_turno.paciente_id, current_date, v_tarifa, v_tarifa, v_tarifa, 'Emitida', auth.uid())
  returning * into v_factura;

  -- Item
  insert into public.factura_items (factura_id, turno_id, concepto, cantidad, monto_unitario, subtotal, orden)
  values (v_factura.id, p_turno_id, 'Sesión ' || v_turno.especialidad, 1, v_tarifa, v_tarifa, 1);

  return v_factura;
end;
$$;
grant execute on function public.facturar_turno(uuid) to authenticated;

/**
 * Calcula y genera liquidación de un profesional para un período
 */
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
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo admin puede generar liquidaciones';
  end if;

  insert into public.liquidaciones (profesional_id, periodo_desde, periodo_hasta, comision_pct, estado, created_by)
  values (p_profesional_id, p_desde, p_hasta, p_comision_pct, 'Borrador', auth.uid())
  returning * into v_liq;

  -- Agregar items por cada turno finalizado en el período
  for v_turno in
    select * from public.turnos
    where profesional_id = p_profesional_id
      and fecha between p_desde and p_hasta
      and estado = 'Finalizado'
    order by fecha, hora
  loop
    select monto into v_tarifa from public.v_tarifas_vigentes
    where especialidad = v_turno.especialidad limit 1;
    v_tarifa := coalesce(v_tarifa, 10000) * (p_comision_pct / 100.0);

    insert into public.liquidacion_items (liquidacion_id, turno_id, fecha, concepto, cantidad, monto_unitario, subtotal)
    values (v_liq.id, v_turno.id, v_turno.fecha,
            'Sesión ' || v_turno.especialidad, 1, v_tarifa, v_tarifa);

    v_total := v_total + v_tarifa;
    v_count := v_count + 1;
  end loop;

  update public.liquidaciones
  set total_sesiones = v_count, total_bruto = v_total, total_neto = v_total
  where id = v_liq.id
  returning * into v_liq;

  return v_liq;
end;
$$;
grant execute on function public.generar_liquidacion(uuid, date, date, numeric) to authenticated;

/**
 * Abrir caja del día (si no hay una abierta)
 */
create or replace function public.abrir_caja(p_saldo_inicial numeric default 0)
returns public.caja_cierres
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja public.caja_cierres;
begin
  if public.mi_rol() not in ('admin','recepcion') then
    raise exception 'Solo admin o recepción pueden abrir caja';
  end if;

  -- Si ya hay una caja abierta hoy, devolverla
  select * into v_caja from public.caja_cierres
  where fecha = current_date and estado = 'abierta';
  if found then return v_caja; end if;

  insert into public.caja_cierres (fecha, usuario_id, saldo_inicial, saldo_teorico)
  values (current_date, auth.uid(), p_saldo_inicial, p_saldo_inicial)
  returning * into v_caja;

  insert into public.caja_movimientos (tipo, concepto, monto, medio, cierre_id, created_by)
  values ('apertura', 'Apertura de caja', p_saldo_inicial, 'Efectivo', v_caja.id, auth.uid());

  return v_caja;
end;
$$;
grant execute on function public.abrir_caja(numeric) to authenticated;

/**
 * Cerrar caja del día
 */
create or replace function public.cerrar_caja(p_cierre_id uuid, p_saldo_real numeric, p_obs text default null)
returns public.caja_cierres
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja       public.caja_cierres;
  v_ingresos   numeric(12,2);
  v_egresos    numeric(12,2);
  v_desglose   record;
begin
  if public.mi_rol() not in ('admin','recepcion') then
    raise exception 'Solo admin o recepción pueden cerrar caja';
  end if;

  select * into v_caja from public.caja_cierres where id = p_cierre_id and estado = 'abierta';
  if not found then raise exception 'Caja no encontrada o ya cerrada'; end if;

  select coalesce(sum(case when tipo = 'ingreso' then monto else 0 end), 0),
         coalesce(sum(case when tipo = 'egreso'  then monto else 0 end), 0)
  into v_ingresos, v_egresos
  from public.caja_movimientos where cierre_id = p_cierre_id;

  update public.caja_cierres
  set estado = 'cerrada',
      cierre_at = now(),
      total_ingresos = v_ingresos,
      total_egresos  = v_egresos,
      saldo_teorico  = saldo_inicial + v_ingresos - v_egresos,
      saldo_real     = p_saldo_real,
      diferencia     = p_saldo_real - (saldo_inicial + v_ingresos - v_egresos),
      observaciones  = p_obs
  where id = p_cierre_id
  returning * into v_caja;

  insert into public.caja_movimientos (tipo, concepto, monto, medio, cierre_id, created_by)
  values ('cierre', 'Cierre de caja', v_caja.saldo_teorico, 'Efectivo', p_cierre_id, auth.uid());

  return v_caja;
end;
$$;
grant execute on function public.cerrar_caja(uuid, numeric, text) to authenticated;

-- ============================================================
--  SEED: tarifas base por especialidad
-- ============================================================
insert into public.tarifas (especialidad, obra_social_id, monto, descripcion) values
  ('Kinesiología',  null, 7500, 'Sesión particular'),
  ('Fisioterapia',  null, 8000, 'Sesión particular'),
  ('Psicología',    null, 12000, 'Sesión particular'),
  ('Traumatología', null, 15000, 'Consulta particular'),
  ('Neurología',    null, 14000, 'Consulta particular'),
  ('Reumatología',  null, 13000, 'Consulta particular'),
  ('Pediatría',     null, 9000,  'Consulta particular'),
  ('Deportología',  null, 11000, 'Consulta particular');

-- ============================================================
--  COMENTARIOS
-- ============================================================
comment on column public.obras_sociales.comision_pct is 'Comisión que cobra la OS sobre el valor bruto (descuento aplicado a liquidación)';
comment on column public.facturas.saldo is 'Actualizado automáticamente por trigger al insertar pagos';
comment on column public.caja_cierres.diferencia is 'Positivo: sobrante | Negativo: faltante';
