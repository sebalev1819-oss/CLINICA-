// ============================================================
//  RehabMed ERP — Módulo Evoluciones (Historia Clínica)
//  Tabla:  public.evoluciones
//  RLS:    profesional crea/lee solo de sus pacientes
//          una vez firmada, no se puede editar
//  UI:     #hcl-evoluciones (panel) + modalNuevaEvolucion
//  Provee: window.EvolucionesMod = { ... }
//          window.guardarEvolucion (sobreescribe legacy)
//          window.renderEvolucionesList (sobreescribe legacy)
// ============================================================
import { supabase } from './lib/supabase.js';
import { currentProfile } from './auth.js';

// ── Estado ────────────────────────────────────────────────
let _evolucionesPorPaciente = {};       // { pacienteId: [evoluciones, ...] }
let _realtimeChannel        = null;

// ============================================================
//  HELPERS
// ============================================================

// Obtiene el row de profesionales para el usuario logueado.
// Devuelve null si el usuario no tiene perfil de profesional.
async function getProfesionalActual() {
  if (!currentProfile) return null;
  const { data, error } = await supabase
    .from('profesionales')
    .select('id, nombre, especialidad')
    .eq('profile_id', currentProfile.id)
    .maybeSingle();
  if (error) {
    console.warn('[Evoluciones] No se pudo resolver profesional:', error.message);
    return null;
  }
  return data;   // null si el usuario no tiene fila en profesionales
}

function fmtFechaEs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) + ' ' + new Date(ts).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit',
  });
}

// ============================================================
//  CARGAR EVOLUCIONES DE UN PACIENTE
// ============================================================
export async function cargarEvolucionesPaciente(pacienteId) {
  if (!pacienteId) return [];

  const { data, error } = await supabase
    .from('evoluciones')
    .select(`
      id, paciente_id, profesional_id, turno_id,
      fecha, texto, firmado, firmado_at, created_at,
      profesional:profesionales!evoluciones_profesional_id_fkey ( id, nombre, especialidad )
    `)
    .eq('paciente_id', pacienteId)
    .order('fecha', { ascending: false });

  if (error) {
    console.error('[Evoluciones] ❌ Error al cargar:', error.message);
    if (typeof showToast === 'function') showToast('❌ Error al cargar evoluciones');
    return [];
  }

  _evolucionesPorPaciente[pacienteId] = data || [];
  renderEvoluciones(pacienteId);
  console.log(`[Evoluciones] ✅ ${(data||[]).length} evoluciones de ${pacienteId.slice(0,8)}`);
  return data || [];
}

// ============================================================
//  CREAR EVOLUCIÓN
// ============================================================
export async function crearEvolucion({ pacienteId, turnoId, texto, mejoras, eva }) {
  if (!pacienteId) {
    if (typeof showToast === 'function') showToast('⚠️ Falta paciente');
    return null;
  }
  if (!texto || !texto.trim()) {
    if (typeof showToast === 'function') showToast('⚠️ La evolución no puede estar vacía');
    return null;
  }

  const profesional = await getProfesionalActual();
  if (!profesional) {
    if (typeof showToast === 'function') {
      showToast('⚠️ Solo profesionales pueden crear evoluciones. Tu usuario no tiene perfil de profesional.');
    }
    return null;
  }

  // Construir texto enriquecido con mejoras + EVA
  let textoCompleto = texto.trim();
  const partesExtra = [];
  if (mejoras && mejoras.trim()) partesExtra.push(`Mejoras: ${mejoras.trim()}`);
  if (eva !== undefined && eva !== null && eva !== '') partesExtra.push(`Dolor EVA: ${eva}/10`);
  if (partesExtra.length > 0) {
    textoCompleto += '\n\n' + partesExtra.join(' · ');
  }

  const { data, error } = await supabase
    .from('evoluciones')
    .insert([{
      paciente_id:    pacienteId,
      profesional_id: profesional.id,
      turno_id:       turnoId || null,
      texto:          textoCompleto,
      firmado:        false,
    }])
    .select()
    .single();

  if (error) {
    console.error('[Evoluciones] ❌ Error al crear:', error.message);
    if (typeof showToast === 'function') showToast('❌ Error al crear evolución: ' + error.message);
    return null;
  }

  if (typeof showToast === 'function') showToast('💾 Evolución guardada');
  // Realtime lo refresca, pero refrescamos local por si la suscripción no está
  await cargarEvolucionesPaciente(pacienteId);
  return data;
}

// ============================================================
//  FIRMAR EVOLUCIÓN (irreversible — bloquea ediciones futuras)
// ============================================================
export async function firmarEvolucion(id) {
  if (!confirm('Una vez firmada, la evolución no se podrá editar ni eliminar. ¿Continuar?')) {
    return false;
  }

  const { data, error } = await supabase
    .from('evoluciones')
    .update({ firmado: true, firmado_at: new Date().toISOString() })
    .eq('id', id)
    .eq('firmado', false)   // doble check: solo firma si no está firmada
    .select()
    .single();

  if (error) {
    console.error('[Evoluciones] ❌ Error al firmar:', error.message);
    if (typeof showToast === 'function') showToast('❌ No se pudo firmar la evolución');
    return false;
  }

  if (typeof showToast === 'function') showToast('🔏 Evolución firmada');
  if (data && data.paciente_id) await cargarEvolucionesPaciente(data.paciente_id);
  return true;
}

// ============================================================
//  ACTUALIZAR (solo si NO está firmada — RLS también lo enforce)
// ============================================================
export async function actualizarEvolucion(id, nuevoTexto) {
  if (!nuevoTexto || !nuevoTexto.trim()) {
    if (typeof showToast === 'function') showToast('⚠️ El texto no puede estar vacío');
    return false;
  }

  const { data, error } = await supabase
    .from('evoluciones')
    .update({ texto: nuevoTexto.trim() })
    .eq('id', id)
    .eq('firmado', false)
    .select()
    .single();

  if (error) {
    console.error('[Evoluciones] ❌ Error al actualizar:', error.message);
    if (typeof showToast === 'function') showToast('❌ No se pudo actualizar (¿está firmada?)');
    return false;
  }

  if (typeof showToast === 'function') showToast('✏️ Evolución actualizada');
  if (data && data.paciente_id) await cargarEvolucionesPaciente(data.paciente_id);
  return true;
}

// ============================================================
//  ELIMINAR (solo si NO está firmada y RLS lo permite)
// ============================================================
export async function eliminarEvolucion(id) {
  if (!confirm('¿Eliminar esta evolución?')) return false;

  // Primero obtener el paciente_id para refrescar después
  const { data: evo } = await supabase
    .from('evoluciones').select('paciente_id, firmado').eq('id', id).single();
  if (evo && evo.firmado) {
    if (typeof showToast === 'function') showToast('🔏 No se puede eliminar una evolución firmada');
    return false;
  }

  const { error } = await supabase.from('evoluciones').delete().eq('id', id);
  if (error) {
    console.error('[Evoluciones] ❌ Error al eliminar:', error.message);
    if (typeof showToast === 'function') showToast('❌ No se pudo eliminar');
    return false;
  }

  if (typeof showToast === 'function') showToast('🗑️ Evolución eliminada');
  if (evo && evo.paciente_id) await cargarEvolucionesPaciente(evo.paciente_id);
  return true;
}

// ============================================================
//  REALTIME — INSERT/UPDATE/DELETE
// ============================================================
export function suscribirRealtimeEvoluciones() {
  if (_realtimeChannel) supabase.removeChannel(_realtimeChannel);

  _realtimeChannel = supabase
    .channel('evoluciones-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'evoluciones' },
      (payload) => {
        const { eventType, new: nuevo, old: viejo } = payload;
        const pacienteId = (nuevo && nuevo.paciente_id) || (viejo && viejo.paciente_id);
        if (!pacienteId) return;

        // Solo refrescar si tenemos cargado ese paciente
        if (_evolucionesPorPaciente[pacienteId] !== undefined) {
          console.log('[Realtime] 📡 Cambio en evoluciones:', eventType);
          cargarEvolucionesPaciente(pacienteId);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Evoluciones] Realtime:', status);
    });
}

// ============================================================
//  RENDER — sobreescribe el del HTML legacy
// ============================================================
function renderEvoluciones(pacienteId) {
  const cont = document.getElementById('hcl-evoluciones');
  if (!cont) return;

  const evos = _evolucionesPorPaciente[pacienteId] || [];

  if (evos.length === 0) {
    cont.innerHTML = `
      <div style="text-align:center;padding:30px 12px;color:var(--text4)">
        <div style="font-size:32px;margin-bottom:8px">📝</div>
        <div style="font-weight:700;color:var(--text3)">Sin evoluciones registradas</div>
        <div style="font-size:12px;margin-top:4px">Click en "+ Nueva Evolución" para registrar la primera</div>
      </div>`;
    return;
  }

  cont.innerHTML = evos.map(e => {
    const profNombre = (e.profesional && e.profesional.nombre) || 'Profesional';
    const fecha = fmtFechaEs(e.fecha);
    const firmadoBadge = e.firmado
      ? `<span style="background:rgba(5,150,105,0.1);color:var(--emerald);padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700">🔏 Firmada · ${fmtFechaEs(e.firmado_at)}</span>`
      : `<span style="background:rgba(217,119,6,0.1);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700">📝 Sin firmar</span>`;
    const acciones = e.firmado ? '' : `
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 10px" onclick="window.EvolucionesMod.firmarEvolucion('${e.id}')" title="Firmar (irreversible)">🔏 Firmar</button>
        <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 10px;color:var(--rose)" onclick="window.EvolucionesMod.eliminarEvolucion('${e.id}')">🗑️</button>
      </div>`;

    // Convertir saltos de línea a <br> para el render
    const textoHTML = (e.texto || '').replace(/\n/g, '<br>');

    return `
      <div class="evolution-item" style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;background:rgba(255,255,255,0.5)">
        <div class="evo-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <div>
            <span class="evo-date" style="font-weight:700;color:var(--text2);font-size:12px">${fecha}</span>
            <span class="evo-prof" style="color:var(--text3);font-size:11px;margin-left:8px">· ${profNombre}</span>
          </div>
          ${firmadoBadge}
        </div>
        <div class="evo-text" style="color:var(--text2);font-size:13px;line-height:1.5">${textoHTML}</div>
        ${acciones}
      </div>`;
  }).join('');
}

// ============================================================
//  WRAPPER del modal "Nueva Evolución" del HTML
//  Sobreescribe window.guardarEvolucion legacy
// ============================================================
async function guardarEvolucionDesdeModal() {
  const txt     = (document.getElementById('evoTxt')?.value || '').trim();
  const mejoras = (document.getElementById('evoMejoras')?.value || '').trim();
  const eva     = document.getElementById('evoEva')?.value;

  if (!txt) {
    if (typeof showToast === 'function') showToast('❌ Ingresá la evolución clínica');
    return;
  }

  const pacienteId = window._currentHCLPacId;
  if (!pacienteId) {
    if (typeof showToast === 'function') showToast('❌ No hay paciente seleccionado');
    return;
  }

  const creada = await crearEvolucion({
    pacienteId,
    texto: txt,
    mejoras,
    eva,
  });

  if (!creada) return;     // crearEvolucion ya emitió toast de error

  // Cerrar modal y limpiar form
  if (typeof closeModal === 'function') closeModal('modalNuevaEvolucion');
  if (document.getElementById('evoTxt'))      document.getElementById('evoTxt').value = '';
  if (document.getElementById('evoMejoras'))  document.getElementById('evoMejoras').value = '';
  if (document.getElementById('evoEva'))      document.getElementById('evoEva').value = '3';
  if (document.getElementById('evoEvaVal'))   document.getElementById('evoEvaVal').textContent = '3';
}

// ============================================================
//  EXPORT GLOBAL
// ============================================================
window.EvolucionesMod = {
  cargarEvolucionesPaciente,
  crearEvolucion,
  firmarEvolucion,
  actualizarEvolucion,
  eliminarEvolucion,
  suscribirRealtimeEvoluciones,
  get cache() { return _evolucionesPorPaciente; },
};

// Sobreescribir funciones legacy del HTML
window.guardarEvolucion       = guardarEvolucionDesdeModal;
window.renderEvolucionesList  = (evos) => {
  // Compat: el HTML legacy llamaba con un array; nosotros usamos cache por paciente
  const pacienteId = window._currentHCLPacId;
  if (pacienteId) {
    _evolucionesPorPaciente[pacienteId] = evos || [];
    renderEvoluciones(pacienteId);
  }
};
