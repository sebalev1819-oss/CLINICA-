// ============================================================
//  RehabMed ERP — Legacy Bridge
//  Hidrata window.AGENDA_DATA y window.CONSULTORIOS_DATA
//  desde Supabase para que el código legacy del HTML (reportes,
//  búsqueda global, dashboard KPIs, etc.) vea datos reales.
//
//  También intercepta las funciones mutadoras del HTML
//  (guardarNuevoTurno, updateTurnoEstado, changeEstado) y las
//  redirige a Supabase — Realtime refresca en ~1s.
// ============================================================
import { supabase } from './lib/supabase.js';
import { showToast } from './lib/dom.js';

let _rtChannel = null;
let _cacheRaw  = [];   // datos crudos de v_turnos_dia

// ── Map: turno Supabase -> forma legacy que espera el HTML ───
function mapTurnoLegacy(t) {
  const hoyStr = new Date().toISOString().slice(0, 10);
  const fechaStr = t.fecha;
  const esHoy = fechaStr === hoyStr;

  // Cálculo del rango aproximado (hoy/semana/mes) — semana = mismos 7 días
  let rango = 'mes';
  if (esHoy) rango = 'hoy';
  else {
    const hoy = new Date(hoyStr);
    const f   = new Date(fechaStr);
    const diff = (f - hoy) / 86400000;
    if (diff >= 0 && diff <= 7) rango = 'semana';
  }

  const fechaDisplay = esHoy
    ? 'Hoy'
    : new Date(fechaStr + 'T00:00').toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });

  return {
    // legacy shape (usado por el HTML)
    id:       t.id,
    fecha:    fechaDisplay,
    rango,
    hora:     String(t.hora).slice(0, 5),
    pac:      t.pac_nombre || '—',
    prof:     t.prof_nombre || '—',
    c:        t.consultorio_id,
    esp:      t.especialidad,
    tipo:     t.tipo,
    estado:   t.estado,
    cobertura: t.cobertura || t.pac_cobertura,
    nroAut:   t.numero_autorizacion,

    // referencias reales (para mutaciones)
    _fechaISO:       fechaStr,
    _pacienteId:     t.paciente_id,
    _profesionalId:  t.profesional_id,
    _consultorioId:  t.consultorio_id,
  };
}

function mapConsultorioLegacy(c) {
  const prof = Array.isArray(c.profesionales) && c.profesionales[0]
    ? c.profesionales[0].nombre
    : (c.profesionales?.nombre || '—');
  return {
    id:       c.id,
    esp:      c.especialidad,
    estado:   c.estado,
    prof,
    pac:      '—', // se rellena cuando hay turno En curso
    _real:    true,
  };
}

// ============================================================
//  HIDRATAR AGENDA
// ============================================================
export async function hidratarAgenda() {
  const { data, error } = await supabase
    .from('v_turnos_dia')
    .select('*')
    .order('fecha', { ascending: true })
    .order('hora',  { ascending: true });

  if (error) {
    console.error('[Bridge] Error al cargar turnos:', error.message);
    return;
  }

  _cacheRaw = data || [];
  const mapeado = _cacheRaw.map(mapTurnoLegacy);

  // Mutar in-place para preservar referencias
  if (!Array.isArray(window.AGENDA_DATA)) window.AGENDA_DATA = [];
  window.AGENDA_DATA.length = 0;
  window.AGENDA_DATA.push(...mapeado);

  console.log(`[Bridge] ✅ AGENDA_DATA hidratada (${mapeado.length} turnos)`);

  // Re-render KPIs del dashboard si existe la función
  if (typeof window.updateDashboardKPIs === 'function') {
    try { window.updateDashboardKPIs(); } catch (e) { /* noop */ }
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

  if (error) {
    console.error('[Bridge] Error al cargar consultorios:', error.message);
    return;
  }

  const mapeado = (data || []).map(mapConsultorioLegacy);

  // Enriquecer con paciente "en curso" desde AGENDA_DATA (si hay)
  const enCurso = (window.AGENDA_DATA || []).filter(t => t.estado === 'En curso');
  mapeado.forEach(c => {
    const turno = enCurso.find(t => Number(t._consultorioId) === Number(c.id));
    if (turno) c.pac = turno.pac;
  });

  if (!Array.isArray(window.CONSULTORIOS_DATA)) window.CONSULTORIOS_DATA = [];
  window.CONSULTORIOS_DATA.length = 0;
  window.CONSULTORIOS_DATA.push(...mapeado);

  console.log(`[Bridge] ✅ CONSULTORIOS_DATA hidratada (${mapeado.length})`);

  if (typeof window.renderConsultorios === 'function') {
    try { window.renderConsultorios(); } catch (e) { /* noop */ }
  }
}

// ============================================================
//  REALTIME — refresca ambos arrays ante cambios
// ============================================================
export function suscribirBridgeRealtime() {
  if (_rtChannel) supabase.removeChannel(_rtChannel);

  _rtChannel = supabase
    .channel('bridge-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'turnos' },
      async () => {
        await hidratarAgenda();
        await hidratarConsultorios();
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'consultorios' },
      async () => { await hidratarConsultorios(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pacientes' },
      async () => { await hidratarAgenda(); })
    .subscribe();
}

// ============================================================
//  INTERCEPTAR MUTADORES DEL HTML
// ============================================================

/**
 * updateTurnoEstado(pac, newState, toastMsg) — el HTML pasa nombre del paciente.
 * Buscamos el turno hoy con ese nombre y lo actualizamos por ID en Supabase.
 */
async function updateTurnoEstadoSupabase(pac, newState, toastMsg) {
  const turno = (window.AGENDA_DATA || []).find(
    t => t.pac === pac && t.rango === 'hoy' && !['Cancelado','Finalizado','No Show'].includes(t.estado)
  );
  if (!turno) {
    showToast(`⚠️ No encuentro turno activo de ${pac}`);
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('turnos')
    .update({ estado: newState, updated_by: user?.id })
    .eq('id', turno.id);

  if (error) {
    console.error('[Bridge] updateTurnoEstado:', error);
    showToast('❌ No se pudo actualizar');
    return;
  }

  showToast(toastMsg || `✅ ${pac}: → ${newState}`);
  // Realtime se encarga del refresh
}

/**
 * changeEstado(idx, newEstado) — el HTML pasa índice del array AGENDA_DATA.
 * Usamos el array actual para encontrar el UUID.
 */
async function changeEstadoSupabase(idx, newEstado) {
  const t = (window.AGENDA_DATA || [])[idx];
  if (!t) return;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('turnos')
    .update({ estado: newEstado, updated_by: user?.id })
    .eq('id', t.id);

  if (error) {
    console.error('[Bridge] changeEstado:', error);
    showToast('❌ No se pudo actualizar');
    return;
  }
  showToast(`✅ ${t.pac}: ${t.estado} → ${newEstado}`);
}

/**
 * guardarNuevoTurno() — lee los inputs del modal y crea el turno en Supabase.
 * El HTML tiene dos definiciones: sobreescribimos window.guardarNuevoTurno
 * después del load, que es lo que los onclick resuelven.
 */
async function guardarNuevoTurnoSupabase() {
  const pacNombre  = document.getElementById('turnoPac')?.value;
  const profNombre = document.getElementById('turnoProf')?.value;
  const fecha      = document.getElementById('turnoFecha')?.value || new Date().toISOString().slice(0,10);
  const hora       = document.getElementById('turnoHora')?.value;
  const esp        = document.getElementById('turnoEsp')?.value || 'Kinesiología';
  const tipo       = document.getElementById('turnoTipo')?.value || 'Presencial';
  const pagoTipo   = document.getElementById('turnoPagoTipo')?.value || 'particular';
  const cobertura  = pagoTipo !== 'particular'
    ? document.getElementById('turnoCobertura')?.value
    : 'Particular';
  const nroAut = document.getElementById('turnoNroAut')?.value || null;

  if (!pacNombre || !profNombre || !hora) {
    showToast('⚠️ Completá paciente, profesional y hora');
    return;
  }
  if (pagoTipo !== 'particular' && (!cobertura || !nroAut)) {
    showToast('🚫 Cobertura y Nº de autorización son obligatorios');
    return;
  }

  // Resolver IDs a partir de los nombres del dropdown
  const { data: pac, error: errPac } = await supabase
    .from('pacientes').select('id').eq('nombre', pacNombre).limit(1).maybeSingle();
  if (errPac || !pac) { showToast(`⚠️ Paciente "${pacNombre}" no encontrado`); return; }

  const { data: prof, error: errProf } = await supabase
    .from('profesionales').select('id, consultorio_id').eq('nombre', profNombre).limit(1).maybeSingle();
  if (errProf || !prof) { showToast(`⚠️ Profesional "${profNombre}" no encontrado`); return; }

  const consultorio_id = prof.consultorio_id || 1;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('turnos').insert([{
    fecha, hora, duracion_min: 45,
    paciente_id:    pac.id,
    profesional_id: prof.id,
    consultorio_id,
    especialidad:   esp,
    tipo,
    estado:         'Pendiente',
    cobertura,
    numero_autorizacion: nroAut,
    created_by:     user?.id,
  }]);

  if (error) {
    if (error.code === '23P01') {
      showToast('⚠️ Ya hay un turno en ese horario (consultorio o profesional)');
    } else {
      showToast('❌ Error al crear el turno');
      console.error('[Bridge]', error);
    }
    return;
  }

  if (typeof window.closeModal === 'function') window.closeModal('modalNuevoTurno');
  showToast(`✅ Turno creado: ${pacNombre} — ${hora}`);
  // Realtime refresca AGENDA_DATA y re-renderiza
}

// ============================================================
//  INSTALAR BRIDGE — llamar una sola vez tras iniciarERP
// ============================================================
export async function instalarBridge() {
  await hidratarAgenda();
  await hidratarConsultorios();
  suscribirBridgeRealtime();

  // Sobreescribir mutadores del HTML
  window.updateTurnoEstado = updateTurnoEstadoSupabase;
  window.changeEstado      = changeEstadoSupabase;
  window.guardarNuevoTurno = guardarNuevoTurnoSupabase;

  // Exponer helpers por si el código legacy quiere recargar manualmente
  window.BridgeMod = {
    hidratarAgenda,
    hidratarConsultorios,
    suscribirBridgeRealtime,
  };

  console.log('[Bridge] ✅ Instalado — AGENDA_DATA y CONSULTORIOS_DATA sincronizados');
}
