-- ============================================================
--  RehabMed ERP — Seed de obras sociales y prepagas comunes (AR)
-- ============================================================
--  Carga las OS/prepagas típicas para que el dropdown de tarifas y
--  el de facturación tenga opciones reales desde el principio.
--  Si ya existe el nombre, no duplica.
-- ============================================================

insert into public.obras_sociales (nombre, tipo, alicuota_iva, comision_pct) values
  -- Prepagas
  ('OSDE',              'Prepaga',     21.00, 10),
  ('Swiss Medical',     'Prepaga',     21.00, 12),
  ('Galeno',            'Prepaga',     21.00, 10),
  ('Medifé',            'Prepaga',     21.00, 10),
  ('OMINT',             'Prepaga',     21.00, 10),
  ('Sancor Salud',      'Prepaga',     21.00, 10),
  ('Accord Salud',      'Prepaga',     21.00, 10),
  ('Hospital Italiano', 'Prepaga',     21.00, 8),
  ('Hospital Alemán',   'Prepaga',     21.00, 8),

  -- Obras sociales grandes
  ('PAMI',              'Obra Social', 21.00, 15),
  ('IOMA',              'Obra Social', 21.00, 18),
  ('OSDEPYM',           'Obra Social', 21.00, 15),
  ('OSECAC',            'Obra Social', 21.00, 15),
  ('OSPRERA',           'Obra Social', 21.00, 15),
  ('Unión Personal',    'Obra Social', 21.00, 15),
  ('OSPIP',             'Obra Social', 21.00, 15),
  ('OSPLAD',            'Obra Social', 21.00, 15),
  ('OSUTHGRA',          'Obra Social', 21.00, 15),

  -- ART más comunes
  ('Galeno ART',        'ART', 21.00, 20),
  ('Provincia ART',     'ART', 21.00, 20),
  ('La Segunda ART',    'ART', 21.00, 20),
  ('Experta ART',       'ART', 21.00, 20),
  ('Federación Patronal ART', 'ART', 21.00, 20),
  ('Prevención ART',    'ART', 21.00, 20),

  -- Mutuales
  ('Mutual Policial',   'Mutual', 21.00, 10),
  ('Mutual Judicial',   'Mutual', 21.00, 10)
on conflict (nombre) do nothing;

-- ============================================================
--  Seed de tarifas para las OS más grandes
--  Precios tipicos de kinesiologia / fisio para las prepagas top
--  (se pueden ajustar despues desde la UI)
-- ============================================================

do $$
declare
  v_osde    uuid;
  v_swiss   uuid;
  v_galeno  uuid;
  v_medife  uuid;
  v_pami    uuid;
  v_ioma    uuid;
begin
  select id into v_osde    from public.obras_sociales where nombre = 'OSDE'              limit 1;
  select id into v_swiss   from public.obras_sociales where nombre = 'Swiss Medical'     limit 1;
  select id into v_galeno  from public.obras_sociales where nombre = 'Galeno'            limit 1;
  select id into v_medife  from public.obras_sociales where nombre = 'Medifé'            limit 1;
  select id into v_pami    from public.obras_sociales where nombre = 'PAMI'              limit 1;
  select id into v_ioma    from public.obras_sociales where nombre = 'IOMA'              limit 1;

  -- Kinesiología por OS
  insert into public.tarifas (especialidad, obra_social_id, monto, descripcion) values
    ('Kinesiología', v_osde,    6500, 'Sesión OSDE'),
    ('Kinesiología', v_swiss,   6200, 'Sesión Swiss Medical'),
    ('Kinesiología', v_galeno,  5800, 'Sesión Galeno'),
    ('Kinesiología', v_medife,  5500, 'Sesión Medifé'),
    ('Kinesiología', v_pami,    3500, 'Sesión PAMI'),
    ('Kinesiología', v_ioma,    4500, 'Sesión IOMA'),
    -- Fisioterapia por OS
    ('Fisioterapia', v_osde,    7000, 'Sesión OSDE'),
    ('Fisioterapia', v_swiss,   6800, 'Sesión Swiss Medical'),
    ('Fisioterapia', v_galeno,  6200, 'Sesión Galeno'),
    ('Fisioterapia', v_pami,    3800, 'Sesión PAMI'),
    -- Traumatología consulta
    ('Traumatología', v_osde,   12000, 'Consulta OSDE'),
    ('Traumatología', v_swiss,  11500, 'Consulta Swiss Medical'),
    ('Traumatología', v_pami,   6500,  'Consulta PAMI'),
    -- Psicología
    ('Psicología', v_osde,     10000, 'Sesión OSDE'),
    ('Psicología', v_swiss,    9500,  'Sesión Swiss Medical')
  on conflict do nothing;
end $$;
