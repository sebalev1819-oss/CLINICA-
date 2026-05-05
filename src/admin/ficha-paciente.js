// ============================================================
//  RehabMed ERP — Ficha 360 del Paciente
//
//  Vista unificada con 3 tabs + modo edición:
//    📋 Datos: ficha completa + botón editar
//    📅 Historial: TODOS los turnos (pasados, presentes, futuros)
//    💰 Cuenta corriente: facturas y saldo
//    📝 Evoluciones: ya existe en el HCl original (link directo)
//
//  Reemplaza la función showHCL del HTML legacy con una vista
//  más completa pensada para uso operativo diario.
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { formatSupabaseError } from '../lib/errors.js';
import { crearModal, cerrarModal } from './config.js';
import {
  cargarAutorizacionesPaciente,
  renderTarjetasAutorizaciones,
} from './autorizaciones.js';

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

let _pacActual = null;
let _modalActual = null;
let _tabActiva = 'datos';

// ============================================================
//  ENTRADA PRINCIPAL
// ============================================================
export async function abrirFichaPaciente(pacId, tabInicial = 'datos') {
  // Cargar paciente fresco desde DB
  const { data: pac, error } = await supabase
    .from('pacientes').select('*').eq('id', pacId).single();

  if (error || !pac) {
    showToast('❌ ' + formatSupabaseError(error || { message: 'Paciente no encontrado' }, 'paciente'));
    return;
  }

  _pacActual = pac;
  _tabActiva = tabInicial === 'editar' ? 'datos' : tabInicial; // editar abre tab datos en modo edición

  _modalActual = crearModal('modalFichaPac', renderEsqueleto(pac));
  _modalActual.querySelector('.modal').style.cssText = 'width:920px;max-width:96vw;max-height:92vh;overflow:hidden;display:flex;flex-direction:column';

  // Listeners de tabs
  _modalActual.querySelectorAll('[data-tab-btn]').forEach(btn => {
    btn.addEventListener('click', () => cambiarTab(btn.getAttribute('data-tab-btn')));
  });

  // Render inicial según tabInicial
  if (_tabActiva === 'historial') {
    cambiarTab('historial');
  } else if (_tabActiva === 'ctacte') {
    cambiarTab('ctacte');
  } else if (_tabActiva === 'autorizaciones') {
    cambiarTab('autorizaciones');
  } else {
    await renderTabDatos(tabInicial === 'editar');
  }
}

// ============================================================
//  ESQUELETO
// ============================================================
function renderEsqueleto(pac) {
  const iniciales = (pac.nombre || '??').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const scoreColor = pac.score_noshow > 90 ? 'var(--emerald)' : pac.score_noshow > 70 ? 'var(--amber)' : 'var(--rose)';

  return `
    <!-- HEADER fijo -->
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(3,105,161,0.04),rgba(124,58,237,0.04));flex-shrink:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
        <div style="display:flex;gap:14px;align-items:center;flex:1;min-width:0">
          <div class="avatar avatar-md" style="background:linear-gradient(135deg,#0ea5e9,#8b5cf6);color:#fff;font-weight:700;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:16px;flex-shrink:0">${escapeHtml(iniciales)}</div>
          <div style="min-width:0">
            <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:2px">${escapeHtml(pac.nombre || '')}</div>
            <div style="font-size:12px;color:var(--text3);margin-bottom:4px">
              ${escapeHtml(pac.ref || '')} · DNI ${escapeHtml(pac.dni || '—')} · ${escapeHtml(pac.cobertura || 'Particular')}
            </div>
            <div style="font-size:11px;color:var(--text4);display:flex;gap:14px;flex-wrap:wrap">
              ${pac.email ? `<span>✉️ ${escapeHtml(pac.email)}</span>` : ''}
              ${pac.telefono ? `<span>📞 ${escapeHtml(pac.telefono)}</span>` : ''}
              <span style="color:${scoreColor}">⭐ Score ${pac.score_noshow ?? 100}</span>
              <span class="badge" style="font-size:10px;background:${pac.estado === 'Activo' ? 'rgba(5,150,105,0.15)' : 'rgba(148,163,184,0.15)'};color:${pac.estado === 'Activo' ? 'var(--emerald)' : 'var(--text3)'};padding:1px 8px;border-radius:99px">${escapeHtml(pac.estado || 'Activo')}</span>
            </div>
          </div>
        </div>
        <button class="modal-close" data-cerrar style="flex-shrink:0">×</button>
      </div>

      <!-- TABS -->
      <div style="display:flex;gap:2px;margin-top:14px;background:var(--bg);border-radius:8px;padding:4px;width:fit-content;flex-wrap:wrap">
        ${tabBtn('datos', '📋 Datos', _tabActiva === 'datos')}
        ${tabBtn('historial', '📅 Historial', _tabActiva === 'historial')}
        ${pac.cobertura && pac.cobertura !== 'Particular'
          ? tabBtn('autorizaciones', '📋 Autorizaciones', _tabActiva === 'autorizaciones')
          : ''}
        ${tabBtn('ctacte', '💰 Cuenta corriente', _tabActiva === 'ctacte')}
        ${tabBtn('hcl', '📝 Evoluciones', _tabActiva === 'hcl')}
      </div>
    </div>

    <!-- CONTENIDO DE LA TAB -->
    <div id="fichaPacContent" style="flex:1;overflow-y:auto;padding:18px 20px">
      <div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando...</div>
    </div>
  `;
}

function tabBtn(id, label, active) {
  return `<button data-tab-btn="${id}" style="background:${active ? 'var(--bg3)' : 'transparent'};color:${active ? 'var(--sky)' : 'var(--text3)'};font-weight:${active ? '700' : '500'};padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;transition:all 0.15s">${label}</button>`;
}

function cambiarTab(tab) {
  _tabActiva = tab;
  _modalActual.querySelectorAll('[data-tab-btn]').forEach(btn => {
    if (btn.getAttribute('data-tab-btn') === tab) {
      btn.style.background = 'var(--bg3)'; btn.style.color = 'var(--sky)'; btn.style.fontWeight = '700';
    } else {
      btn.style.background = 'transparent'; btn.style.color = 'var(--text3)'; btn.style.fontWeight = '500';
    }
  });

  if (tab === 'datos') renderTabDatos(false);
  else if (tab === 'historial') renderTabHistorial();
  else if (tab === 'autorizaciones') renderTabAutorizaciones();
  else if (tab === 'ctacte') renderTabCtaCte();
  else if (tab === 'hcl') renderTabEvoluciones();
}

// ============================================================
//  TAB — AUTORIZACIONES (solo si cobertura ≠ Particular)
// ============================================================
async function renderTabAutorizaciones() {
  const cont = _modalActual.querySelector('#fichaPacContent');
  cont.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando autorizaciones...</div>';

  const autorizaciones = await cargarAutorizacionesPaciente(_pacActual.id);

  // Verificar que el paciente NO sea particular
  if (_pacActual.cobertura === 'Particular') {
    cont.innerHTML = `
      <div style="text-align:center;padding:40px;background:var(--bg3);border-radius:12px">
        <div style="font-size:36px;margin-bottom:10px">💰</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">Paciente particular</div>
        <div style="font-size:12px;color:var(--text4)">Las autorizaciones aplican solo a pacientes con cobertura de obra social o prepaga.</div>
      </div>`;
    return;
  }

  renderTarjetasAutorizaciones(cont, autorizaciones, {
    pacienteId: _pacActual.id,
    mostrarBotonCrear: true,
  });
}

// ============================================================
//  TAB 1 — DATOS (lectura + edición inline)
// ============================================================
async function renderTabDatos(modoEdicion = false) {
  const cont = _modalActual.querySelector('#fichaPacContent');
  if (!cont) return;
  cont.innerHTML = modoEdicion ? renderFormEdicion(_pacActual) : renderVistaLectura(_pacActual);

  if (modoEdicion) {
    cont.querySelector('#btnGuardarPac').onclick = () => guardarPaciente(cont);
    cont.querySelector('#btnCancelarEdicion').onclick = () => renderTabDatos(false);
  } else {
    cont.querySelector('#btnEditarPac').onclick = () => renderTabDatos(true);
  }
}

function renderVistaLectura(p) {
  const fila = (label, val) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;color:var(--text4)">${escapeHtml(label)}</span>
      <span style="font-size:13px;color:var(--text);font-weight:500;text-align:right">${val == null || val === '' ? '<span style="color:var(--text4)">—</span>' : escapeHtml(String(val))}</span>
    </div>`;

  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn btn-sky btn-sm" id="btnEditarPac">✏️ Editar datos</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <!-- Datos personales -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--sky);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">👤 Datos personales</div>
        ${fila('Nombre', p.nombre)}
        ${fila('DNI', p.dni)}
        ${fila('Fecha nacimiento', p.fecha_nacimiento ? formatearFecha(p.fecha_nacimiento) : null)}
        ${fila('Género', p.genero)}
        ${fila('Estado civil', p.estado_civil)}
        ${fila('Nacionalidad', p.nacionalidad)}
        ${fila('Ocupación', p.ocupacion)}
      </div>

      <!-- Contacto -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--emerald);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">📞 Contacto</div>
        ${fila('Teléfono', p.telefono)}
        ${fila('Tel. alternativo', p.telefono_secundario)}
        ${fila('Email', p.email)}
        ${fila('Dirección', p.direccion)}
      </div>

      <!-- Cobertura -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--violet);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">🏥 Cobertura</div>
        ${fila('Obra social', p.cobertura)}
        ${fila('Plan', p.plan_cobertura)}
        ${fila('Nº afiliado', p.numero_afiliado)}
        ${fila('Vigencia', p.vigencia_cobertura ? formatearFecha(p.vigencia_cobertura) : null)}
      </div>

      <!-- Clínico -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">🩺 Información clínica</div>
        ${fila('Diagnóstico', p.diagnostico)}
        ${fila('Médico derivante', p.medico_derivante)}
        ${fila('Especialidad derivada', p.especialidad_derivada)}
        ${fila('Sesiones autorizadas', p.sesiones_autorizadas)}
        ${fila('Alergias', p.alergias)}
        ${fila('Medicación', p.medicacion)}
      </div>

      <!-- Emergencia -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--rose);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">🚨 Contacto de emergencia</div>
        ${fila('Nombre', p.emerg_nombre)}
        ${fila('Relación', p.emerg_relacion)}
        ${fila('Teléfono', p.emerg_telefono)}
        ${fila('Tel. alternativo', p.emerg_tel2)}
      </div>

      <!-- Notas -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">📝 Notas</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5;white-space:pre-wrap">${escapeHtml(p.observaciones || p.notas || '—')}</div>
        <div style="font-size:11px;color:var(--text4);margin-top:8px">Motivo de consulta: ${escapeHtml(p.motivo_consulta || '—')}</div>
      </div>
    </div>
  `;
}

function renderFormEdicion(p) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;color:var(--text)">✏️ Editar datos del paciente</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="btnCancelarEdicion">Cancelar</button>
        <button class="btn btn-sky btn-sm" id="btnGuardarPac">💾 Guardar cambios</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <!-- Datos personales -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--sky);text-transform:uppercase;margin-bottom:10px">👤 Datos personales</div>
        <div class="form-group"><label class="form-label">Nombre completo *</label><input class="form-input" id="ed_nombre" value="${escapeAttr(p.nombre || '')}"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">DNI</label><input class="form-input" id="ed_dni" value="${escapeAttr(p.dni || '')}"></div>
          <div class="form-group"><label class="form-label">F. nacimiento</label><input class="form-input" type="date" id="ed_fecha_nacimiento" value="${escapeAttr(p.fecha_nacimiento || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Género</label>
            <select class="form-select" id="ed_genero">
              <option value="">—</option>
              ${['Masculino','Femenino','Otro','No especifica'].map(g => `<option ${p.genero === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Estado civil</label>
            <select class="form-select" id="ed_estado_civil">
              <option value="">—</option>
              ${['Soltero/a','Casado/a','Divorciado/a','Viudo/a','Unión de hecho'].map(g => `<option ${p.estado_civil === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Ocupación</label><input class="form-input" id="ed_ocupacion" value="${escapeAttr(p.ocupacion || '')}"></div>
      </div>

      <!-- Contacto -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--emerald);text-transform:uppercase;margin-bottom:10px">📞 Contacto</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="ed_telefono" value="${escapeAttr(p.telefono || '')}"></div>
          <div class="form-group"><label class="form-label">Tel. alt.</label><input class="form-input" id="ed_telefono_secundario" value="${escapeAttr(p.telefono_secundario || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" id="ed_email" value="${escapeAttr(p.email || '')}"></div>
        <div class="form-group"><label class="form-label">Dirección</label><input class="form-input" id="ed_direccion" value="${escapeAttr(p.direccion || '')}"></div>
      </div>

      <!-- Cobertura -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--violet);text-transform:uppercase;margin-bottom:10px">🏥 Cobertura</div>
        <div class="form-group"><label class="form-label">Obra social</label>
          <select class="form-select" id="ed_cobertura">
            ${['Particular','OSDE 210','OSDE 310','OSDE 410','Swiss Medical SMG20','IOMA','Galeno Azul','Medifé','PAMI','Otra'].map(c => `<option ${p.cobertura === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Plan</label><input class="form-input" id="ed_plan_cobertura" value="${escapeAttr(p.plan_cobertura || '')}"></div>
          <div class="form-group"><label class="form-label">Nº afiliado</label><input class="form-input" id="ed_numero_afiliado" value="${escapeAttr(p.numero_afiliado || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">Vigencia</label><input class="form-input" type="date" id="ed_vigencia_cobertura" value="${escapeAttr(p.vigencia_cobertura || '')}"></div>
      </div>

      <!-- Clínico -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;margin-bottom:10px">🩺 Información clínica</div>
        <div class="form-group"><label class="form-label">Diagnóstico</label><input class="form-input" id="ed_diagnostico" value="${escapeAttr(p.diagnostico || '')}"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Médico derivante</label><input class="form-input" id="ed_medico_derivante" value="${escapeAttr(p.medico_derivante || '')}"></div>
          <div class="form-group"><label class="form-label">Sesiones aut.</label><input class="form-input" type="number" id="ed_sesiones_autorizadas" value="${escapeAttr(p.sesiones_autorizadas || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">Alergias</label><input class="form-input" id="ed_alergias" value="${escapeAttr(p.alergias || '')}" placeholder="Ninguna conocida"></div>
        <div class="form-group"><label class="form-label">Medicación actual</label><textarea class="form-input" id="ed_medicacion" rows="2">${escapeHtml(p.medicacion || '')}</textarea></div>
      </div>

      <!-- Emergencia -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--rose);text-transform:uppercase;margin-bottom:10px">🚨 Contacto de emergencia</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="ed_emerg_nombre" value="${escapeAttr(p.emerg_nombre || '')}"></div>
          <div class="form-group"><label class="form-label">Relación</label><input class="form-input" id="ed_emerg_relacion" value="${escapeAttr(p.emerg_relacion || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="ed_emerg_telefono" value="${escapeAttr(p.emerg_telefono || '')}"></div>
          <div class="form-group"><label class="form-label">Tel. alt.</label><input class="form-input" id="ed_emerg_tel2" value="${escapeAttr(p.emerg_tel2 || '')}"></div>
        </div>
      </div>

      <!-- Notas -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;grid-column:span 2">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px">📝 Notas y observaciones</div>
        <div class="form-group"><label class="form-label">Motivo de consulta</label><textarea class="form-input" id="ed_motivo_consulta" rows="2">${escapeHtml(p.motivo_consulta || '')}</textarea></div>
        <div class="form-group"><label class="form-label">Observaciones</label><textarea class="form-input" id="ed_observaciones" rows="3">${escapeHtml(p.observaciones || '')}</textarea></div>
      </div>
    </div>
  `;
}

async function guardarPaciente(cont) {
  const v = id => cont.querySelector('#' + id)?.value?.trim() || null;
  const vNum = id => {
    const n = parseInt(cont.querySelector('#' + id)?.value);
    return Number.isFinite(n) ? n : null;
  };

  const nombre = v('ed_nombre');
  if (!nombre) { showToast('⚠️ El nombre es obligatorio'); return; }

  const updates = {
    nombre,
    dni:                  v('ed_dni'),
    fecha_nacimiento:     v('ed_fecha_nacimiento') || null,
    genero:               v('ed_genero'),
    estado_civil:         v('ed_estado_civil'),
    ocupacion:            v('ed_ocupacion'),
    telefono:             v('ed_telefono'),
    telefono_secundario:  v('ed_telefono_secundario'),
    email:                v('ed_email'),
    direccion:            v('ed_direccion'),
    cobertura:            v('ed_cobertura'),
    plan_cobertura:       v('ed_plan_cobertura'),
    numero_afiliado:      v('ed_numero_afiliado'),
    vigencia_cobertura:   v('ed_vigencia_cobertura') || null,
    diagnostico:          v('ed_diagnostico'),
    medico_derivante:     v('ed_medico_derivante'),
    sesiones_autorizadas: vNum('ed_sesiones_autorizadas'),
    alergias:             v('ed_alergias'),
    medicacion:           v('ed_medicacion'),
    emerg_nombre:         v('ed_emerg_nombre'),
    emerg_relacion:       v('ed_emerg_relacion'),
    emerg_telefono:       v('ed_emerg_telefono'),
    emerg_tel2:           v('ed_emerg_tel2'),
    motivo_consulta:      v('ed_motivo_consulta'),
    observaciones:        v('ed_observaciones'),
  };

  const { data, error } = await supabase
    .from('pacientes').update(updates).eq('id', _pacActual.id).select().single();

  if (error) {
    console.error('[FichaPac] update:', error);
    showToast('❌ ' + formatSupabaseError(error, 'paciente'));
    return;
  }

  Object.assign(_pacActual, data);
  showToast(`✅ Datos de ${data.nombre} actualizados`);
  await renderTabDatos(false); // volver a vista de lectura
}

// ============================================================
//  TAB 2 — HISTORIAL DE TURNOS
// ============================================================
async function renderTabHistorial() {
  const cont = _modalActual.querySelector('#fichaPacContent');
  cont.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando turnos...</div>';

  const { data: turnos, error } = await supabase
    .from('v_turnos_dia')
    .select('*')
    .eq('paciente_id', _pacActual.id)
    .order('fecha', { ascending: false })
    .order('hora', { ascending: false });

  if (error) {
    console.error('[FichaPac] historial:', error);
    cont.innerHTML = `<div style="padding:30px;text-align:center;color:var(--rose)">❌ ${escapeHtml(formatSupabaseError(error, 'turnos'))}</div>`;
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);

  // Particionar
  const futuros = (turnos || []).filter(t => t.fecha >= hoy && !['Cancelado','No Show','Finalizado'].includes(t.estado));
  const pasados = (turnos || []).filter(t => !futuros.includes(t));

  // Estadísticas
  const total = turnos?.length || 0;
  const finalizados = (turnos || []).filter(t => t.estado === 'Finalizado').length;
  const noShow = (turnos || []).filter(t => t.estado === 'No Show').length;
  const cancelados = (turnos || []).filter(t => t.estado === 'Cancelado').length;
  const tasaNoShow = total > 0 ? Math.round((noShow / total) * 100) : 0;

  cont.innerHTML = `
    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Total turnos</div>
        <div style="font-size:24px;font-weight:800;color:var(--sky)">${total}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Finalizados</div>
        <div style="font-size:24px;font-weight:800;color:var(--emerald)">${finalizados}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">No-Show</div>
        <div style="font-size:24px;font-weight:800;color:${tasaNoShow > 8 ? 'var(--rose)' : 'var(--amber)'}">${noShow} <span style="font-size:14px">(${tasaNoShow}%)</span></div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Cancelados</div>
        <div style="font-size:24px;font-weight:800;color:var(--text3)">${cancelados}</div>
      </div>
    </div>

    <!-- Turnos futuros -->
    <div style="margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;color:var(--sky);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">📌 Turnos futuros (${futuros.length})</div>
      ${futuros.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--text4);font-size:12px;background:var(--bg);border-radius:8px">Sin turnos futuros agendados</div>`
        : `<div style="display:flex;flex-direction:column;gap:6px">${futuros.map(renderTurnoRow).join('')}</div>`}
    </div>

    <!-- Turnos pasados -->
    <div>
      <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">📜 Turnos pasados (${pasados.length})</div>
      ${pasados.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--text4);font-size:12px;background:var(--bg);border-radius:8px">Sin historial de turnos</div>`
        : `<div style="display:flex;flex-direction:column;gap:6px">${pasados.slice(0, 50).map(renderTurnoRow).join('')}</div>`}
      ${pasados.length > 50 ? `<div style="text-align:center;color:var(--text4);font-size:11px;margin-top:8px">Mostrando los últimos 50 de ${pasados.length}</div>` : ''}
    </div>
  `;
}

function renderTurnoRow(t) {
  const colors = COLOR_ESTADO[t.estado] || COLOR_ESTADO['Pendiente'];
  return `
    <div style="display:grid;grid-template-columns:90px 60px 1fr 1fr 100px;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;align-items:center;font-size:13px">
      <div style="font-family:var(--mono);font-weight:600;color:var(--text2)">${escapeHtml(t.fecha)}</div>
      <div style="font-family:var(--mono);font-weight:700;color:var(--sky)">${String(t.hora).slice(0,5)}</div>
      <div>
        <div style="font-weight:600;color:var(--text)">${escapeHtml(t.prof_nombre || '—')}</div>
        <div style="font-size:11px;color:var(--text4)">${escapeHtml(t.especialidad || '')}</div>
      </div>
      <div style="font-size:11px;color:var(--text3)">
        ${t.cobertura ? `🏥 ${escapeHtml(t.cobertura)}` : ''}
        ${t.consultorio_id ? ` · C${t.consultorio_id}` : ''}
      </div>
      <div style="text-align:right">
        <span style="background:${colors.bg};color:${colors.text};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">${escapeHtml(t.estado)}</span>
      </div>
    </div>`;
}

// ============================================================
//  TAB 3 — CUENTA CORRIENTE
// ============================================================
async function renderTabCtaCte() {
  const cont = _modalActual.querySelector('#fichaPacContent');
  cont.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando cuenta corriente...</div>';

  // Intentar cargar facturas (puede no existir la tabla si la migration 006 no se ejecutó)
  let facturas = [];
  try {
    const { data, error } = await supabase
      .from('facturas')
      .select('id, numero, tipo, fecha_emision, total, saldo, estado')
      .eq('paciente_id', _pacActual.id)
      .order('fecha_emision', { ascending: false })
      .limit(50);
    if (!error) facturas = data || [];
  } catch (e) { /* tabla no existe → mostramos mensaje */ }

  const totalFact = facturas.reduce((s, f) => s + Number(f.total || 0), 0);
  const totalSaldo = facturas.reduce((s, f) => s + Number(f.saldo || 0), 0);

  cont.innerHTML = `
    <!-- Resumen -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase">Deuda actual</div>
        <div style="font-size:22px;font-weight:800;color:${(_pacActual.deuda || 0) > 0 ? 'var(--rose)' : 'var(--emerald)'}">$${Number(_pacActual.deuda || 0).toLocaleString('es-AR')}</div>
        <div style="font-size:11px;color:var(--text4);margin-top:2px">${(_pacActual.deuda || 0) > 0 ? 'Saldo a cobrar' : 'Al día'}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase">Total facturado</div>
        <div style="font-size:22px;font-weight:800;color:var(--sky)">$${totalFact.toLocaleString('es-AR')}</div>
        <div style="font-size:11px;color:var(--text4);margin-top:2px">${facturas.length} factura${facturas.length !== 1 ? 's' : ''}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:var(--text4);text-transform:uppercase">Saldo en facturas</div>
        <div style="font-size:22px;font-weight:800;color:${totalSaldo > 0 ? 'var(--amber)' : 'var(--emerald)'}">$${totalSaldo.toLocaleString('es-AR')}</div>
      </div>
    </div>

    ${facturas.length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--text4);background:var(--bg);border-radius:10px">
          <div style="font-size:30px;margin-bottom:8px">📄</div>
          <div style="font-size:13px;font-weight:700">Sin facturas registradas</div>
          <div style="font-size:11px;margin-top:4px">Las facturas se generan al finalizar un turno</div>
        </div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">📄 Facturas (${facturas.length})</div>
          ${facturas.map(f => `
            <div style="display:grid;grid-template-columns:80px 90px 1fr 100px 100px 100px;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;align-items:center;font-size:13px">
              <div style="font-family:var(--mono);font-weight:700;color:var(--sky)">#${String(f.numero || 0).padStart(6,'0')}</div>
              <div style="font-size:11px;color:var(--text3)">${escapeHtml(f.tipo || '—')}</div>
              <div style="font-size:11px;color:var(--text3)">${escapeHtml(f.fecha_emision || '—')}</div>
              <div style="text-align:right;font-weight:700">$${Number(f.total || 0).toLocaleString('es-AR')}</div>
              <div style="text-align:right;color:${Number(f.saldo) > 0 ? 'var(--rose)' : 'var(--emerald)'}">$${Number(f.saldo || 0).toLocaleString('es-AR')}</div>
              <div style="text-align:right"><span class="badge" style="font-size:10px">${escapeHtml(f.estado || '—')}</span></div>
            </div>`).join('')}
        </div>`}
  `;
}

// ============================================================
//  TAB 4 — EVOLUCIONES (delegar al HCl legacy)
// ============================================================
function renderTabEvoluciones() {
  const cont = _modalActual.querySelector('#fichaPacContent');
  cont.innerHTML = `
    <div style="text-align:center;padding:40px;background:var(--bg3);border-radius:12px">
      <div style="font-size:44px;margin-bottom:10px">📝</div>
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">Las evoluciones tienen su propia vista detallada</div>
      <div style="font-size:12px;color:var(--text4);margin-bottom:18px">Click abajo para abrir el módulo Historia Clínica con todas las evoluciones,<br>opción de firmar, y editar las que aún no estén firmadas.</div>
      <button class="btn btn-violet" id="btnAbrirHCL">📝 Abrir Historia Clínica</button>
    </div>
  `;
  cont.querySelector('#btnAbrirHCL').onclick = () => {
    cerrarModal('modalFichaPac');
    if (typeof window.showHCL === 'function') window.showHCL(_pacActual.id);
  };
}

// ============================================================
//  HELPERS
// ============================================================
function formatearFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
//  EXPORT GLOBAL (para llamar desde HTML inline)
// ============================================================
window.abrirFichaPaciente = abrirFichaPaciente;
window.FichaPacienteMod = { abrirFichaPaciente };
