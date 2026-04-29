// ============================================================
//  RehabMed ERP — Módulo Agenda
//  Reemplaza: AGENDA_DATA array + renderAgenda() estático
//  Agrega: Supabase Realtime para sincronización en tiempo real
// ============================================================
import { supabase } from './lib/supabase.js';
import { currentProfile } from './auth.js';

// ── Estado del módulo ─────────────────────────────────────
let _agendaData       = [];        // cache local de turnos
let _realtimeChannel  = null;      // canal activo de Supabase Realtime
let _filtroActivo     = 'hoy';     // 'hoy' | 'semana' | 'mes'
let _searchQuery      = '';

// ── Colores de estado (igual que el HTML original) ────────
const ESTADO_COLOR = {
  'Confirmado':    'var(--emerald)',
  'En curso':      'var(--sky)',
  'Pendiente':     'var(--amber)',
  'No Show':       'var(--rose)',
  'Cancelado':     'var(--text4)',
  'Reprogramado':  'var(--violet)',
  'Lista espera':  'var(--orange)',
  'Finalizado':    'var(--text3)',
};
const ESTADO_BG = {
  'Confirmado':    'rgba(5,150,105,0.1)',
  'En curso':      'rgba(3,105,161,0.1)',
  'Pendiente':     'rgba(217,119,6,0.1)',
  'No Show':       'rgba(225,29,72,0.1)',
  'Cancelado':     'rgba(148,163,184,0.1)',
  'Reprogramado':  'rgba(124,58,237,0.1)',
  'Lista espera':  'rgba(234,88,12,0.1)',
  'Finalizado':    'rgba(100,116,139,0.1)',
};

// ============================================================
//  CARGAR AGENDA DESDE SUPABASE
// ============================================================
export async function cargarAgenda(filtro = 'hoy') {
  _filtroActivo = filtro;

  const hoy = new Date().toISOString().slice(0, 10);
  let desde = hoy;
  let hasta = hoy;

  if (filtro === 'semana') {
    const dom = new Date();
    dom.setDate(dom.getDate() - dom.getDay());
    const sab = new Date(dom);
    sab.setDate(sab.getDate() + 6);
    desde = dom.toISOString().slice(0, 10);
    hasta = sab.toISOString().slice(0, 10);
  } else if (filtro === 'mes') {
    desde = hoy.slice(0, 7) + '-01';
    hasta = new Date(new Date(hoy).getFullYear(), new Date(hoy).getMonth() + 1, 0)
      .toISOString().slice(0, 10);
  }

  // Si es profesional, filtrar por sus turnos (RLS también lo hace en el servidor)
  let query = supabase
    .from('v_turnos_dia')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora',  { ascending: true });

  const { data, error } = await query;

  if (error) {
    console.error('[Agenda] ❌ Error al cargar:', error.message);
    showToast('❌ Error al cargar la agenda');
    return;
  }

  _agendaData = data || [];
  renderAgenda(_agendaData);
  console.log(`[Agenda] ✅ ${_agendaData.length} turnos cargados (${filtro})`);
}

// ============================================================
//  SUSCRIPCIÓN REALTIME — se actualiza automáticamente
// ============================================================
export function suscribirRealtime() {
  // Evitar duplicados
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
  }

  _realtimeChannel = supabase
    .channel('agenda-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'turnos' },
      (payload) => {
        console.log('[Realtime] 📡 Cambio en turnos:', payload.eventType);
        manejarCambioRealtime(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'consultorios' },
      (payload) => {
        console.log('[Realtime] 📡 Cambio en consultorio:', payload.new.nombre);
        actualizarConsultorioEnUI(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Estado:', status);
      if (status === 'SUBSCRIBED') {
        actualizarIndicadorRealtime(true);
      } else {
        actualizarIndicadorRealtime(false);
      }
    });
}

function manejarCambioRealtime(payload) {
  const { eventType, new: nuevo, old: viejo } = payload;

  if (eventType === 'INSERT') {
    // Agregar turno nuevo si está en el rango actual
    // Re-cargar para obtener el JOIN completo (paciente, profesional, consultorio)
    cargarAgenda(_filtroActivo);
    showToast('📅 Nuevo turno agregado');
    return;
  }

  if (eventType === 'UPDATE') {
    const idx = _agendaData.findIndex(t => t.id === nuevo.id);
    if (idx !== -1) {
      // Actualizar solo el turno cambiado sin recargar todo
      Object.assign(_agendaData[idx], { estado: nuevo.estado });
      renderAgenda(_agendaData);
      // Si cambió el estado del consultorio, actualizar panel
      if (viejo.estado !== nuevo.estado) {
        mostrarNotificacionCambio(nuevo);
      }
    } else {
      // Turno no estaba en cache (quizás cambió de fecha al rango actual)
      cargarAgenda(_filtroActivo);
    }
    return;
  }

  if (eventType === 'DELETE') {
    _agendaData = _agendaData.filter(t => t.id !== viejo.id);
    renderAgenda(_agendaData);
    showToast('🗑️ Turno eliminado');
  }
}

function mostrarNotificacionCambio(turno) {
  const msg = `${turno.pac_nombre || 'Paciente'} → ${turno.estado}`;
  showToast(`📡 ${msg}`);
}

function actualizarIndicadorRealtime(conectado) {
  const dot  = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (!dot || !text) return;
  if (conectado) {
    dot.style.background  = 'var(--emerald)';
    text.textContent      = 'En vivo';
  } else {
    dot.style.background  = 'var(--amber)';
    text.textContent      = 'Reconectando...';
  }
}

// ============================================================
//  ACTUALIZAR ESTADO DE TURNO → Supabase
// ============================================================
export async function updateTurnoEstado(turnoId, nuevoEstado, toastMsg) {
  const { error } = await supabase
    .from('turnos')
    .update({
      estado:     nuevoEstado,
      updated_by: (await supabase.auth.getUser()).data.user?.id,
    })
    .eq('id', turnoId);

  if (error) {
    console.error('[Agenda] ❌ Error al actualizar turno:', error.message);
    showToast('❌ No se pudo actualizar el estado');
    return false;
  }

  // El Realtime se encarga de actualizar la UI
  showToast(`✅ ${toastMsg}`);

  // NOTA: estado del consultorio se gestiona por triggers SQL (003 y 004):
  //   • turno → 'En curso'    : (no implementado todavía)
  //   • turno → 'Finalizado'  : trigger consultorio_a_limpieza setea estado=limpieza
  //                             y limpieza_hasta = now() + 15min (configurable)
  // El cliente solo se encarga de "En curso → ocupado" mientras no haya trigger:
  if (nuevoEstado === 'En curso') {
    const turno = _agendaData.find(t => t.id === turnoId);
    if (turno) {
      await supabase
        .from('consultorios')
        .update({ estado: 'ocupado' })
        .eq('id', turno.consultorio_id);
    }
  }

  return true;
}

// ============================================================
//  CREAR NUEVO TURNO
// ============================================================
export async function crearTurno(datos) {
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('turnos')
    .insert([{
      fecha:            datos.fecha,
      hora:             datos.hora,
      duracion_min:     datos.duracion || 45,
      paciente_id:      datos.pacienteId,
      profesional_id:   datos.profesionalId,
      consultorio_id:   datos.consultorioId,
      especialidad:     datos.especialidad,
      tipo:             datos.tipo || 'Presencial',
      estado:           'Pendiente',
      cobertura:        datos.cobertura,
      numero_autorizacion: datos.autorizacion,
      notas:            datos.notas,
      created_by:       user?.user?.id,
    }])
    .select()
    .single();

  if (error) {
    // Detectar solapamiento (constraint de PostgreSQL)
    if (error.code === '23P01') {
      showToast('⚠️ El consultorio ya tiene un turno en ese horario');
    } else {
      showToast('❌ Error al crear el turno: ' + error.message);
      console.error('[Agenda] ❌', error);
    }
    return null;
  }

  showToast('✅ Turno creado correctamente');
  // El Realtime INSERT actualizará la agenda automáticamente
  return data;
}

// ============================================================
//  FILTRAR AGENDA (búsqueda local sobre cache)
// ============================================================
export function filterAgenda(q) {
  _searchQuery = q;
  const filtrados = _agendaData.filter(t =>
    !q ||
    (t.pac_nombre  || '').toLowerCase().includes(q.toLowerCase()) ||
    (t.prof_nombre || '').toLowerCase().includes(q.toLowerCase()) ||
    (t.especialidad|| '').toLowerCase().includes(q.toLowerCase())
  );
  renderAgenda(filtrados);
}

// ============================================================
//  RENDER (igual que el HTML original, adaptado a la vista)
// ============================================================
function renderAgenda(data) {
  // Actualizar tabla compacta (si existe)
  const tb = document.getElementById('agendaTbody');
  if (tb) {
    tb.innerHTML = data.slice(0, 10).map(t => {
      const estadoColor = ESTADO_COLOR[t.estado] || 'var(--text3)';
      return `
      <tr>
        <td style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--sky2)">${String(t.hora).slice(0,5)}</td>
        <td>
          <div style="font-weight:700;color:var(--text)">${t.pac_nombre || '—'}</div>
          <div style="font-size:10px;color:var(--text4)">${t.prof_nombre || '—'}</div>
        </td>
        <td><span class="badge badge-sky">C${t.consultorio_id || '—'}</span></td>
        <td style="font-size:12px;color:var(--text3)">${t.especialidad || '—'}</td>
        <td><span style="background:${ESTADO_BG[t.estado]||'rgba(0,0,0,0.05)'};color:${estadoColor};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">${t.estado}</span></td>
      </tr>`;
    }).join('');
  }

  // Actualizar timeline principal
  const timeline = document.getElementById('agendaTimeline');
  if (!timeline) return;

  const subtitle = document.getElementById('agendaSubtitle');
  if (subtitle) subtitle.textContent = `${data.length} turno${data.length !== 1 ? 's' : ''} en total`;

  if (data.length === 0) {
    timeline.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text4)">
      <div style="font-size:40px;margin-bottom:12px">📅</div>
      <div style="font-size:15px;font-weight:700;color:var(--text3)">Sin turnos para este período</div>
      <div style="font-size:12px;margin-top:4px">Creá un nuevo turno usando el botón superior</div>
    </div>`;
    return;
  }

  // Agrupar por hora
  const byHour = {};
  data.forEach(t => {
    const h = String(t.hora).slice(0, 5);
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(t);
  });
  const sortedHours = Object.keys(byHour).sort();

  timeline.innerHTML = sortedHours.map(hora => {
    const turnos = byHour[hora];
    return `
    <div class="agenda-hour-block">
      <div class="agenda-hour-label">
        <div class="agenda-hour-time">${hora}</div>
        <div class="agenda-hour-count">${turnos.length} turno${turnos.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="agenda-hour-cards">
        ${turnos.map(t => renderTurnoCard(t)).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderTurnoCard(t) {
  const initials    = (t.pac_nombre || '??').split(' ').map(w => w[0]).slice(0, 2).join('');
  const estadoColor = ESTADO_COLOR[t.estado] || 'var(--text3)';
  const estadoBg    = ESTADO_BG[t.estado]    || 'rgba(0,0,0,0.05)';
  const esParticular = !t.pac_cobertura || t.pac_cobertura === 'Particular';
  const cob = t.cobertura || t.pac_cobertura || 'Particular';

  const cobTag = esParticular
    ? `<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(5,150,105,0.1);color:var(--emerald);font-weight:600">💰 Particular</span>`
    : `<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(14,165,233,0.1);color:var(--sky2);font-weight:600">🏥 ${cob}</span>`;

  // Botones de acción — pasan el ID real del turno
  const id = t.id;
  return `<div class="agenda-turno-card">
    <div class="agenda-card-left-bar" style="background:${estadoColor}"></div>
    <div class="agenda-card-body">
      <div class="agenda-card-top">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <div class="avatar" style="width:38px;height:38px;font-size:13px;flex-shrink:0;background:linear-gradient(135deg,${estadoColor}88,${estadoColor}44);color:${estadoColor};border:2px solid ${estadoColor}33">${initials}</div>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.pac_nombre || '—'}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:1px">${t.prof_nombre || '—'} · <span style="color:var(--sky2)">${t.especialidad || '—'}</span></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="background:${estadoBg};color:${estadoColor};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid ${estadoColor}33">${t.estado}</span>
        </div>
      </div>
      <div class="agenda-card-meta">
        <span class="agenda-meta-chip" style="background:rgba(3,105,161,0.07);color:var(--sky)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          C${t.consultorio_id || '—'}
        </span>
        <span class="agenda-meta-chip" style="background:rgba(0,0,0,0.04);color:var(--text3)">
          ${t.tipo || 'Presencial'}
        </span>
        ${cobTag}
      </div>
      <div class="agenda-card-actions">
        <button class="agenda-action-btn confirm"
          onclick="askConfirmAction('Confirmar Asistencia','¿Confirmar asistencia de ${(t.pac_nombre||'').replace(/'/g,"\\'")}?','✅',()=>window.AgendaMod.updateTurnoEstado('${id}','Confirmado','Confirmado ✅'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirmar
        </button>
        <button class="agenda-action-btn noshow"
          onclick="askConfirmAction('No-Show','¿Registrar No-Show para ${(t.pac_nombre||'').replace(/'/g,"\\'")}?','❌',()=>window.AgendaMod.updateTurnoEstado('${id}','No Show','No-Show registrado'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> No-Show
        </button>
        <button class="agenda-action-btn cancel"
          onclick="askConfirmAction('Cancelar','¿Cancelar el turno de ${(t.pac_nombre||'').replace(/'/g,"\\'")}?','🗑️',()=>window.AgendaMod.updateTurnoEstado('${id}','Cancelado','Turno cancelado'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Cancelar
        </button>
        <button class="agenda-action-btn reschedule"
          onclick="askConfirmAction('Reprogramar','¿Reprogramar el turno de ${(t.pac_nombre||'').replace(/'/g,"\\'")}?','↻',()=>window.AgendaMod.updateTurnoEstado('${id}','Reprogramado','Listo para reprogramar'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Reprogramar
        </button>
      </div>
    </div>
  </div>`;
}

// ============================================================
//  ACTUALIZAR CONSULTORIO EN UI (desde Realtime)
// ============================================================
function actualizarConsultorioEnUI(consultorio) {
  // El panel de consultorios se re-renderiza al recibir el evento
  if (typeof renderConsultorios === 'function') {
    renderConsultorios();
  }
}

// ============================================================
//  CONSULTORIOS EN TIEMPO REAL
// ============================================================
export async function cargarConsultorios() {
  const { data, error } = await supabase
    .from('consultorios')
    .select(`
      *,
      profesionales (nombre)
    `)
    .order('id');

  if (error) {
    console.error('[Consultorios] ❌', error.message);
    return [];
  }
  return data;
}

// ============================================================
//  EXPORT para acceso global desde el HTML inline
// ============================================================
window.AgendaMod = {
  cargarAgenda,
  filterAgenda,
  updateTurnoEstado,
  crearTurno,
  suscribirRealtime,
  cargarConsultorios,
};
