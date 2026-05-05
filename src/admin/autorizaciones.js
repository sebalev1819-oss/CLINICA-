// ============================================================
//  RehabMed ERP — Módulo Autorizaciones (Obras Sociales / Prepagas)
//
//  CRUD de autorizaciones de OS/prepagas con:
//    • Sesiones autorizadas + frecuencia (X por semana / mes)
//    • Vencimiento con alerta a 10 días
//    • Upload de PDF de la autorización
//    • Filtro automático: solo se muestra si paciente.cobertura ≠ Particular
//
//  Provee:
//    • cargarAutorizacionesPaciente(pacId) → lista
//    • abrirModalAutorizacion(pacId, autId?) → crear o editar
//    • renderTarjetasAutorizaciones(container, autorizaciones) → UI lista
//    • cargarAlertasCriticas() → para dashboard
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { formatSupabaseError } from '../lib/errors.js';

const BUCKET = 'autorizaciones-docs';

// Estado del modal
let _editandoAutId = null;
let _pacIdActual = null;
let _archivoActual = null; // { path, nombre } si está editando una existente

// ============================================================
//  CARGAR AUTORIZACIONES DE UN PACIENTE
// ============================================================
export async function cargarAutorizacionesPaciente(pacId) {
  const { data, error } = await supabase
    .from('v_autorizaciones_full')
    .select('*')
    .eq('paciente_id', pacId)
    .order('fecha_solicitud', { ascending: false });

  if (error) {
    console.error('[Autorizaciones] cargar:', error);
    showToast('❌ ' + formatSupabaseError(error, 'autorizaciones'));
    return [];
  }

  return data || [];
}

// ============================================================
//  CARGAR AUTORIZACIONES CRÍTICAS (para dashboard)
//  Vencen en ≤ 10 días, sin sesiones, o vencidas
// ============================================================
export async function cargarAlertasCriticas() {
  const { data, error } = await supabase
    .from('v_autorizaciones_criticas')
    .select('*')
    .limit(50);

  if (error) {
    console.warn('[Autorizaciones] criticas:', error);
    return [];
  }
  return data || [];
}

// ============================================================
//  ABRIR MODAL (crear o editar)
// ============================================================
export async function abrirModalAutorizacion(pacId, autId = null) {
  _pacIdActual = pacId;
  _editandoAutId = autId;
  _archivoActual = null;

  // Cargar profesionales para el dropdown
  const profSelect = document.getElementById('autProfesional');
  if (profSelect) {
    const profs = window.PROFESIONALES_DATA || [];
    profSelect.innerHTML = '<option value="">Cualquier profesional</option>'
      + profs.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.nombre)} — ${escapeHtml(p.esp || '')}</option>`).join('');
  }

  resetForm();

  if (autId) {
    // Modo edición: cargar datos existentes
    const { data: aut, error } = await supabase
      .from('autorizaciones').select('*').eq('id', autId).single();
    if (error || !aut) {
      showToast('❌ ' + formatSupabaseError(error || { message: 'Autorización no encontrada' }, 'autorización'));
      return;
    }

    document.getElementById('modalAutTitle').textContent = `✏️ Editar autorización ${aut.numero || ''}`;
    document.getElementById('modalAutSubtitle').textContent = 'Modificá los datos del comprobante de la OS o prepaga.';

    setVal('autObraSocial', aut.obra_social);
    setVal('autNumero', aut.numero);
    setVal('autPrestacion', aut.prestacion);
    setVal('autDescripcion', aut.descripcion);
    setVal('autProfesional', aut.profesional_id);
    setVal('autEstado', aut.estado);
    setVal('autSesiones', aut.sesiones_auth);
    setVal('autSesionesUsadas', aut.sesiones_usadas);
    setVal('autFrecTipo', aut.frecuencia_tipo);
    setVal('autFrecCant', aut.frecuencia_cantidad);
    setVal('autFechaSolicitud', aut.fecha_solicitud);
    setVal('autFechaInicio', aut.fecha_inicio);
    setVal('autFechaVenc', aut.fecha_vencimiento);
    setVal('autNotas', aut.notas);

    // Si hay archivo cargado, mostrar info
    if (aut.archivo_path) {
      _archivoActual = { path: aut.archivo_path, nombre: aut.archivo_nombre };
      const wrap = document.getElementById('autArchivoActualWrap');
      const nombreEl = document.getElementById('autArchivoActualNombre');
      const verBtn = document.getElementById('autArchivoVer');
      if (wrap) wrap.style.display = 'block';
      if (nombreEl) nombreEl.textContent = aut.archivo_nombre || 'Archivo cargado';
      if (verBtn) verBtn.onclick = () => descargarArchivo(aut.archivo_path);
    }
  } else {
    document.getElementById('modalAutTitle').textContent = '📋 Nueva autorización';
    document.getElementById('modalAutSubtitle').textContent = 'Cargá los datos del comprobante de la OS o prepaga.';
    // Default fecha solicitud = hoy
    document.getElementById('autFechaSolicitud').value = new Date().toISOString().slice(0, 10);
  }

  // Hook del botón guardar
  const btn = document.getElementById('btnGuardarAutorizacion');
  if (btn) btn.onclick = guardarHandler;

  if (typeof window.openModal === 'function') window.openModal('modalAutorizacion');
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}

function resetForm() {
  [
    'autObraSocial','autNumero','autPrestacion','autDescripcion','autProfesional',
    'autSesiones','autSesionesUsadas','autFrecTipo','autFrecCant',
    'autFechaSolicitud','autFechaInicio','autFechaVenc','autNotas','autArchivo',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  setVal('autEstado', 'Aprobada');
  setVal('autSesionesUsadas', '0');

  const wrap = document.getElementById('autArchivoActualWrap');
  if (wrap) wrap.style.display = 'none';
}

// ============================================================
//  GUARDAR (crear / actualizar)
// ============================================================
async function guardarHandler() {
  const v = id => document.getElementById(id)?.value?.trim() || null;
  const vNum = id => {
    const n = parseInt(document.getElementById(id)?.value);
    return Number.isFinite(n) ? n : null;
  };

  const obraSocial = v('autObraSocial');
  const numero     = v('autNumero');
  const prestacion = v('autPrestacion');
  const sesiones   = vNum('autSesiones');
  const fechaVenc  = v('autFechaVenc');

  if (!obraSocial)  { showToast('⚠️ Elegí la obra social'); return; }
  if (!numero)      { showToast('⚠️ Falta el número de autorización'); return; }
  if (!prestacion)  { showToast('⚠️ Falta la prestación / tratamiento'); return; }
  if (sesiones == null || sesiones < 1) { showToast('⚠️ Cantidad de sesiones debe ser ≥ 1'); return; }
  if (!fechaVenc)   { showToast('⚠️ Falta la fecha de vencimiento'); return; }

  const sesUsadas = vNum('autSesionesUsadas') || 0;
  if (sesUsadas > sesiones) {
    showToast('⚠️ Las sesiones usadas no pueden ser más que las autorizadas');
    return;
  }

  const payload = {
    paciente_id:         _pacIdActual,
    obra_social:         obraSocial,
    numero:              numero,
    prestacion:          prestacion,
    descripcion:         v('autDescripcion'),
    profesional_id:      v('autProfesional') || null,
    estado:              v('autEstado') || 'Aprobada',
    sesiones_auth:       sesiones,
    sesiones_usadas:     sesUsadas,
    frecuencia_tipo:     v('autFrecTipo'),
    frecuencia_cantidad: vNum('autFrecCant'),
    fecha_solicitud:     v('autFechaSolicitud') || new Date().toISOString().slice(0, 10),
    fecha_inicio:        v('autFechaInicio'),
    fecha_vencimiento:   fechaVenc,
    notas:               v('autNotas'),
  };

  // Si hay archivo nuevo: subir primero
  const fileInput = document.getElementById('autArchivo');
  const file = fileInput?.files?.[0];
  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('⚠️ El archivo supera los 5MB');
      return;
    }
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin';
    const safeName = (numero || 'autorizacion').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const path = `${_pacIdActual}/${Date.now()}_${safeName}.${ext}`;

    showToast('⏳ Subiendo archivo...');
    const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (errUp) {
      console.error('[Autorizaciones] upload:', errUp);
      showToast('❌ ' + formatSupabaseError(errUp, 'archivo'));
      return;
    }

    // Borrar archivo viejo si existía
    if (_archivoActual?.path) {
      await supabase.storage.from(BUCKET).remove([_archivoActual.path]);
    }

    payload.archivo_path = path;
    payload.archivo_nombre = file.name;
    payload.archivo_mime = file.type;
    payload.archivo_tamano = file.size;
  } else if (_archivoActual) {
    // Mantener archivo existente si no se subió uno nuevo
    payload.archivo_path = _archivoActual.path;
    payload.archivo_nombre = _archivoActual.nombre;
  }

  let result;
  if (_editandoAutId) {
    result = await supabase.from('autorizaciones').update(payload).eq('id', _editandoAutId).select().single();
  } else {
    result = await supabase.from('autorizaciones').insert([payload]).select().single();
  }

  if (result.error) {
    console.error('[Autorizaciones] guardar:', result.error);
    showToast('❌ ' + formatSupabaseError(result.error, 'autorización'));
    // Rollback del upload si falla
    if (file && payload.archivo_path) {
      await supabase.storage.from(BUCKET).remove([payload.archivo_path]);
    }
    return;
  }

  showToast(_editandoAutId
    ? `✅ Autorización ${result.data.numero} actualizada`
    : `✅ Autorización ${result.data.numero} creada — ${sesiones} sesiones autorizadas`);

  if (typeof window.closeModal === 'function') window.closeModal('modalAutorizacion');

  // Notificar a quien esté escuchando (ej: ficha-paciente)
  document.dispatchEvent(new CustomEvent('autorizacion-guardada', {
    detail: { pacienteId: _pacIdActual, autorizacion: result.data },
  }));
}

// ============================================================
//  ELIMINAR
// ============================================================
export async function eliminarAutorizacion(autId, archivoPath) {
  if (!confirm('¿Eliminar esta autorización?\nEsta acción no se puede deshacer.')) return false;

  // Borrar archivo si existe
  if (archivoPath) {
    await supabase.storage.from(BUCKET).remove([archivoPath]);
  }

  const { error } = await supabase.from('autorizaciones').delete().eq('id', autId);
  if (error) {
    showToast('❌ ' + formatSupabaseError(error, 'autorización'));
    return false;
  }

  showToast('🗑️ Autorización eliminada');
  return true;
}

// ============================================================
//  DESCARGAR ARCHIVO
// ============================================================
export async function descargarArchivo(path) {
  if (!path) { showToast('⚠️ Sin archivo'); return; }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data) {
    showToast('❌ ' + formatSupabaseError(error, 'archivo'));
    return;
  }
  window.open(data.signedUrl, '_blank');
}

// ============================================================
//  RENDER TARJETAS — para usar en la ficha del paciente
// ============================================================
export function renderTarjetasAutorizaciones(container, autorizaciones, opciones = {}) {
  const { pacienteId, mostrarBotonCrear = true } = opciones;

  const headerHTML = mostrarBotonCrear
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
         <div style="font-size:14px;font-weight:700;color:var(--text)">📋 Autorizaciones (${autorizaciones.length})</div>
         <button class="btn btn-sky btn-sm" data-aut-action="nueva" style="font-size:12px">+ Nueva autorización</button>
       </div>`
    : '';

  if (autorizaciones.length === 0) {
    container.innerHTML = `
      ${headerHTML}
      <div style="text-align:center;padding:40px;color:var(--text4);background:var(--bg);border-radius:10px">
        <div style="font-size:36px;margin-bottom:10px">📋</div>
        <div style="font-size:13px;font-weight:700;color:var(--text3)">Sin autorizaciones cargadas</div>
        <div style="font-size:11px;margin-top:4px">Click en "+ Nueva autorización" para cargar la primera</div>
      </div>`;
  } else {
    container.innerHTML = headerHTML + autorizaciones.map(renderTarjetaAutorizacion).join('');
  }

  // Event delegation
  container.addEventListener('click', async (ev) => {
    const btnNueva = ev.target.closest('[data-aut-action="nueva"]');
    if (btnNueva) {
      abrirModalAutorizacion(pacienteId, null);
      return;
    }
    const btnEditar = ev.target.closest('[data-aut-action="editar"]');
    if (btnEditar) {
      abrirModalAutorizacion(pacienteId, btnEditar.getAttribute('data-aut-id'));
      return;
    }
    const btnEliminar = ev.target.closest('[data-aut-action="eliminar"]');
    if (btnEliminar) {
      const ok = await eliminarAutorizacion(
        btnEliminar.getAttribute('data-aut-id'),
        btnEliminar.getAttribute('data-aut-path') || null
      );
      if (ok) {
        // Recargar lista
        const nuevas = await cargarAutorizacionesPaciente(pacienteId);
        renderTarjetasAutorizaciones(container, nuevas, opciones);
      }
      return;
    }
    const btnVer = ev.target.closest('[data-aut-action="ver"]');
    if (btnVer) {
      descargarArchivo(btnVer.getAttribute('data-aut-path'));
      return;
    }
  }, { once: false });

  // Listener de cambios externos (cuando se guarda desde el modal)
  document.addEventListener('autorizacion-guardada', async (ev) => {
    if (!pacienteId || ev.detail?.pacienteId !== pacienteId) return;
    const nuevas = await cargarAutorizacionesPaciente(pacienteId);
    renderTarjetasAutorizaciones(container, nuevas, opciones);
  }, { once: true });
}

function renderTarjetaAutorizacion(a) {
  const sesionesRest = a.sesiones_restantes ?? Math.max(0, (a.sesiones_auth || 0) - (a.sesiones_usadas || 0));
  const pctUsado = a.sesiones_auth > 0
    ? Math.round((a.sesiones_usadas / a.sesiones_auth) * 100)
    : 0;

  // Color del estado
  const colorMap = {
    'Activa':       { bg: '#d1fae5', text: '#065f46', border: '#10b981' },
    'Por vencer':   { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
    'Vencida':      { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
    'Sin sesiones': { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
    'Pendiente':    { bg: '#dbeafe', text: '#1e3a8a', border: '#3b82f6' },
    'En revisión':  { bg: '#dbeafe', text: '#1e3a8a', border: '#3b82f6' },
    'Rechazada':    { bg: '#f3f4f6', text: '#6b7280', border: '#9ca3af' },
    'Pausada':      { bg: '#f3f4f6', text: '#6b7280', border: '#9ca3af' },
  };
  const color = colorMap[a.estado_calculado] || colorMap['Activa'];

  // Mensaje de alerta destacado
  let alertaTexto = '';
  if (a.estado_calculado === 'Vencida') {
    alertaTexto = `<div style="background:${color.bg};color:${color.text};padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:10px">
      ⚠️ Autorización VENCIDA hace ${Math.abs(a.dias_al_vencimiento || 0)} día${Math.abs(a.dias_al_vencimiento || 0) !== 1 ? 's' : ''}
    </div>`;
  } else if (a.estado_calculado === 'Por vencer') {
    alertaTexto = `<div style="background:${color.bg};color:${color.text};padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:10px">
      ⏰ Vence en ${a.dias_al_vencimiento} día${a.dias_al_vencimiento !== 1 ? 's' : ''} — gestionar renovación
    </div>`;
  } else if (a.estado_calculado === 'Sin sesiones') {
    alertaTexto = `<div style="background:${color.bg};color:${color.text};padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:10px">
      📊 Se agotaron las sesiones (${a.sesiones_usadas}/${a.sesiones_auth})
    </div>`;
  } else if (a.alerta_sesiones) {
    alertaTexto = `<div style="background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:10px">
      ⚠️ Quedan solo ${sesionesRest} sesion${sesionesRest !== 1 ? 'es' : ''}
    </div>`;
  }

  // Frecuencia legible
  let frecuencia = '';
  if (a.frecuencia_tipo === 'semanal' && a.frecuencia_cantidad) {
    frecuencia = `${a.frecuencia_cantidad} por semana`;
  } else if (a.frecuencia_tipo === 'mensual' && a.frecuencia_cantidad) {
    frecuencia = `${a.frecuencia_cantidad} por mes`;
  } else if (a.frecuencia_tipo === 'total') {
    frecuencia = 'Total (sin frecuencia)';
  }

  return `
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${color.border};border-radius:10px;padding:14px;margin-bottom:10px">
      ${alertaTexto}

      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--text)">${escapeHtml(a.obra_social || '—')}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">
            <strong>${escapeHtml(a.prestacion || '—')}</strong>
          </div>
          <div style="font-size:10px;color:var(--text4);margin-top:2px;font-family:var(--mono)">
            N° ${escapeHtml(a.numero || '—')}
          </div>
        </div>
        <span style="background:${color.bg};color:${color.text};padding:3px 10px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap">${escapeHtml(a.estado_calculado || a.estado || '—')}</span>
      </div>

      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:var(--bg);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Sesiones</div>
          <div style="font-size:14px;font-weight:800;color:var(--sky)">${a.sesiones_usadas || 0} / ${a.sesiones_auth || 0}</div>
          <div style="font-size:9px;color:var(--text4)">${pctUsado}% usadas</div>
        </div>
        <div style="background:var(--bg);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Frecuencia</div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${escapeHtml(frecuencia || 'Sin restricción')}</div>
        </div>
        <div style="background:var(--bg);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">Vencimiento</div>
          <div style="font-size:13px;font-weight:700;color:${a.alerta_vencimiento ? color.text : 'var(--text)'}">${escapeHtml(formatearFecha(a.fecha_vencimiento) || '—')}</div>
          ${a.dias_al_vencimiento != null
            ? `<div style="font-size:9px;color:${a.dias_al_vencimiento <= 10 ? color.text : 'var(--text4)'}">${a.dias_al_vencimiento >= 0 ? `${a.dias_al_vencimiento}d restantes` : `Venció hace ${-a.dias_al_vencimiento}d`}</div>`
            : ''}
        </div>
      </div>

      <!-- Barra de progreso -->
      <div style="background:var(--bg);border-radius:99px;height:6px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${pctUsado}%;background:${pctUsado >= 90 ? '#ef4444' : pctUsado >= 70 ? '#f59e0b' : '#10b981'};transition:width 0.3s"></div>
      </div>

      ${a.descripcion ? `<div style="font-size:11px;color:var(--text3);margin-bottom:8px;padding:6px 10px;background:var(--bg);border-radius:6px">${escapeHtml(a.descripcion)}</div>` : ''}
      ${a.profesional_nombre ? `<div style="font-size:11px;color:var(--text4);margin-bottom:8px">👤 ${escapeHtml(a.profesional_nombre)}</div>` : ''}

      <div style="display:flex;justify-content:flex-end;gap:6px;border-top:1px solid var(--border);padding-top:8px">
        ${a.archivo_path
          ? `<button class="btn btn-ghost btn-sm" data-aut-action="ver" data-aut-path="${escapeAttr(a.archivo_path)}" style="font-size:11px;padding:4px 10px">📎 Ver archivo</button>`
          : `<span style="font-size:10px;color:var(--text4);padding:4px 10px">📎 Sin archivo</span>`}
        <button class="btn btn-ghost btn-sm" data-aut-action="editar" data-aut-id="${escapeAttr(a.id)}" style="font-size:11px;padding:4px 10px">✏️ Editar</button>
        <button class="btn btn-ghost btn-sm" data-aut-action="eliminar" data-aut-id="${escapeAttr(a.id)}" data-aut-path="${escapeAttr(a.archivo_path || '')}" style="font-size:11px;padding:4px 10px;color:var(--rose)">🗑️</button>
      </div>
    </div>`;
}

// ============================================================
//  HELPERS
// ============================================================
function formatearFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
//  EXPORT GLOBAL
// ============================================================
window.AutorizacionesMod = {
  cargarAutorizacionesPaciente,
  cargarAlertasCriticas,
  abrirModalAutorizacion,
  eliminarAutorizacion,
  descargarArchivo,
  renderTarjetasAutorizaciones,
};
