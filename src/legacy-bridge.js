// ============================================================
//  RehabMed ERP — Legacy Bridge
//  Hidrata desde Supabase:
//    window.AGENDA_DATA
//    window.CONSULTORIOS_DATA
//    window.PACIENTES_DATA
//    window.PROFESIONALES_DATA
//
//  Intercepta mutadores del HTML:
//    window.guardarNuevoTurno
//    window.updateTurnoEstado
//    window.changeEstado
//    window.crearPacienteUI (alta de paciente desde modal)
// ============================================================
import { supabase } from './lib/supabase.js';
import { showToast } from './lib/dom.js';

let _rtChannel = null;

// ── Map helpers: Supabase -> forma legacy que espera el HTML ───

function mapTurnoLegacy(t) {
  const hoyStr = new Date().toISOString().slice(0, 10);
  const fechaStr = t.fecha;
  const esHoy = fechaStr === hoyStr;

  let rango = 'mes';
  if (esHoy) rango = 'hoy';
  else {
    const diff = (new Date(fechaStr) - new Date(hoyStr)) / 86400000;
    if (diff >= 0 && diff <= 7) rango = 'semana';
  }

  const fechaDisplay = esHoy
    ? 'Hoy'
    : new Date(fechaStr + 'T00:00').toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });

  return {
    id: t.id,
    fecha: fechaDisplay,
    rango,
    hora: String(t.hora).slice(0, 5),
    pac: t.pac_nombre || '—',
    prof: t.prof_nombre || '—',
    c: t.consultorio_id,
    esp: t.especialidad,
    tipo: t.tipo,
    estado: t.estado,
    cobertura: t.cobertura || t.pac_cobertura,
    nroAut: t.numero_autorizacion,
    _fechaISO:      fechaStr,
    _pacienteId:    t.paciente_id,
    _profesionalId: t.profesional_id,
    _consultorioId: t.consultorio_id,
  };
}

function mapConsultorioLegacy(c) {
  const prof = Array.isArray(c.profesionales) && c.profesionales[0]
    ? c.profesionales[0].nombre
    : (c.profesionales?.nombre || '—');
  return {
    id: c.id, esp: c.especialidad, estado: c.estado,
    prof, pac: '—', _real: true,
  };
}

function mapPacienteLegacy(p) {
  // Próximo turno: se completa después del join con AGENDA_DATA
  const prox = (window.AGENDA_DATA || [])
    .filter(t => t._pacienteId === p.id)
    .sort((a, b) => (a._fechaISO + a.hora).localeCompare(b._fechaISO + b.hora))[0];

  return {
    id:     p.id,
    ref:    p.ref || `PAC-${String(p.id).slice(0, 8)}`,
    nombre: p.nombre,
    dni:    p.dni || '—',
    tel:    p.telefono || '',
    email:  p.email || '',
    cob:    p.cobertura || 'Particular',
    diag:   p.diagnostico || '—',
    ses:    0, // se calcula al hidratar (ver enriquecer)
    prox:   prox ? `${prox.fecha} ${prox.hora}` : '—',
    est:    p.estado || 'Activo',
    score:  p.score_noshow ?? 100,
    deuda:  Number(p.deuda) || 0,
    _real:  true,
  };
}

function mapProfesionalLegacy(p) {
  // Turnos y facturación aproximados desde AGENDA_DATA
  const misTurnos = (window.AGENDA_DATA || []).filter(t => t._profesionalId === p.id);
  return {
    id:     p.id,
    ref:    `PRO-${String(p.id).slice(0, 8)}`,
    nombre: p.nombre,
    av:     p.iniciales,
    esp:    p.especialidad,
    mat:    p.matricula,
    tipo:   p.tipo || 'Full Time',
    c:      p.consultorio_id || 1,
    turnos: misTurnos.length,
    fact:   0,          // se completa cuando facturacion venga a Supabase
    ns:     0,          // ídem
    _real:  true,
  };
}

// ============================================================
//  HIDRATAR AGENDA
// ============================================================
export async function hidratarAgenda() {
  const { data, error } = await supabase
    .from('v_turnos_dia').select('*')
    .order('fecha', { ascending: true })
    .order('hora',  { ascending: true });

  if (error) {
    console.error('[Bridge] Error cargando turnos:', error.message);
    return;
  }

  const mapeado = (data || []).map(mapTurnoLegacy);
  if (!Array.isArray(window.AGENDA_DATA)) window.AGENDA_DATA = [];
  window.AGENDA_DATA.length = 0;
  window.AGENDA_DATA.push(...mapeado);
  console.log(`[Bridge] ✅ AGENDA_DATA (${mapeado.length})`);

  if (typeof window.updateDashboardKPIs === 'function') {
    try { window.updateDashboardKPIs(); } catch {}
  }
}

// ============================================================
//  HIDRATAR CONSULTORIOS
// ============================================================
export async function hidratarConsultorios() {
  const { data, error } = await supabase
    .from('consultorios')
    .select('*, profesionales (nombre)')
    .order('id');

  if (error) { console.error('[Bridge] consultorios:', error.message); return; }

  const mapeado = (data || []).map(mapConsultorioLegacy);
  const enCurso = (window.AGENDA_DATA || []).filter(t => t.estado === 'En curso');
  mapeado.forEach(c => {
    const turno = enCurso.find(t => Number(t._consultorioId) === Number(c.id));
    if (turno) c.pac = turno.pac;
  });

  if (!Array.isArray(window.CONSULTORIOS_DATA)) window.CONSULTORIOS_DATA = [];
  window.CONSULTORIOS_DATA.length = 0;
  window.CONSULTORIOS_DATA.push(...mapeado);
  console.log(`[Bridge] ✅ CONSULTORIOS_DATA (${mapeado.length})`);

  if (typeof window.renderConsultorios === 'function') {
    try { window.renderConsultorios(); } catch {}
  }
}

// ============================================================
//  HIDRATAR PACIENTES
// ============================================================
export async function hidratarPacientes() {
  const { data, error } = await supabase
    .from('pacientes').select('*')
    .order('nombre', { ascending: true });

  if (error) { console.error('[Bridge] pacientes:', error.message); return; }

  const mapeado = (data || []).map(mapPacienteLegacy);
  // Sesiones realizadas = turnos en estado Finalizado del paciente
  mapeado.forEach(p => {
    p.ses = (window.AGENDA_DATA || [])
      .filter(t => t._pacienteId === p.id && t.estado === 'Finalizado').length;
  });

  if (!Array.isArray(window.PACIENTES_DATA)) window.PACIENTES_DATA = [];
  window.PACIENTES_DATA.length = 0;
  window.PACIENTES_DATA.push(...mapeado);
  console.log(`[Bridge] ✅ PACIENTES_DATA (${mapeado.length})`);

  popularSelectPacientes();

  if (typeof window.renderPacientes === 'function') {
    try { window.renderPacientes(); } catch {}
  }
}

// ============================================================
//  HIDRATAR PROFESIONALES
// ============================================================
export async function hidratarProfesionales() {
  const { data, error } = await supabase
    .from('profesionales').select('*')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (error) { console.error('[Bridge] profesionales:', error.message); return; }

  const mapeado = (data || []).map(mapProfesionalLegacy);
  if (!Array.isArray(window.PROFESIONALES_DATA)) window.PROFESIONALES_DATA = [];
  window.PROFESIONALES_DATA.length = 0;
  window.PROFESIONALES_DATA.push(...mapeado);
  console.log(`[Bridge] ✅ PROFESIONALES_DATA (${mapeado.length})`);

  popularSelectProfesionales();

  if (typeof window.renderProfesionales === 'function') {
    try { window.renderProfesionales(); } catch {}
  }
}

// ============================================================
//  POBLAR <datalist> DEL MODAL "Nuevo Turno"
//  Autocomplete nativo: el usuario tipea y filtra
// ============================================================
function popularSelectPacientes() {
  const dl = document.getElementById('pacientesList');
  if (!dl) return;
  dl.innerHTML = (window.PACIENTES_DATA || [])
    .map(p => `<option value="${escAttr(p.nombre)}">${escHtml(p.dni ? '· ' + p.dni : '')}</option>`)
    .join('');
}

function popularSelectProfesionales() {
  const dl = document.getElementById('profesionalesList');
  if (!dl) return;
  dl.innerHTML = (window.PROFESIONALES_DATA || [])
    .map(p => `<option value="${escAttr(p.nombre)}">${escHtml(p.esp)}</option>`)
    .join('');
}

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s) { return escHtml(s); }

// ============================================================
//  REALTIME — refresca los 4 arrays ante cambios
// ============================================================
export function suscribirBridgeRealtime() {
  if (_rtChannel) supabase.removeChannel(_rtChannel);

  _rtChannel = supabase
    .channel('bridge-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'turnos' },
      async () => { await hidratarAgenda(); await hidratarConsultorios(); await hidratarPacientes(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'consultorios' },
      async () => { await hidratarConsultorios(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pacientes' },
      async () => { await hidratarPacientes(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'profesionales' },
      async () => { await hidratarProfesionales(); await hidratarConsultorios(); })
    .subscribe();
}

// ============================================================
//  MUTADORES INTERCEPTADOS
// ============================================================

async function updateTurnoEstadoSupabase(pac, newState, toastMsg) {
  const turno = (window.AGENDA_DATA || []).find(
    t => t.pac === pac && t.rango === 'hoy' && !['Cancelado','Finalizado','No Show'].includes(t.estado)
  );
  if (!turno) { showToast(`⚠️ No encuentro turno activo de ${pac}`); return; }

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('turnos')
    .update({ estado: newState, updated_by: user?.id })
    .eq('id', turno.id);

  if (error) { console.error('[Bridge]', error); showToast('❌ No se pudo actualizar'); return; }
  showToast(toastMsg || `✅ ${pac}: → ${newState}`);
}

async function changeEstadoSupabase(idx, newEstado) {
  const t = (window.AGENDA_DATA || [])[idx];
  if (!t) return;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('turnos')
    .update({ estado: newEstado, updated_by: user?.id })
    .eq('id', t.id);

  if (error) { console.error('[Bridge]', error); showToast('❌ No se pudo actualizar'); return; }
  showToast(`✅ ${t.pac}: ${t.estado} → ${newEstado}`);
}

async function guardarNuevoTurnoSupabase() {
  const pacNombre  = document.getElementById('turnoPac')?.value?.trim();
  const profNombre = document.getElementById('turnoProf')?.value?.trim();
  const fecha      = document.getElementById('turnoFecha')?.value || new Date().toISOString().slice(0,10);
  const hora       = document.getElementById('turnoHora')?.value;
  const esp        = document.getElementById('turnoEsp')?.value || 'Kinesiología';
  const tipo       = document.getElementById('turnoTipo')?.value || 'Presencial';
  const pagoTipo   = document.getElementById('turnoPagoTipo')?.value || 'particular';
  const cobertura  = pagoTipo !== 'particular'
    ? document.getElementById('turnoCobertura')?.value
    : 'Particular';
  const nroAut = document.getElementById('turnoNroAut')?.value || null;

  if (!pacNombre || !profNombre || !hora) { showToast('⚠️ Completá paciente, profesional y hora'); return; }
  if (pagoTipo !== 'particular' && (!cobertura || !nroAut)) {
    showToast('🚫 Cobertura y Nº de autorización son obligatorios'); return;
  }

  // Buscar IDs en los arrays hidratados (match por nombre exacto)
  const pac  = (window.PACIENTES_DATA || []).find(p => p.nombre === pacNombre);
  const prof = (window.PROFESIONALES_DATA || []).find(p => p.nombre === profNombre);

  if (!pac)  { showToast(`⚠️ Paciente "${pacNombre}" no existe. Creá la ficha primero.`); return; }
  if (!prof) { showToast(`⚠️ Profesional "${profNombre}" no existe.`); return; }

  const pacId = pac.id;
  const profId = prof.id;
  const consultorio_id = Number(prof.c) || 1;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('turnos').insert([{
    fecha, hora, duracion_min: 45,
    paciente_id:         pacId,
    profesional_id:      profId,
    consultorio_id,
    especialidad:        esp,
    tipo,
    estado:              'Pendiente',
    cobertura,
    numero_autorizacion: nroAut,
    created_by:          user?.id,
  }]);

  if (error) {
    if (error.code === '23P01') {
      showToast('⚠️ Ya hay un turno en ese horario (consultorio o profesional)');
    } else {
      showToast(`❌ ${error.message}`);
      console.error('[Bridge]', error);
    }
    return;
  }

  if (typeof window.closeModal === 'function') window.closeModal('modalNuevoTurno');
  showToast(`✅ Turno creado: ${pacNombre} — ${hora}`);
}

// ============================================================
//  CREAR PACIENTE (ABM desde UI)
// ============================================================
async function crearPacienteUI(datos) {
  if (!datos?.nombre || !datos?.dni) {
    showToast('⚠️ Nombre y DNI son obligatorios');
    return null;
  }

  const { data, error } = await supabase.from('pacientes').insert([{
    nombre:           datos.nombre,
    dni:              datos.dni,
    telefono:         datos.telefono || null,
    email:            datos.email || null,
    fecha_nacimiento: datos.fechaNacimiento || null,
    cobertura:        datos.cobertura || 'Particular',
    numero_afiliado:  datos.numeroAfiliado || null,
    diagnostico:      datos.diagnostico || null,
    estado:           'Nuevo',
    notas:            datos.notas || null,
  }]).select().single();

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[Bridge] crearPaciente:', error);
    return null;
  }

  showToast(`✅ Paciente ${data.nombre} creado (${data.ref})`);
  return data;
}

/**
 * guardarNuevoPaciente() — override del handler legacy.
 * Lee el modal #modalNuevoPaciente, arma el payload y llama a crearPacienteUI.
 * Datos extra no mapeados a columnas van a "notas" en formato estructurado.
 */
async function guardarNuevoPacienteSupabase() {
  const v = id => document.getElementById(id)?.value?.trim() || '';
  const vOrNull = id => v(id) || null;

  const nombre   = v('pacNombre');
  const apellido = v('pacApellido');
  if (!nombre || !apellido) { showToast('⚠️ Nombre y Apellido son obligatorios'); return; }

  const fullName = `${nombre} ${apellido}`.trim();
  const dni      = v('pacDNI');
  if (!dni) { showToast('⚠️ DNI es obligatorio'); return; }

  // Parsear peso/altura "75 / 170"
  const pesoAltura = v('pacPesoAltura');
  let peso = null, altura = null;
  if (pesoAltura) {
    const match = pesoAltura.match(/(\d+(?:[.,]\d+)?)\s*[\/\-,]\s*(\d+(?:[.,]\d+)?)/);
    if (match) {
      peso   = parseFloat(match[1].replace(',', '.'));
      altura = parseFloat(match[2].replace(',', '.'));
    }
  }

  const consentimientoChecked = document.getElementById('pacConsentimiento')?.checked === true;
  const sesAuth = parseInt(v('pacSesiones'), 10);

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('pacientes').insert([{
    nombre:           fullName,
    dni,
    telefono:         vOrNull('pacTel'),
    email:            vOrNull('pacEmail'),
    fecha_nacimiento: vOrNull('pacFechaNac'),
    cobertura:        v('pacCob') || 'Particular',
    numero_afiliado:  vOrNull('pacAfiliado'),
    diagnostico:      vOrNull('pacDiag'),
    estado:           'Nuevo',

    // Datos personales ampliados (schema 004)
    genero:               vOrNull('pacGenero'),
    estado_civil:         vOrNull('pacEstCivil'),
    telefono_secundario:  vOrNull('pacTel2'),
    direccion:            vOrNull('pacDir'),
    ocupacion:            vOrNull('pacOcupacion'),
    nacionalidad:         v('pacNacionalidad') || 'Argentina',

    plan_cobertura:       vOrNull('pacPlan'),
    vigencia_cobertura:   vOrNull('pacVigencia'),

    diagnostico_secundario: vOrNull('pacDiag2'),
    especialidad_derivada:  vOrNull('pacEsp'),
    medico_derivante:       vOrNull('pacMedDer'),
    matricula_derivante:    vOrNull('pacMedMat'),
    sesiones_autorizadas:   Number.isFinite(sesAuth) ? sesAuth : null,
    grupo_sanguineo:        vOrNull('pacSangre'),
    peso_kg:                peso,
    altura_cm:              altura,

    alergias:    vOrNull('pacAlergias'),
    medicacion:  vOrNull('pacMedicacion'),
    cirugias:    vOrNull('pacCirugias'),
    cronicas:    vOrNull('pacCronicas'),
    implante:    vOrNull('pacImplante'),
    embarazo:    vOrNull('pacEmbarazo'),

    emerg_nombre:   vOrNull('pacEmergNombre'),
    emerg_relacion: vOrNull('pacEmergRel'),
    emerg_telefono: vOrNull('pacEmergTel'),
    emerg_tel2:     vOrNull('pacEmergTel2'),
    emerg_direccion: vOrNull('pacEmergDir'),

    motivo_consulta:        vOrNull('pacMotivo'),
    observaciones:          vOrNull('pacObs'),
    consentimiento_firmado: consentimientoChecked,
    consentimiento_fecha:   consentimientoChecked ? new Date().toISOString() : null,
  }]).select().single();

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[Bridge] guardarNuevoPaciente:', error);
    return;
  }

  showToast(`✅ ${data.nombre} creado (${data.ref})`);

  if (typeof window.closeModal === 'function') window.closeModal('modalNuevoPaciente');

  // Limpiar form
  ['pacNombre','pacApellido','pacDNI','pacTel','pacTel2','pacEmail','pacDir',
   'pacOcupacion','pacAfiliado','pacPlan','pacVigencia','pacDiag','pacDiag2',
   'pacMedDer','pacMedMat','pacSesiones','pacPesoAltura','pacAlergias',
   'pacMedicacion','pacCirugias','pacCronicas','pacAuth','pacAuthFecha',
   'pacAuthVenc','pacEmergNombre','pacEmergTel','pacEmergTel2','pacEmergDir',
   'pacObs','pacMotivo','pacFechaNac',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const chk = document.getElementById('pacConsentimiento'); if (chk) chk.checked = false;
}

async function crearProfesionalUI(datos) {
  if (!datos?.nombre || !datos?.matricula || !datos?.especialidad) {
    showToast('⚠️ Nombre, matrícula y especialidad son obligatorios');
    return null;
  }

  const iniciales = datos.iniciales ||
    datos.nombre.split(' ').filter(w => /^[A-ZÁÉÍÓÚ]/.test(w)).map(w => w[0]).slice(-2).join('') ||
    datos.nombre.slice(0, 2).toUpperCase();

  const { data, error } = await supabase.from('profesionales').insert([{
    nombre:         datos.nombre,
    iniciales,
    especialidad:   datos.especialidad,
    matricula:      datos.matricula,
    tipo:           datos.tipo || 'Full Time',
    consultorio_id: datos.consultorioId || null,
  }]).select().single();

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[Bridge] crearProfesional:', error);
    return null;
  }

  showToast(`✅ Profesional ${data.nombre} creado`);
  return data;
}

// ============================================================
//  INSTALAR BRIDGE
// ============================================================
export async function instalarBridge() {
  // Orden: agenda primero porque pacientes/profesionales usan AGENDA_DATA para enriquecer
  await hidratarAgenda();
  await Promise.all([
    hidratarConsultorios(),
    hidratarPacientes(),
    hidratarProfesionales(),
  ]);

  suscribirBridgeRealtime();

  window.updateTurnoEstado    = updateTurnoEstadoSupabase;
  window.changeEstado         = changeEstadoSupabase;
  window.guardarNuevoTurno    = guardarNuevoTurnoSupabase;
  window.guardarNuevoPaciente = guardarNuevoPacienteSupabase;
  window.crearPacienteUI      = crearPacienteUI;
  window.crearProfesionalUI   = crearProfesionalUI;

  window.BridgeMod = {
    hidratarAgenda,
    hidratarConsultorios,
    hidratarPacientes,
    hidratarProfesionales,
    suscribirBridgeRealtime,
  };

  console.log('[Bridge] ✅ Instalado — 4 arrays sincronizados desde Supabase');
}
