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
//  POBLAR <select> DEL MODAL "Nuevo Turno"
//  Reemplaza las <option> hardcodeadas con datos reales
// ============================================================
function popularSelectPacientes() {
  const sel = document.getElementById('turnoPac');
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">Seleccionar...</option>' +
    (window.PACIENTES_DATA || [])
      .map(p => `<option value="${escAttr(p.nombre)}" data-id="${escAttr(p.id)}">${escHtml(p.nombre)}</option>`)
      .join('');
  if (actual) sel.value = actual;
}

function popularSelectProfesionales() {
  const sel = document.getElementById('turnoProf');
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">Seleccionar...</option>' +
    (window.PROFESIONALES_DATA || [])
      .map(p => `<option value="${escAttr(p.nombre)}" data-id="${escAttr(p.id)}" data-esp="${escAttr(p.esp)}" data-consultorio="${escAttr(p.c)}">${escHtml(p.nombre)} · ${escHtml(p.esp)}</option>`)
      .join('');
  if (actual) sel.value = actual;
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
  const selPac  = document.getElementById('turnoPac');
  const selProf = document.getElementById('turnoProf');
  const pacNombre  = selPac?.value;
  const profNombre = selProf?.value;
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

  // IDs desde los <option data-id="...">
  const pacOpt  = selPac.options[selPac.selectedIndex];
  const profOpt = selProf.options[selProf.selectedIndex];
  const pacId   = pacOpt?.getAttribute('data-id');
  const profId  = profOpt?.getAttribute('data-id');
  const consultorio_id = Number(profOpt?.getAttribute('data-consultorio')) || 1;

  if (!pacId || !profId) {
    showToast('⚠️ Seleccioná paciente y profesional de la lista');
    return;
  }

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

  const nombre   = v('pacNombre');
  const apellido = v('pacApellido');
  if (!nombre || !apellido) { showToast('⚠️ Nombre y Apellido son obligatorios'); return; }

  const fullName = `${nombre} ${apellido}`.trim();
  const dni      = v('pacDNI');
  if (!dni) { showToast('⚠️ DNI es obligatorio'); return; }

  // Datos adicionales → notas estructuradas (hasta que ampliemos el schema)
  const extras = {
    genero:          v('pacGenero'),
    estado_civil:    v('pacEstCivil'),
    telefono2:       v('pacTel2'),
    direccion:       v('pacDir'),
    ocupacion:       v('pacOcupacion'),
    nacionalidad:    v('pacNacionalidad'),
    plan:            v('pacPlan'),
    vigencia_cob:    v('pacVigencia'),
    diag_secundario: v('pacDiag2'),
    especialidad:    v('pacEsp'),
    medico_derivante: v('pacMedDer'),
    mat_derivante:   v('pacMedMat'),
    sesiones_auth:   v('pacSesiones'),
    grupo_sanguineo: v('pacSangre'),
    peso_altura:     v('pacPesoAltura'),
    alergias:        v('pacAlergias'),
    medicacion:      v('pacMedicacion'),
    cirugias:        v('pacCirugias'),
    cronicas:        v('pacCronicas'),
    implante:        v('pacImplante'),
    embarazo:        v('pacEmbarazo'),
    emergencia: {
      nombre:   v('pacEmergNombre'),
      relacion: v('pacEmergRel'),
      telefono: v('pacEmergTel'),
      tel2:     v('pacEmergTel2'),
      direccion: v('pacEmergDir'),
    },
    motivo_consulta: v('pacMotivo'),
    observaciones:   v('pacObs'),
    consentimiento:  document.getElementById('pacConsentimiento')?.checked === true,
  };
  // Eliminar strings vacíos para que notas quede más limpio
  const notasObj = Object.fromEntries(
    Object.entries(extras).filter(([, v2]) =>
      v2 !== '' && !(typeof v2 === 'object' && Object.values(v2).every(x => x === '' || x === false))
    )
  );

  const data = await crearPacienteUI({
    nombre:          fullName,
    dni,
    telefono:        v('pacTel'),
    email:           v('pacEmail'),
    fechaNacimiento: v('pacFechaNac') || null,
    cobertura:       v('pacCob') || 'Particular',
    numeroAfiliado:  v('pacAfiliado'),
    diagnostico:     v('pacDiag') || v('pacMotivo') || null,
    notas:           Object.keys(notasObj).length ? JSON.stringify(notasObj) : null,
  });

  if (!data) return;

  if (typeof window.closeModal === 'function') window.closeModal('modalNuevoPaciente');

  // Limpiar form (los inputs principales)
  ['pacNombre','pacApellido','pacDNI','pacTel','pacTel2','pacEmail','pacDir',
   'pacOcupacion','pacAfiliado','pacPlan','pacDiag','pacDiag2','pacMedDer','pacMedMat',
   'pacSesiones','pacPesoAltura','pacAlergias','pacMedicacion','pacCirugias','pacCronicas',
   'pacAuth','pacEmergNombre','pacEmergTel','pacEmergTel2','pacEmergDir','pacObs','pacMotivo',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const chk = document.getElementById('pacConsentimiento'); if (chk) chk.checked = false;

  // Realtime refresca PACIENTES_DATA y re-popula el <select> de turnos
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
