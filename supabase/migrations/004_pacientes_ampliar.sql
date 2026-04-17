-- ============================================================
--  RehabMed ERP — Ampliar schema de pacientes
--  Agrega columnas para persistir todos los campos del modal
--  "Nuevo Paciente" del HTML (hoy muchos se guardan en notas/JSON)
-- ============================================================

-- Datos personales ampliados
alter table public.pacientes add column if not exists genero         text;
alter table public.pacientes add column if not exists estado_civil   text;
alter table public.pacientes add column if not exists telefono_secundario text;
alter table public.pacientes add column if not exists direccion      text;
alter table public.pacientes add column if not exists ocupacion      text;
alter table public.pacientes add column if not exists nacionalidad   text default 'Argentina';

-- Cobertura ampliada
alter table public.pacientes add column if not exists plan_cobertura text;
alter table public.pacientes add column if not exists vigencia_cobertura date;

-- Médico
alter table public.pacientes add column if not exists diagnostico_secundario text;
alter table public.pacientes add column if not exists especialidad_derivada text;
alter table public.pacientes add column if not exists medico_derivante text;
alter table public.pacientes add column if not exists matricula_derivante text;
alter table public.pacientes add column if not exists sesiones_autorizadas int check (sesiones_autorizadas is null or sesiones_autorizadas >= 0);
alter table public.pacientes add column if not exists grupo_sanguineo text;
alter table public.pacientes add column if not exists peso_kg numeric(5,2);
alter table public.pacientes add column if not exists altura_cm numeric(5,2);

-- Medicación y antecedentes
alter table public.pacientes add column if not exists alergias    text;
alter table public.pacientes add column if not exists medicacion  text;
alter table public.pacientes add column if not exists cirugias    text;
alter table public.pacientes add column if not exists cronicas    text;
alter table public.pacientes add column if not exists implante    text;
alter table public.pacientes add column if not exists embarazo    text;

-- Contacto de emergencia
alter table public.pacientes add column if not exists emerg_nombre   text;
alter table public.pacientes add column if not exists emerg_relacion text;
alter table public.pacientes add column if not exists emerg_telefono text;
alter table public.pacientes add column if not exists emerg_tel2     text;
alter table public.pacientes add column if not exists emerg_direccion text;

-- Otros
alter table public.pacientes add column if not exists motivo_consulta text;
alter table public.pacientes add column if not exists observaciones   text;
alter table public.pacientes add column if not exists consentimiento_firmado boolean not null default false;
alter table public.pacientes add column if not exists consentimiento_fecha timestamptz;

-- Indice por DNI (ya existe en 001, pero por si ejecutas esto standalone)
create index if not exists idx_pacientes_dni_v2 on public.pacientes(dni);

comment on column public.pacientes.consentimiento_firmado is 'Ley 25.326 Proteccion Datos Personales';
