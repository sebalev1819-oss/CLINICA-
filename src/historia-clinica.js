// ============================================================
//  RehabMed ERP — Módulo Historia Clínica
//  Evoluciones reales desde Supabase: CRUD + firma digital
// ============================================================
import { supabase } from './lib/supabase.js';
import { escapeHtml, showToast } from './lib/dom.js';

let _pacienteActual = null;

// ============================================================
//  CARGAR EVOLUCIONES DE UN PACIENTE
// ============================================================
export async function cargarEvoluciones(pacienteId) {
  _pacienteActual = pacienteId;

  const { data, error } = await supabase
    .from('evoluciones')
    .select(`
      id, fecha, texto, firmado, firmado_at,
      profesional_id,
      profesionales ( nombre, iniciales )
    `)
    .eq('paciente_id', pacienteId)
    .order('fecha', { ascending: false });

  if (error) {
    console.error('[HC] error cargando evoluciones:', error);
    renderEvoluciones([]);
    return [];
  }

  renderEvoluciones(data || []);
  return data || [];
}

// ============================================================
//  RENDER
// ============================================================
function renderEvoluciones(evos) {
  const cont = document.getElementById('hcl-evoluciones');
  if (!cont) return;

  if (evos.length === 0) {
    cont.innerHTML = `
      <div style="text-align:center;padding:30px 16px;color:var(--text4)">
        <div style="font-size:32px;margin-bottom:8px">📋</div>
        <div style="font-size:13px;font-weight:600;color:var(--text3)">Sin evoluciones registradas</div>
        <div style="font-size:11px;margin-top:2px">Creá la primera con el botón "+ Nueva Evolución"</div>
      </div>`;
    return;
  }

  cont.innerHTML = evos.map(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const prof = e.profesionales?.nombre || 'Profesional';
    const initials = e.profesionales?.iniciales || '??';

    const firmaBadge = e.firmado
      ? `<span class="badge badge-emerald" style="font-size:10px;padding:2px 8px" title="Firmada el ${e.firmado_at ? new Date(e.firmado_at).toLocaleString('es-AR') : ''}">✓ Firmada</span>`
      : `<span class="badge badge-amber" style="font-size:10px;padding:2px 8px">Borrador</span>`;

    const accionBtn = e.firmado
      ? ''
      : `<button class="btn btn-emerald btn-sm" style="font-size:10px;padding:4px 10px;margin-top:8px" data-firmar="${escapeHtml(e.id)}">🔏 Firmar</button>`;

    return `
      <div class="evolution-item" ${e.firmado ? 'style="border-left:3px solid var(--emerald)"' : 'style="border-left:3px solid var(--amber)"'}>
        <div class="evo-head">
          <span class="evo-date">${escapeHtml(fecha)}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="evo-prof">${escapeHtml(initials)} · ${escapeHtml(prof)}</span>
            ${firmaBadge}
          </div>
        </div>
        <div class="evo-text">${escapeHtml(e.texto).replace(/\n/g, '<br>')}</div>
        ${accionBtn}
      </div>`;
  }).join('');

  // Event delegation para el botón "Firmar"
  if (!cont.__firmarHandler) {
    cont.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-firmar]');
      if (!btn) return;
      const id = btn.getAttribute('data-firmar');
      await firmarEvolucion(id);
    });
    cont.__firmarHandler = true;
  }
}

// ============================================================
//  CREAR EVOLUCIÓN
// ============================================================
export async function crearEvolucion(datos) {
  if (!datos?.pacienteId || !datos?.texto) {
    showToast('⚠️ Paciente y texto son obligatorios');
    return null;
  }

  // Buscar el profesional_id del usuario logueado
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { showToast('⚠️ No hay sesión activa'); return null; }

  const { data: prof } = await supabase
    .from('profesionales').select('id')
    .eq('profile_id', user.id).limit(1).maybeSingle();

  // Si el usuario logueado es admin sin profesional asociado, usar el primero activo
  let profId = prof?.id;
  if (!profId) {
    const { data: anyProf } = await supabase
      .from('profesionales').select('id')
      .eq('activo', true).limit(1).maybeSingle();
    profId = anyProf?.id;
  }
  if (!profId) {
    showToast('⚠️ No hay profesional asociado. Creá uno primero en el módulo Profesionales.');
    return null;
  }

  const { data, error } = await supabase.from('evoluciones').insert([{
    paciente_id:    datos.pacienteId,
    profesional_id: profId,
    turno_id:       datos.turnoId || null,
    texto:          datos.texto,
    firmado:        false,
  }]).select().single();

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[HC] crearEvolucion:', error);
    return null;
  }

  showToast('✅ Evolución guardada como borrador');
  await cargarEvoluciones(datos.pacienteId);
  return data;
}

// ============================================================
//  FIRMAR EVOLUCIÓN
//  Al firmar queda inmutable (policy UPDATE exige firmado=false)
// ============================================================
export async function firmarEvolucion(evolucionId) {
  const ok = window.confirm(
    'Firmar esta evolución la bloquea: no se podrá editar ni borrar. ¿Confirmás?'
  );
  if (!ok) return;

  const { error } = await supabase.from('evoluciones')
    .update({ firmado: true, firmado_at: new Date().toISOString() })
    .eq('id', evolucionId);

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[HC] firmar:', error);
    return;
  }

  showToast('🔏 Evolución firmada');
  if (_pacienteActual) await cargarEvoluciones(_pacienteActual);
}

// ============================================================
//  HANDLERS PARA EL HTML LEGACY
// ============================================================

/**
 * guardarEvolucion() — override del handler del modal #modalNuevaEvolucion.
 * Lee los campos del form, arma el texto y llama a crearEvolucion.
 */
async function guardarEvolucionHandler() {
  const txt     = document.getElementById('evoTxt')?.value?.trim() || '';
  const mejoras = document.getElementById('evoMejoras')?.value?.trim() || '';
  const eva     = document.getElementById('evoEva')?.value || '0';

  if (!txt) { showToast('❌ Ingresá la evolución clínica'); return; }

  let fullTxt = txt;
  if (mejoras || (eva && eva !== '0')) {
    fullTxt += `\n\n--- Avances / Mejoras ---\n${mejoras || 'Sin detallar'}\nDolor EVA: ${eva}/10`;
  }

  // window.showHCL seteó _currentHCLPacId en el HTML — leemos ese
  const pacId = _pacienteActual || window._currentHCLPacId;
  if (!pacId) { showToast('⚠️ Abrí primero la historia de un paciente'); return; }

  const data = await crearEvolucion({
    pacienteId: pacId,
    texto:      fullTxt,
  });

  if (data) {
    if (typeof window.closeModal === 'function') window.closeModal('modalNuevaEvolucion');
    document.getElementById('evoTxt').value = '';
    document.getElementById('evoMejoras').value = '';
    document.getElementById('evoEva').value = '3';
    const evaVal = document.getElementById('evoEvaVal');
    if (evaVal) evaVal.textContent = '3';
  }
}

// ============================================================
//  INSTALAR HOOK: interceptar showHCL del HTML para cargar desde Supabase
// ============================================================
export function instalarHC() {
  // Interceptamos showHCL: después de que el HTML renderiza su UI,
  // sobrescribimos el panel de evoluciones con datos reales.
  const _originalShowHCL = window.showHCL;
  window.showHCL = function (id) {
    if (typeof _originalShowHCL === 'function') _originalShowHCL(id);
    // El original seteó _currentHCLPacId (window o local) — usamos el objeto
    const paciente = (window.PACIENTES_DATA || []).find(p => p.id === id);
    if (paciente) {
      cargarEvoluciones(paciente.id);
    }
  };

  window.guardarEvolucion = guardarEvolucionHandler;
  window.HistoriaClinica = {
    cargarEvoluciones,
    crearEvolucion,
    firmarEvolucion,
  };

  console.log('[HC] ✅ Historia clínica conectada a Supabase');
}
