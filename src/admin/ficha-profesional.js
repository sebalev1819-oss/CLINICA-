// ============================================================
//  RehabMed ERP — Ficha 360 del Profesional
//
//  Vista unificada con 2 tabs:
//    📋 Configuración: datos personales + horarios + excepciones
//    📅 Agenda semanal: slots libres/ocupados + click para crear turno
//
//  Reemplaza los 5 botones sueltos de la card por una sola vista
//  donde se gestiona todo el día a día del profesional.
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { formatSupabaseError } from '../lib/errors.js';
import { crearModal, cerrarModal } from './config.js';

// ── Constantes ────────────────────────────────────────────
const DIAS = [
  { num: 1, label: 'Lunes',     corto: 'Lun' },
  { num: 2, label: 'Martes',    corto: 'Mar' },
  { num: 3, label: 'Miércoles', corto: 'Mié' },
  { num: 4, label: 'Jueves',    corto: 'Jue' },
  { num: 5, label: 'Viernes',   corto: 'Vie' },
  { num: 6, label: 'Sábado',    corto: 'Sáb' },
  { num: 0, label: 'Domingo',   corto: 'Dom' },
];

const COLOR_ESTADO = {
  'Pendiente':    { bg: '#fef3c7', text: '#92400e' },
  'Confirmado':   { bg: '#d1fae5', text: '#065f46' },
  'En curso':     { bg: '#dbeafe', text: '#1e3a8a' },
  'Finalizado':   { bg: '#ddd6fe', text: '#5b21b6' },
  'No Show':      { bg: '#fee2e2', text: '#991b1b' },
  'Cancelado':    { bg: '#f3f4f6', text: '#6b7280' },
  'Reprogramado': { bg: '#fed7aa', text: '#9a3412' },
  'Lista espera': { bg: '#fce7f3', text: '#9d174d' },
};

const TIPO_EXCEPCION = [
  { value: 'feriado',         label: '🎉 Feriado' },
  { value: 'ausencia',        label: '🚫 Ausencia' },
  { value: 'vacaciones',      label: '🏖️ Vacaciones' },
  { value: 'licencia_medica', label: '🤒 Licencia médica' },
  { value: 'dia_extra',       label: '➕ Día extra' },
  { value: 'otro',            label: '❓ Otro' },
];

// ── Estado del módulo ─────────────────────────────────────
let _profActual = null;
let _modalActual = null;
let _semanaActual = null;     // Lunes 00:00 de la semana visible
let _tabActiva = 'config';

// ============================================================
//  ENTRADA PRINCIPAL
// ============================================================
export async function abrirFichaProfesional(profId) {
  // Cargar profesional fresco desde DB (no usar cache que puede estar desactualizada)
  const { data: prof, error } = await supabase
    .from('profesionales')
    .select('*')
    .eq('id', profId)
    .single();

  if (error || !prof) {
    showToast('❌ ' + formatSupabaseError(error || { message: 'No se encontró el profesional' }, 'profesional'));
    return;
  }

  _profActual = prof;
  _semanaActual = lunesDeLaSemana(new Date());
  _tabActiva = 'config';

  _modalActual = crearModal('modalFichaProf', renderEsqueleto(prof));
  _modalActual.querySelector('.modal').style.cssText = 'width:920px;max-width:96vw;max-height:92vh;overflow:hidden;display:flex;flex-direction:column';

  // Listeners de tabs
  _modalActual.querySelectorAll('[data-tab-btn]').forEach(btn => {
    btn.addEventListener('click', () => cambiarTab(btn.getAttribute('data-tab-btn')));
  });

  // Render inicial
  await renderTabConfig();
}

// ============================================================
//  ESQUELETO DEL MODAL
// ============================================================
function renderEsqueleto(prof) {
  const inicialesHTML = `<div class="avatar avatar-md" style="background:linear-gradient(135deg,#0ea5e9,#8b5cf6);color:#fff;font-weight:700;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:16px;flex-shrink:0">${escapeHtml(prof.iniciales || '??')}</div>`;

  return `
    <!-- HEADER fijo -->
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(3,105,161,0.04),rgba(124,58,237,0.04));flex-shrink:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
        <div style="display:flex;gap:14px;align-items:center;flex:1;min-width:0">
          ${inicialesHTML}
          <div style="min-width:0">
            <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:2px">${escapeHtml(prof.nombre || '')}</div>
            <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${escapeHtml(prof.especialidad || '')} · Mat. ${escapeHtml(prof.matricula || '')} · ${escapeHtml(prof.tipo || 'Full Time')}</div>
            <div style="font-size:11px;color:var(--text4);display:flex;gap:14px;flex-wrap:wrap">
              ${prof.email ? `<span>✉️ ${escapeHtml(prof.email)}</span>` : ''}
              ${prof.telefono ? `<span>📞 ${escapeHtml(prof.telefono)}</span>` : ''}
              ${prof.consultorio_id ? `<span>🏥 Consultorio ${prof.consultorio_id}</span>` : ''}
            </div>
          </div>
        </div>
        <button class="modal-close" data-cerrar style="flex-shrink:0">×</button>
      </div>

      <!-- TABS -->
      <div style="display:flex;gap:2px;margin-top:14px;background:var(--bg);border-radius:8px;padding:4px;width:fit-content">
        <button data-tab-btn="config" class="ficha-tab" style="background:var(--bg3);color:var(--sky);font-weight:700;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;transition:all 0.15s">📋 Configuración</button>
        <button data-tab-btn="agenda" class="ficha-tab" style="background:transparent;color:var(--text3);padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;transition:all 0.15s">📅 Agenda semanal</button>
      </div>
    </div>

    <!-- CONTENIDO DE LA TAB (scroll interno) -->
    <div id="fichaContent" style="flex:1;overflow-y:auto;padding:18px 20px">
      <div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando...</div>
    </div>
  `;
}

function cambiarTab(tab) {
  if (_tabActiva === tab) return;
  _tabActiva = tab;

  // Actualizar estilos de botones
  _modalActual.querySelectorAll('[data-tab-btn]').forEach(btn => {
    if (btn.getAttribute('data-tab-btn') === tab) {
      btn.style.background = 'var(--bg3)';
      btn.style.color = 'var(--sky)';
      btn.style.fontWeight = '700';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text3)';
      btn.style.fontWeight = '500';
    }
  });

  if (tab === 'config') renderTabConfig();
  else if (tab === 'agenda') renderTabAgenda();
}

// ============================================================
//  TAB 1 — CONFIGURACIÓN
//  Estructura interna: 3 secciones colapsables
//    1. Datos del profesional (acordeón cerrado)
//    2. Horarios y duración por consulta (visible)
//    3. Excepciones (acordeón cerrado)
// ============================================================
async function renderTabConfig() {
  const cont = _modalActual.querySelector('#fichaContent');
  cont.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando configuración...</div>';

  // Cargar datos en paralelo
  const [horR, excR] = await Promise.all([
    supabase.from('profesionales_horarios')
      .select('*').eq('profesional_id', _profActual.id).eq('activo', true)
      .order('dia_semana').order('hora_inicio'),
    supabase.from('profesionales_excepciones')
      .select('*').eq('profesional_id', _profActual.id)
      .gte('fecha', new Date().toISOString().slice(0, 10))
      .order('fecha').limit(20),
  ]);

  const horarios = horR.data || [];
  const excepciones = excR.data || [];

  // Agrupar horarios por día
  const horariosPorDia = {};
  DIAS.forEach(d => { horariosPorDia[d.num] = []; });
  horarios.forEach(h => { horariosPorDia[h.dia_semana].push(h); });

  cont.innerHTML = `
    <!-- ═══════ SECCIÓN 1: HORARIOS (lo más importante, visible) ═══════ -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">🕐 Horarios de atención</div>
          <div style="font-size:11px;color:var(--text4);margin-top:2px">Días, franjas horarias y duración por consulta</div>
        </div>
        <button class="btn btn-sky btn-sm" id="btnGuardarConfig">💾 Guardar cambios</button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Duración por consulta</label>
          <select class="form-select" id="cfgDuracion">
            ${[15,20,30,45,60,90,120].map(m => `<option value="${m}" ${(_profActual.duracion_consulta || 45) === m ? 'selected' : ''}>${m} min</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Anticipación mínima</label>
          <input class="form-input" id="cfgAntic" type="number" min="0" max="72" value="${_profActual.min_anticipacion_hs || 2}">
          <div style="font-size:10px;color:var(--text4);margin-top:2px">Horas antes del turno para poder agendarlo</div>
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin:14px 0 8px">Días de atención</div>
      <div style="font-size:11px;color:var(--text4);margin-bottom:10px">Podés agregar varias franjas el mismo día (ej: 09:00-13:00 mañana + 14:00-19:00 tarde).</div>

      <div id="cfgDias" style="display:flex;flex-direction:column;gap:8px">
        ${DIAS.map(d => renderDia(d, horariosPorDia[d.num])).join('')}
      </div>
    </div>

    <!-- ═══════ SECCIÓN 2: DATOS DEL PROFESIONAL (acordeón) ═══════ -->
    <details style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:0 18px;margin-bottom:14px">
      <summary style="cursor:pointer;list-style:none;outline:none;padding:14px 0;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px;font-weight:700;color:var(--text)">👤 Datos del profesional</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text4)">click para editar contacto y administrativos</span>
      </summary>
      <div style="padding-bottom:16px">
        ${renderFormDatosProf(_profActual)}
        <button class="btn btn-violet btn-sm" id="btnGuardarDatos" style="margin-top:8px">💾 Guardar datos</button>
      </div>
    </details>

    <!-- ═══════ SECCIÓN 3: EXCEPCIONES (acordeón) ═══════ -->
    <details style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:0 18px">
      <summary style="cursor:pointer;list-style:none;outline:none;padding:14px 0;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px;font-weight:700;color:var(--text)">📆 Excepciones (feriados, vacaciones, ausencias)</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text4)">${excepciones.length} próximas</span>
      </summary>
      <div style="padding-bottom:16px">
        ${renderFormExcepcion()}
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 8px">Excepciones próximas (${excepciones.length})</div>
        <div id="excList">
          ${excepciones.length === 0
            ? `<div style="text-align:center;padding:24px;color:var(--text4);font-size:12px;background:var(--bg);border-radius:8px">Sin excepciones registradas hacia adelante</div>`
            : excepciones.map(renderExcepcionRow).join('')}
        </div>
      </div>
    </details>
  `;

  // Event handlers de horarios
  cont.querySelector('#cfgDias').addEventListener('click', (ev) => {
    const addBtn = ev.target.closest('[data-add-franja]');
    if (addBtn) {
      const dia = addBtn.getAttribute('data-add-franja');
      const c = cont.querySelector(`[data-dia-franjas="${dia}"]`);
      c.insertAdjacentHTML('beforeend', renderFranja('09:00', '13:00'));
      return;
    }
    const delBtn = ev.target.closest('[data-del-franja]');
    if (delBtn) delBtn.closest('[data-franja]').remove();
  });

  cont.querySelector('#btnGuardarConfig').onclick = () => guardarHorarios(cont);
  cont.querySelector('#btnGuardarDatos').onclick = () => guardarDatosProf(cont);

  // Excepciones: handlers
  const btnAddExc = cont.querySelector('#btnAddExc');
  if (btnAddExc) btnAddExc.onclick = () => agregarExcepcion(cont);

  const excList = cont.querySelector('#excList');
  if (excList) {
    excList.addEventListener('click', async (ev) => {
      const del = ev.target.closest('[data-del-exc]');
      if (!del) return;
      if (!confirm('¿Eliminar esta excepción?')) return;
      const id = del.getAttribute('data-del-exc');
      const { error } = await supabase.from('profesionales_excepciones').delete().eq('id', id);
      if (error) { showToast('❌ ' + formatSupabaseError(error, 'excepción')); return; }
      showToast('🗑️ Excepción eliminada');
      del.closest('[data-exc-row]').remove();
    });
  }

  const tipoSelect = cont.querySelector('#excTipo');
  if (tipoSelect) {
    tipoSelect.addEventListener('change', (ev) => {
      const franja = cont.querySelector('#excFranjaWrap');
      if (franja) franja.style.display = ev.target.value === 'dia_extra' ? 'block' : 'none';
    });
  }
}

// ── Renders parciales de la Tab 1 ─────────────────────────
function renderDia(dia, franjas) {
  const tieneHorarios = franjas.length > 0;
  return `
    <div style="background:${tieneHorarios ? 'rgba(3,105,161,0.04)' : 'rgba(0,0,0,0.02)'};border:1px solid var(--border);border-radius:8px;padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${tieneHorarios ? '8px' : '0'}">
        <strong style="font-size:13px;color:var(--text)">${escapeHtml(dia.label)}</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-add-franja="${dia.num}" style="font-size:11px;padding:4px 10px">+ Franja</button>
      </div>
      <div data-dia-franjas="${dia.num}" style="display:flex;flex-direction:column;gap:6px">
        ${franjas.map(f => renderFranja(String(f.hora_inicio).slice(0,5), String(f.hora_fin).slice(0,5))).join('')}
      </div>
    </div>`;
}

function renderFranja(horaIni, horaFin) {
  return `
    <div data-franja style="display:grid;grid-template-columns:30px 1fr 1fr 30px;gap:8px;align-items:center">
      <input type="checkbox" data-activo checked style="width:16px;height:16px;accent-color:var(--emerald)">
      <input type="time" data-hora-ini class="form-input" value="${escapeAttr(horaIni)}" style="font-size:13px">
      <input type="time" data-hora-fin class="form-input" value="${escapeAttr(horaFin)}" style="font-size:13px">
      <button type="button" data-del-franja class="btn btn-ghost btn-sm" style="padding:4px 8px;color:var(--rose)" title="Eliminar franja">×</button>
    </div>`;
}

function renderFormDatosProf(p) {
  return `
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="dpEmail" type="email" value="${escapeAttr(p.email || '')}" placeholder="profesional@correo.com"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="dpTel" value="${escapeAttr(p.telefono || '')}" placeholder="+54 11 XXXX-XXXX"></div>
      <div class="form-group"><label class="form-label">Teléfono alternativo</label><input class="form-input" id="dpTel2" value="${escapeAttr(p.telefono_secundario || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Dirección</label><input class="form-input" id="dpDir" value="${escapeAttr(p.direccion || '')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DNI/CUIL</label><input class="form-input" id="dpDNI" value="${escapeAttr(p.dni || '')}" placeholder="Sin puntos"></div>
      <div class="form-group"><label class="form-label">Fecha de nacimiento</label><input class="form-input" id="dpFechaNac" type="date" value="${escapeAttr(p.fecha_nacimiento || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Observaciones</label><textarea class="form-input" id="dpObs" rows="2" style="resize:vertical;min-height:50px">${escapeHtml(p.observaciones || '')}</textarea></div>
  `;
}

function renderFormExcepcion() {
  const hoy = new Date().toISOString().slice(0, 10);
  return `
    <div style="background:rgba(3,105,161,0.04);border-radius:8px;padding:12px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">➕ Agregar excepción</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select class="form-select" id="excTipo">
            ${TIPO_EXCEPCION.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-input" id="excDesde" type="date" value="${hoy}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Hasta (opcional)</label>
          <input class="form-input" id="excHasta" type="date">
        </div>
        <div class="form-group" id="excFranjaWrap" style="display:none">
          <label class="form-label">Franja del día extra</label>
          <div style="display:flex;gap:4px">
            <input class="form-input" id="excHoraIni" type="time" value="09:00">
            <input class="form-input" id="excHoraFin" type="time" value="13:00">
          </div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Motivo</label>
        <input class="form-input" id="excMotivo" placeholder="Ej: Congreso, vacaciones de invierno...">
      </div>
      <div style="text-align:right">
        <button class="btn btn-amber btn-sm" id="btnAddExc">Agregar excepción</button>
      </div>
    </div>
  `;
}

function renderExcepcionRow(e) {
  const tipoLabel = TIPO_EXCEPCION.find(t => t.value === e.tipo)?.label || e.tipo;
  const rango = e.fecha_hasta && e.fecha_hasta !== e.fecha
    ? `${e.fecha} → ${e.fecha_hasta}`
    : e.fecha;
  const hora = (e.hora_inicio && e.hora_fin)
    ? ` · ${String(e.hora_inicio).slice(0,5)}–${String(e.hora_fin).slice(0,5)}`
    : '';
  return `
    <div data-exc-row style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--bg3)">
      <span style="font-size:11px;font-weight:700">${tipoLabel}</span>
      <div style="flex:1;font-size:12px">
        <div style="font-weight:600;color:var(--text)">${escapeHtml(rango)}${escapeHtml(hora)}</div>
        ${e.motivo ? `<div style="font-size:11px;color:var(--text4)">${escapeHtml(e.motivo)}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" data-del-exc="${escapeAttr(e.id)}" style="padding:4px 8px;color:var(--rose)">×</button>
    </div>
  `;
}

// ── Acciones de la Tab 1 ──────────────────────────────────
async function guardarHorarios(cont) {
  // Recolectar franjas
  const nuevos = [];
  for (const d of DIAS) {
    const franjas = cont.querySelectorAll(`[data-dia-franjas="${d.num}"] [data-franja]`);
    for (const fr of franjas) {
      const activo = fr.querySelector('[data-activo]').checked;
      if (!activo) continue;
      const ini = fr.querySelector('[data-hora-ini]').value;
      const fin = fr.querySelector('[data-hora-fin]').value;
      if (!ini || !fin) continue;
      if (fin <= ini) {
        showToast(`⚠️ ${d.label}: la hora fin debe ser mayor a la inicio`);
        return;
      }
      nuevos.push({
        profesional_id: _profActual.id,
        dia_semana:     d.num,
        hora_inicio:    ini,
        hora_fin:       fin,
        consultorio_id: _profActual.consultorio_id || null,
        activo:         true,
      });
    }
  }

  // Update profesional (duración + anticipación)
  const duracion    = parseInt(cont.querySelector('#cfgDuracion').value) || 45;
  const anticipacion = parseInt(cont.querySelector('#cfgAntic').value) || 0;

  const { error: errProf } = await supabase.from('profesionales').update({
    duracion_consulta:   duracion,
    min_anticipacion_hs: anticipacion,
  }).eq('id', _profActual.id);

  if (errProf) {
    console.error('[Ficha] update prof:', errProf);
    showToast('❌ ' + formatSupabaseError(errProf, 'configuración'));
    return;
  }

  _profActual.duracion_consulta = duracion;
  _profActual.min_anticipacion_hs = anticipacion;

  // Reemplazar horarios
  await supabase.from('profesionales_horarios').delete().eq('profesional_id', _profActual.id);
  if (nuevos.length > 0) {
    const { error } = await supabase.from('profesionales_horarios').insert(nuevos);
    if (error) {
      console.error('[Ficha] insert horarios:', error);
      showToast('❌ ' + formatSupabaseError(error, 'horario'));
      return;
    }
  }

  showToast(`✅ ${nuevos.length} franja${nuevos.length !== 1 ? 's' : ''} guardada${nuevos.length !== 1 ? 's' : ''}. Duración: ${duracion} min.`);
}

async function guardarDatosProf(cont) {
  const v = id => cont.querySelector('#' + id)?.value?.trim() || null;

  const updates = {
    email:                v('dpEmail'),
    telefono:             v('dpTel'),
    telefono_secundario:  v('dpTel2'),
    direccion:            v('dpDir'),
    dni:                  v('dpDNI'),
    fecha_nacimiento:     v('dpFechaNac'),
    observaciones:        v('dpObs'),
  };

  const { error } = await supabase.from('profesionales').update(updates).eq('id', _profActual.id);
  if (error) {
    console.error('[Ficha] update datos prof:', error);
    showToast('❌ ' + formatSupabaseError(error, 'datos'));
    return;
  }

  Object.assign(_profActual, updates);
  showToast('✅ Datos del profesional actualizados');
}

async function agregarExcepcion(cont) {
  const tipo   = cont.querySelector('#excTipo').value;
  const desde  = cont.querySelector('#excDesde').value;
  const hasta  = cont.querySelector('#excHasta').value || null;
  const motivo = cont.querySelector('#excMotivo').value.trim() || null;

  if (!desde) { showToast('⚠️ Elegí fecha desde'); return; }

  const payload = {
    profesional_id: _profActual.id,
    fecha:          desde,
    fecha_hasta:    hasta,
    tipo, motivo,
  };

  if (tipo === 'dia_extra') {
    payload.hora_inicio = cont.querySelector('#excHoraIni').value;
    payload.hora_fin    = cont.querySelector('#excHoraFin').value;
    if (!payload.hora_inicio || !payload.hora_fin) {
      showToast('⚠️ Hora inicio y fin son obligatorias para día extra');
      return;
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  payload.created_by = user?.id;

  const { error } = await supabase.from('profesionales_excepciones').insert([payload]);
  if (error) {
    console.error('[Ficha] insert excepción:', error);
    showToast('❌ ' + formatSupabaseError(error, 'excepción'));
    return;
  }

  showToast('✅ Excepción registrada');
  // Re-render solo la tab config para refrescar lista
  await renderTabConfig();
}

// ============================================================
//  TAB 2 — AGENDA SEMANAL
//  Grilla de 7 días con todos los slots según horarios.
//  Slot libre → click para crear turno con profesional + hora pre-cargados.
//  Slot ocupado → muestra paciente + estado del turno.
// ============================================================
async function renderTabAgenda() {
  const cont = _modalActual.querySelector('#fichaContent');
  cont.innerHTML = renderAgendaEsqueleto();

  // Listeners de navegación de semana
  cont.querySelector('#btnSemPrev').onclick = () => {
    _semanaActual = sumarDias(_semanaActual, -7);
    cargarYRenderSemana();
  };
  cont.querySelector('#btnSemNext').onclick = () => {
    _semanaActual = sumarDias(_semanaActual, 7);
    cargarYRenderSemana();
  };
  cont.querySelector('#btnSemHoy').onclick = () => {
    _semanaActual = lunesDeLaSemana(new Date());
    cargarYRenderSemana();
  };

  // Click en slot libre → abrir modal Nuevo Turno pre-cargado
  cont.addEventListener('click', (ev) => {
    const slotLibre = ev.target.closest('[data-slot-libre]');
    if (!slotLibre) return;
    const fecha = slotLibre.getAttribute('data-fecha');
    const hora  = slotLibre.getAttribute('data-hora');
    abrirNuevoTurnoPreCargado(fecha, hora);
  });

  await cargarYRenderSemana();
}

function renderAgendaEsqueleto() {
  return `
    <!-- Selector de semana -->
    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg3);border:1px solid var(--border);padding:10px 14px;border-radius:10px;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="btnSemPrev" style="font-size:12px">← Semana anterior</button>
      <div style="text-align:center">
        <div style="font-size:14px;font-weight:700;color:var(--text)" id="lblSemana">—</div>
        <div style="font-size:11px;color:var(--text4)" id="lblResumen">Cargando...</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="btnSemHoy" style="font-size:12px">Hoy</button>
        <button class="btn btn-ghost btn-sm" id="btnSemNext" style="font-size:12px">Semana siguiente →</button>
      </div>
    </div>

    <!-- Leyenda -->
    <div style="font-size:10px;color:var(--text4);margin-bottom:10px;display:flex;gap:14px;flex-wrap:wrap">
      <span>🟢 Libre (click para crear turno)</span>
      <span>⏳ Pendiente</span>
      <span>✅ Confirmado</span>
      <span>🟦 En curso</span>
      <span>✓ Finalizado</span>
      <span>❌ No-Show</span>
      <span style="color:var(--text3)">─ Sin atención</span>
    </div>

    <!-- Grilla 7 días -->
    <div id="dispGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
      ${[1,2,3,4,5,6,0].map(num => {
        const d = DIAS.find(x => x.num === num);
        return `
          <div style="background:var(--bg);border-radius:8px;padding:8px;min-height:280px;display:flex;flex-direction:column">
            <div style="text-align:center;padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:6px">
              <div style="font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">${d.corto}</div>
              <div style="font-size:11px;color:var(--text3)" data-dia-fecha="${d.num}">—</div>
            </div>
            <div data-dia-slots="${d.num}" style="flex:1;display:flex;flex-direction:column;gap:3px">
              <div style="text-align:center;color:var(--text4);font-size:11px;padding:20px 0">⏳</div>
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

async function cargarYRenderSemana() {
  if (!_modalActual) return;
  const cont = _modalActual.querySelector('#fichaContent');
  if (!cont) return;

  cont.querySelector('#lblSemana').textContent = `Semana del ${rangoSemana(_semanaActual)}`;

  let datosPorDia;
  try {
    datosPorDia = await fetchDatosSemana(_profActual.id, _semanaActual);
  } catch (err) {
    console.error('[Ficha] fetchSemana:', err);
    showToast('❌ ' + formatSupabaseError(err, 'agenda'));
    return;
  }

  let totalLibres = 0;
  let totalOcupados = 0;
  const conteoEstados = {};

  datosPorDia.forEach(diaData => {
    const slotCont = cont.querySelector(`[data-dia-slots="${diaData.diaSemana}"]`);
    const lblFecha = cont.querySelector(`[data-dia-fecha="${diaData.diaSemana}"]`);
    if (lblFecha) lblFecha.textContent = fechaCorta(diaData.fecha);
    if (!slotCont) return;

    if (diaData.bloqueado) {
      slotCont.innerHTML = `
        <div style="text-align:center;color:var(--rose);font-size:11px;padding:30px 4px;background:rgba(225,29,72,0.05);border-radius:6px">
          🚫 Bloqueado<br><span style="font-size:10px;color:var(--text4)">${escapeHtml(diaData.motivoBloqueo || '')}</span>
        </div>`;
      return;
    }

    if (diaData.slots.length === 0) {
      slotCont.innerHTML = `<div style="text-align:center;color:var(--text4);font-size:11px;padding:30px 4px">─ Sin atención</div>`;
      return;
    }

    slotCont.innerHTML = diaData.slots.map(s => renderSlotAgenda(s, diaData.fechaStr)).join('');

    diaData.slots.forEach(s => {
      if (s.ocupado) {
        totalOcupados++;
        const est = s.turno?.estado || 'Pendiente';
        conteoEstados[est] = (conteoEstados[est] || 0) + 1;
      } else {
        totalLibres++;
      }
    });
  });

  const total = totalLibres + totalOcupados;
  const pct = total > 0 ? Math.round((totalOcupados / total) * 100) : 0;
  const lblResumen = cont.querySelector('#lblResumen');
  if (lblResumen) {
    if (total === 0) {
      lblResumen.innerHTML = `<span style="color:var(--rose)">Sin franjas para esta semana — configurá horarios primero</span>`;
    } else {
      const detalle = Object.entries(conteoEstados).map(([e, n]) => `${n} ${e.toLowerCase()}`).join(' · ');
      lblResumen.innerHTML = `
        <strong style="color:var(--sky)">${totalOcupados}</strong>/${total} ocupados (<strong>${pct}%</strong>)
        ${detalle ? '· ' + detalle : ''}
        ${totalLibres > 0 ? ` · <strong style="color:var(--emerald)">${totalLibres}</strong> libres` : ''}
      `;
    }
  }
}

async function fetchDatosSemana(profId, lunes) {
  const fetches = [];
  for (let i = 0; i < 7; i++) {
    const fecha = sumarDias(lunes, i);
    const fechaStr = fechaISO(fecha);
    fetches.push(Promise.all([
      supabase.rpc('slots_disponibles', { p_profesional_id: profId, p_fecha: fechaStr }),
      supabase.from('profesionales_excepciones')
        .select('tipo, motivo, hora_inicio, hora_fin')
        .eq('profesional_id', profId)
        .lte('fecha', fechaStr)
        .or(`fecha_hasta.gte.${fechaStr},fecha_hasta.is.null`),
    ]).then(([sR, eR]) => ({
      fecha, fechaStr,
      slots:        sR.data || [],
      excepciones:  eR.data || [],
    })));
  }

  const results = await Promise.all(fetches);

  // Batch query de turnos
  const turnoIds = [];
  results.forEach(r => r.slots.forEach(s => { if (s.ocupado && s.turno_id) turnoIds.push(s.turno_id); }));

  let turnosMap = {};
  if (turnoIds.length > 0) {
    const { data: turnos } = await supabase
      .from('v_turnos_dia')
      .select('id, pac_nombre, estado, hora, cobertura, pac_cobertura')
      .in('id', turnoIds);
    (turnos || []).forEach(t => { turnosMap[t.id] = t; });
  }

  return results.map(r => {
    const exc = r.excepciones.find(e => ['feriado','ausencia','vacaciones','licencia_medica'].includes(e.tipo));
    return {
      fecha:         r.fecha,
      fechaStr:      r.fechaStr,
      diaSemana:     r.fecha.getDay(),
      bloqueado:     !!exc,
      motivoBloqueo: exc ? (exc.motivo || exc.tipo) : null,
      slots: r.slots.map(s => ({
        ...s,
        turno: s.ocupado && s.turno_id ? turnosMap[s.turno_id] : null,
      })),
    };
  });
}

function renderSlotAgenda(slot, fechaStr) {
  const horaIni = String(slot.hora_inicio).slice(0, 5);

  if (!slot.ocupado) {
    return `
      <div data-slot-libre data-fecha="${escapeAttr(fechaStr)}" data-hora="${escapeAttr(horaIni)}"
           style="background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.3);border-radius:6px;padding:5px 6px;font-size:11px;cursor:pointer;transition:background 0.1s"
           onmouseover="this.style.background='rgba(5,150,105,0.18)'" onmouseout="this.style.background='rgba(5,150,105,0.08)'"
           title="Click para crear turno a las ${horaIni}">
        <div style="font-weight:700;color:var(--emerald);font-family:var(--mono)">${horaIni}</div>
        <div style="font-size:9px;color:var(--text4)">Libre · click</div>
      </div>`;
  }

  const t = slot.turno || {};
  const estado = t.estado || 'Pendiente';
  const colors = COLOR_ESTADO[estado] || COLOR_ESTADO['Pendiente'];
  const pacNombre = t.pac_nombre || 'Reservado';
  const cob = t.cobertura || t.pac_cobertura || '';
  const cobLabel = cob && cob !== 'Particular'
    ? `🏥 ${escapeHtml(cob)}`
    : (cob === 'Particular' ? `💰 Particular` : '');

  return `
    <div style="background:${colors.bg};border:1px solid ${colors.text}33;border-radius:6px;padding:5px 6px;font-size:11px" title="${escapeAttr(estado)}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;color:${colors.text};font-family:var(--mono)">${horaIni}</span>
        <span style="font-size:8px;color:${colors.text}">${escapeHtml(estado)}</span>
      </div>
      <div style="font-size:10px;color:var(--text2);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(pacNombre)}</div>
      ${cobLabel ? `<span style="font-size:8px;color:var(--text4)">${cobLabel}</span>` : ''}
    </div>`;
}

function abrirNuevoTurnoPreCargado(fecha, hora) {
  // Cerrar el modal de ficha primero
  cerrarModal('modalFichaProf');

  // Abrir el modal de nuevo turno
  if (typeof window.openModal === 'function') window.openModal('modalNuevoTurno');

  // Pre-cargar campos del modal
  setTimeout(() => {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('turnoFecha', fecha);
    setVal('turnoHora', hora);
    setVal('turnoProf', _profActual.nombre || '');
    if (_profActual.especialidad) setVal('turnoEsp', _profActual.especialidad);

    // Cobertura default si tenemos
    showToast(`📅 Nuevo turno para ${_profActual.nombre} el ${fecha} a las ${hora}. Solo falta el paciente.`);
  }, 80);
}

// ============================================================
//  HELPERS DE FECHA
// ============================================================
function lunesDeLaSemana(fecha) {
  const d = new Date(fecha);
  const diaSemana = d.getDay();
  const offset = diaSemana === 0 ? -6 : (1 - diaSemana);
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumarDias(fecha, n) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + n);
  return d;
}

function fechaISO(f) { return f.toISOString().slice(0, 10); }

function fechaCorta(f) {
  return f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function rangoSemana(lunes) {
  const dom = sumarDias(lunes, 6);
  const mismoMes = lunes.getMonth() === dom.getMonth();
  if (mismoMes) {
    const mes = lunes.toLocaleDateString('es-AR', { month: 'long' });
    return `${lunes.getDate()} al ${dom.getDate()} de ${mes}`;
  }
  return `${fechaCorta(lunes)} al ${fechaCorta(dom)}`;
}

// ============================================================
//  EXPORT
// ============================================================
window.FichaProfesionalMod = { abrirFichaProfesional };
