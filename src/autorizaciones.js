// ============================================================
//  RehabMed ERP — Módulo Autorizaciones (Obras Sociales)
//  Tablas: public.autorizaciones
//  Vista:  public.v_autorizaciones_criticas
//  RLS:    admin/recepcion gestionan, profesional lee de sus pacientes
//  Provee: window.AutorizacionesMod = { ... }
// ============================================================
import { supabase } from './lib/supabase.js';

// ── Estado ────────────────────────────────────────────────
let _porPaciente   = {};       // { pacienteId: [autorizaciones, ...] }
let _criticas      = [];       // cache de v_autorizaciones_criticas
let _realtimeChannel = null;

// ============================================================
//  HELPERS
// ============================================================
function fmtFechaCorta(dateStr) {
  if (!dateStr) return '—';
  // dateStr formato 'YYYY-MM-DD' (date column de Postgres)
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function diasHasta(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const hoy    = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.floor((target - hoy) / (1000 * 60 * 60 * 24));
}

// ============================================================
//  LISTAR AUTORIZACIONES DE UN PACIENTE
// ============================================================
export async function cargarAutorizacionesPaciente(pacienteId) {
  if (!pacienteId) return [];

  const { data, error } = await supabase
    .from('autorizaciones')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('fecha_solicitud', { ascending: false });

  if (error) {
    console.error('[Autorizaciones] ❌ Error al cargar:', error.message);
    return [];
  }

  _porPaciente[pacienteId] = data || [];
  return data || [];
}

// ============================================================
//  CARGAR ALERTAS CRÍTICAS (vista pre-filtrada)
//  Devuelve autorizaciones a < 7 días de vencer o con < 3 sesiones
// ============================================================
export async function cargarCriticas() {
  const { data, error } = await supabase
    .from('v_autorizaciones_criticas')
    .select('*')
    .order('fecha_vencimiento', { ascending: true });

  if (error) {
    console.error('[Autorizaciones] ❌ Error al cargar críticas:', error.message);
    return [];
  }

  _criticas = data || [];
  renderPanelCriticas();
  return _criticas;
}

// ============================================================
//  CREAR AUTORIZACIÓN
// ============================================================
export async function crearAutorizacion({
  pacienteId, obraSocial, prestacion, numero,
  sesionesAuth, fechaVencimiento,
}) {
  if (!pacienteId)      { _toast('⚠️ Falta paciente'); return null; }
  if (!obraSocial)      { _toast('⚠️ Falta obra social'); return null; }
  if (!prestacion)      { _toast('⚠️ Falta prestación'); return null; }
  if (!numero)          { _toast('⚠️ Falta número de autorización'); return null; }
  if (!sesionesAuth || sesionesAuth < 1) {
    _toast('⚠️ Sesiones autorizadas debe ser mayor a 0'); return null;
  }

  const { data, error } = await supabase
    .from('autorizaciones')
    .insert([{
      paciente_id:       pacienteId,
      obra_social:       obraSocial,
      prestacion,
      numero,
      sesiones_auth:     sesionesAuth,
      sesiones_usadas:   0,
      fecha_solicitud:   new Date().toISOString().slice(0, 10),
      fecha_vencimiento: fechaVencimiento || null,
      estado:            'Pendiente',
    }])
    .select()
    .single();

  if (error) {
    console.error('[Autorizaciones] ❌ Error al crear:', error.message);
    _toast('❌ Error al crear autorización: ' + error.message);
    return null;
  }

  _toast(`✅ Autorización ${numero} creada`);
  return data;
}

// ============================================================
//  CAMBIAR ESTADO (Pendiente → Aprobada / Rechazada / etc.)
// ============================================================
export async function cambiarEstado(id, nuevoEstado) {
  const estadosValidos = ['Pendiente', 'Aprobada', 'Rechazada', 'En revisión', 'Vencida'];
  if (!estadosValidos.includes(nuevoEstado)) {
    _toast('❌ Estado inválido');
    return false;
  }

  const { error } = await supabase
    .from('autorizaciones')
    .update({ estado: nuevoEstado })
    .eq('id', id);

  if (error) {
    console.error('[Autorizaciones] ❌ Error al cambiar estado:', error.message);
    _toast('❌ No se pudo cambiar el estado');
    return false;
  }

  _toast(`✅ Estado actualizado a ${nuevoEstado}`);
  return true;
}

// ============================================================
//  CONSUMIR UNA SESIÓN MANUALMENTE
//
//  IMPORTANTE: a partir de la migration 003_triggers_negocio.sql,
//  esto ocurre AUTOMÁTICAMENTE cuando un turno pasa a 'Finalizado'.
//
//  Esta función queda disponible solo para casos especiales:
//   • Sesión externa (no asociada a un turno del sistema)
//   • Ajuste manual por error de captura
//   • Recuperación tras una rollback
//
//  Si el trigger 003 está aplicado, NO uses este botón después
//  de finalizar un turno — sería un doble conteo.
// ============================================================
export async function consumirSesion(autorizacionId) {
  // Leer estado actual
  const { data: actual, error: errSel } = await supabase
    .from('autorizaciones')
    .select('sesiones_auth, sesiones_usadas')
    .eq('id', autorizacionId)
    .single();

  if (errSel) {
    _toast('❌ No se encontró la autorización');
    return false;
  }

  if (actual.sesiones_usadas >= actual.sesiones_auth) {
    _toast('⚠️ La autorización ya consumió todas sus sesiones');
    return false;
  }

  const { error } = await supabase
    .from('autorizaciones')
    .update({ sesiones_usadas: actual.sesiones_usadas + 1 })
    .eq('id', autorizacionId);

  if (error) {
    console.error('[Autorizaciones] ❌ Error al consumir sesión:', error.message);
    _toast('❌ No se pudo registrar la sesión');
    return false;
  }

  const restantes = actual.sesiones_auth - (actual.sesiones_usadas + 1);
  if (restantes <= 2) {
    _toast(`⚠️ Quedan ${restantes} sesiones — gestionar renovación`);
  } else {
    _toast(`✅ Sesión registrada (${restantes} restantes)`);
  }
  return true;
}

// ============================================================
//  LISTAR TODAS (admin/recepcion)
// ============================================================
export async function listarTodas({ estado, obraSocial } = {}) {
  let q = supabase
    .from('autorizaciones')
    .select(`
      *,
      paciente:pacientes!autorizaciones_paciente_id_fkey ( id, nombre, ref, telefono )
    `)
    .order('fecha_solicitud', { ascending: false });

  if (estado)     q = q.eq('estado', estado);
  if (obraSocial) q = q.ilike('obra_social', `%${obraSocial}%`);

  const { data, error } = await q;
  if (error) {
    console.error('[Autorizaciones] ❌ Error al listar:', error.message);
    return [];
  }
  return data || [];
}

// ============================================================
//  ELIMINAR
// ============================================================
export async function eliminarAutorizacion(id) {
  if (!confirm('¿Eliminar esta autorización?')) return false;
  const { error } = await supabase.from('autorizaciones').delete().eq('id', id);
  if (error) {
    _toast('❌ No se pudo eliminar (¿tiene sesiones consumidas?)');
    return false;
  }
  _toast('🗑️ Autorización eliminada');
  return true;
}

// ============================================================
//  REALTIME
// ============================================================
export function suscribirRealtimeAutorizaciones() {
  if (_realtimeChannel) supabase.removeChannel(_realtimeChannel);

  _realtimeChannel = supabase
    .channel('autorizaciones-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'autorizaciones' },
      (payload) => {
        const { eventType, new: nuevo, old: viejo } = payload;
        const pacienteId = (nuevo && nuevo.paciente_id) || (viejo && viejo.paciente_id);
        console.log('[Realtime] 📡 Cambio en autorizaciones:', eventType);

        // Refrescar críticas (panel global)
        cargarCriticas();

        // Refrescar autorizaciones del paciente si está cargado en HCl
        if (pacienteId && _porPaciente[pacienteId] !== undefined) {
          cargarAutorizacionesPaciente(pacienteId).then(() => renderHCl(pacienteId));
        }
      }
    )
    .subscribe((status) => {
      console.log('[Autorizaciones] Realtime:', status);
    });
}

// ============================================================
//  RENDER PANEL DE ALERTAS (top-bar global)
//  Inyecta un indicador en el sidebar si hay autorizaciones críticas.
// ============================================================
function renderPanelCriticas() {
  // Buscar contenedor; si no existe, lo creamos en el sidebar
  let panel = document.getElementById('panel-autorizaciones-criticas');
  if (!panel) {
    // No hay UI dedicada todavía — solo log + count
    const count = _criticas.length;
    if (count > 0) {
      console.log(`[Autorizaciones] ⚠️ ${count} autorizaciones críticas`);
    }
    return;
  }

  if (_criticas.length === 0) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  panel.innerHTML = `
    <div style="background:rgba(225,29,72,0.05);border:1px solid var(--rose);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--rose);font-size:12px;margin-bottom:6px">
        ⚠️ ${_criticas.length} autorización${_criticas.length !== 1 ? 'es' : ''} crítica${_criticas.length !== 1 ? 's' : ''}
      </div>
      ${_criticas.slice(0, 5).map(a => {
        const dias = diasHasta(a.fecha_vencimiento);
        const motivo = a.nivel_alerta === 'sesiones_critico'
          ? `${a.sesiones_restantes} sesión${a.sesiones_restantes !== 1 ? 'es' : ''} restante${a.sesiones_restantes !== 1 ? 's' : ''}`
          : (dias !== null ? (dias < 0 ? `Venció hace ${-dias} día(s)` : `Vence en ${dias} día(s)`) : '—');
        return `
          <div style="font-size:11px;padding:6px 0;border-top:1px solid var(--border)">
            <div style="font-weight:700;color:var(--text2)">${a.pac_nombre}</div>
            <div style="color:var(--text3)">${a.obra_social} · ${motivo}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
//  RENDER PANEL EN HCl (autorizaciones del paciente)
//  Inyecta una sección abajo del plan de tratamiento
// ============================================================
function renderHCl(pacienteId) {
  const cont = document.getElementById('hcl-autorizaciones');
  if (!cont) return;       // si no existe el contenedor, no renderizamos

  const lista = _porPaciente[pacienteId] || [];

  if (lista.length === 0) {
    cont.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text4);font-size:12px">
        Sin autorizaciones registradas
      </div>`;
    return;
  }

  cont.innerHTML = lista.map(a => {
    const restantes = a.sesiones_auth - a.sesiones_usadas;
    const pct       = Math.min(100, (a.sesiones_usadas / a.sesiones_auth) * 100);
    const colorEstado = {
      'Aprobada':    'var(--emerald)',
      'Pendiente':   'var(--amber)',
      'En revisión': 'var(--sky)',
      'Rechazada':   'var(--rose)',
      'Vencida':     'var(--text4)',
    }[a.estado] || 'var(--text3)';

    const dias = diasHasta(a.fecha_vencimiento);
    const alertaVenc = (dias !== null && dias <= 7 && a.estado === 'Aprobada')
      ? `<span style="color:var(--rose);font-weight:700;font-size:10px"> · Vence en ${dias}d</span>`
      : '';
    const alertaSes = (restantes <= 2 && a.estado === 'Aprobada')
      ? `<span style="color:var(--rose);font-weight:700;font-size:10px"> · ${restantes} sesión(es)</span>`
      : '';

    return `
      <div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,0.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;color:var(--text2);font-size:13px">${a.obra_social} — ${a.prestacion}</div>
            <div style="font-size:10px;color:var(--text4);font-family:var(--mono)">N° ${a.numero}${alertaVenc}${alertaSes}</div>
          </div>
          <span style="background:${colorEstado}22;color:${colorEstado};padding:2px 10px;border-radius:99px;font-size:10px;font-weight:700">${a.estado}</span>
        </div>
        <div style="margin:6px 0">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:2px">
            <span>${a.sesiones_usadas} / ${a.sesiones_auth} sesiones</span>
            <span>${restantes} restantes</span>
          </div>
          <div style="height:4px;background:var(--bg);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${restantes <= 2 ? 'var(--rose)' : 'var(--sky2)'};transition:width 0.3s"></div>
          </div>
        </div>
        <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
          ${a.estado === 'Pendiente' ? `<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px" onclick="window.AutorizacionesMod.cambiarEstado('${a.id}','Aprobada')">✅ Aprobar</button>` : ''}
          ${a.estado === 'Aprobada' && restantes > 0 ? `<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px" onclick="if(confirm('Si el trigger SQL 003 está activo, las sesiones se descuentan automáticamente al finalizar turnos. ¿Sumar manualmente igual?')) window.AutorizacionesMod.consumirSesion('${a.id}')" title="Solo para sesiones que no estén asociadas a un turno del sistema">+ 1 sesión (manual)</button>` : ''}
          <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;color:var(--rose)" onclick="window.AutorizacionesMod.eliminarAutorizacion('${a.id}')">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
//  HOOK: cuando se abre HCl de un paciente, cargar sus autorizaciones
//  Lo expongo como función pública que llama pacientes.showHCL.
// ============================================================
export async function cargarParaHCl(pacienteId) {
  await cargarAutorizacionesPaciente(pacienteId);
  renderHCl(pacienteId);
}

// ============================================================
//  HELPER toast
// ============================================================
function _toast(msg) {
  if (typeof showToast === 'function') showToast(msg);
}

// ============================================================
//  WRAPPERS para modal "Nueva Autorización" del HTML
// ============================================================
window.openModalNuevaAutorizacion = function() {
  if (!window._currentHCLPacId) {
    _toast('⚠️ Abrí primero la ficha del paciente');
    return;
  }
  // Limpiar form
  ['autObraSocial', 'autPrestacion', 'autNumero', 'autVencimiento']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const ses = document.getElementById('autSesiones');
  if (ses) ses.value = '10';
  if (typeof openModal === 'function') openModal('modalNuevaAutorizacion');
};

window.guardarNuevaAutorizacion = async function() {
  const pacienteId = window._currentHCLPacId;
  if (!pacienteId) { _toast('❌ No hay paciente seleccionado'); return; }

  const obraSocial   = (document.getElementById('autObraSocial')?.value || '').trim();
  const prestacion   = (document.getElementById('autPrestacion')?.value || '').trim();
  const numero       = (document.getElementById('autNumero')?.value || '').trim();
  const sesionesAuth = parseInt(document.getElementById('autSesiones')?.value || '0', 10);
  const fechaVenc    = (document.getElementById('autVencimiento')?.value || '').trim() || null;

  const creada = await crearAutorizacion({
    pacienteId, obraSocial, prestacion, numero,
    sesionesAuth, fechaVencimiento: fechaVenc,
  });
  if (!creada) return;

  if (typeof closeModal === 'function') closeModal('modalNuevaAutorizacion');
  // Realtime refresca el panel del HCl automáticamente
};

// ============================================================
//  EXPORT GLOBAL
// ============================================================
window.AutorizacionesMod = {
  cargarAutorizacionesPaciente,
  cargarCriticas,
  cargarParaHCl,
  crearAutorizacion,
  cambiarEstado,
  consumirSesion,
  listarTodas,
  eliminarAutorizacion,
  suscribirRealtimeAutorizaciones,
  get cache() { return _porPaciente; },
  get criticas() { return _criticas; },
};
