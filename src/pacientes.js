// ============================================================
//  RehabMed ERP — Módulo Pacientes
//  Reemplaza: PACIENTES_DATA hardcoded + renderPacientes legacy
//  Sobreescribe: window.renderPacientes, window.filterPacientes, window.showHCL
//  Provee:       window.PacientesMod = { ... }
// ============================================================
import { supabase } from './lib/supabase.js';

// ── Estado del módulo ─────────────────────────────────────
let _pacientes        = [];     // cache local, shape mapeado al HTML legacy
let _realtimeChannel  = null;
let _searchQuery      = '';

// ============================================================
//  MAPPER — fila de Supabase → shape esperado por el HTML
//  El HTML usa nombres abreviados; mantenemos compatibilidad
//  hasta refactorizar el HTML completo.
// ============================================================
function mapRow(row) {
  return {
    // Identidad
    id:        row.id,                                // UUID (string)
    ref:       row.ref,
    nombre:    row.nombre,
    dni:       row.dni,
    telefono:  row.telefono || '',
    email:     row.email || '',
    fecha_nacimiento: row.fecha_nacimiento || null,

    // Aliases para compatibilidad con render legacy del HTML
    cob:       row.cobertura,
    diag:      row.diagnostico || '—',
    est:       row.estado,
    score:     row.score_noshow,
    deuda:     parseFloat(row.deuda || 0),

    // Campos derivados — TODO: calcular con vista SQL `v_pacientes_extended`
    ses:       0,        // sesiones realizadas (turnos en estado Finalizado)
    prox:      '—',      // próximo turno

    // Extras
    numero_afiliado: row.numero_afiliado || '',
    notas:     row.notas || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================
//  CARGAR PACIENTES DESDE SUPABASE
// ============================================================
export async function cargarPacientes() {
  const { data, error } = await supabase
    .from('pacientes')
    .select('*')
    .order('nombre', { ascending: true });

  if (error) {
    console.error('[Pacientes] ❌ Error al cargar:', error.message);
    if (typeof showToast === 'function') showToast('❌ Error al cargar pacientes');
    return [];
  }

  _pacientes = (data || []).map(mapRow);

  // Calcular sesiones y próximo turno desde el cache de agenda (si existe)
  enriquecerConTurnos();

  // Mantener PACIENTES_DATA del HTML sincronizado para código legacy
  if (typeof window !== 'undefined') {
    window.PACIENTES_DATA = _pacientes;
  }

  renderPacientesLista(_pacientes);
  console.log(`[Pacientes] ✅ ${_pacientes.length} pacientes cargados`);
  return _pacientes;
}

// ============================================================
//  ENRIQUECER con turnos (sesiones realizadas + próximo)
//  Usa la cache de window.AgendaMod si está disponible.
//  Si no, queda con valores por defecto.
// ============================================================
function enriquecerConTurnos() {
  // Acceder al cache de agenda si está cargado
  // (agenda.js no expone _agendaData; lo derivamos del DOM o lo dejamos en —)
  // TODO: exponer cache de agenda o crear vista SQL v_pacientes_extended.
  // Por ahora dejamos los defaults — se mejora en P2.
}

// ============================================================
//  CREAR PACIENTE
// ============================================================
export async function crearPaciente(datos) {
  // Generar referencia PAC-AAAA-NNNN
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from('pacientes')
    .select('*', { count: 'exact', head: true })
    .like('ref', `PAC-${year}-%`);
  const nextNum = String((count || 0) + 1).padStart(4, '0');
  const ref = `PAC-${year}-${nextNum}`;

  const { data, error } = await supabase
    .from('pacientes')
    .insert([{
      ref,
      nombre:           datos.nombre,
      dni:              datos.dni,
      telefono:         datos.telefono || null,
      email:            datos.email || null,
      fecha_nacimiento: datos.fecha_nacimiento || null,
      cobertura:        datos.cobertura || 'Particular',
      numero_afiliado:  datos.numero_afiliado || null,
      diagnostico:      datos.diagnostico || null,
      estado:           datos.estado || 'Nuevo',
      notas:            datos.notas || null,
    }])
    .select()
    .single();

  if (error) {
    console.error('[Pacientes] ❌ Error al crear:', error.message);
    if (typeof showToast === 'function') showToast('❌ Error al crear paciente: ' + error.message);
    return null;
  }

  if (typeof showToast === 'function') showToast(`✅ Paciente creado: ${ref}`);
  // Realtime INSERT actualiza el cache automáticamente
  return mapRow(data);
}

// ============================================================
//  ACTUALIZAR PACIENTE
// ============================================================
export async function actualizarPaciente(id, cambios) {
  // Convertir aliases del HTML al schema real
  const updates = {};
  if (cambios.nombre        !== undefined) updates.nombre        = cambios.nombre;
  if (cambios.dni           !== undefined) updates.dni           = cambios.dni;
  if (cambios.telefono      !== undefined) updates.telefono      = cambios.telefono;
  if (cambios.email         !== undefined) updates.email         = cambios.email;
  if (cambios.cobertura     !== undefined) updates.cobertura     = cambios.cobertura;
  if (cambios.cob           !== undefined) updates.cobertura     = cambios.cob;
  if (cambios.diagnostico   !== undefined) updates.diagnostico   = cambios.diagnostico;
  if (cambios.diag          !== undefined) updates.diagnostico   = cambios.diag;
  if (cambios.estado        !== undefined) updates.estado        = cambios.estado;
  if (cambios.est           !== undefined) updates.estado        = cambios.est;
  if (cambios.deuda         !== undefined) updates.deuda         = cambios.deuda;
  if (cambios.notas         !== undefined) updates.notas         = cambios.notas;
  if (cambios.numero_afiliado !== undefined) updates.numero_afiliado = cambios.numero_afiliado;
  if (cambios.fecha_nacimiento !== undefined) updates.fecha_nacimiento = cambios.fecha_nacimiento;

  const { data, error } = await supabase
    .from('pacientes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[Pacientes] ❌ Error al actualizar:', error.message);
    if (typeof showToast === 'function') showToast('❌ No se pudo actualizar el paciente');
    return null;
  }

  if (typeof showToast === 'function') showToast(`✅ ${data.nombre} actualizado`);
  return mapRow(data);
}

// ============================================================
//  GET PACIENTE (single)
// ============================================================
export async function getPaciente(id) {
  // Primero buscar en cache
  const cached = _pacientes.find(p => p.id === id);
  if (cached) return cached;

  // Si no está en cache, ir a la DB
  const { data, error } = await supabase
    .from('pacientes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[Pacientes] ❌ Error al obtener:', error.message);
    return null;
  }
  return mapRow(data);
}

// ============================================================
//  ELIMINAR PACIENTE (admin only — RLS lo enforce)
// ============================================================
export async function eliminarPaciente(id) {
  const { error } = await supabase
    .from('pacientes')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Pacientes] ❌ Error al eliminar:', error.message);
    if (typeof showToast === 'function') showToast('❌ No se pudo eliminar (¿tiene turnos asociados?)');
    return false;
  }
  if (typeof showToast === 'function') showToast('🗑️ Paciente eliminado');
  return true;
}

// ============================================================
//  FILTRAR (búsqueda local sobre cache)
// ============================================================
export function filterPacientes(q) {
  _searchQuery = q || '';
  const ql = _searchQuery.toLowerCase();
  const filtrados = _pacientes.filter(p =>
    !ql ||
    (p.nombre || '').toLowerCase().includes(ql) ||
    (p.dni    || '').includes(_searchQuery) ||
    (p.ref    || '').toLowerCase().includes(ql) ||
    (p.cob    || '').toLowerCase().includes(ql) ||
    (p.diag   || '').toLowerCase().includes(ql)
  );
  renderPacientesLista(filtrados);
}

// ============================================================
//  SUSCRIPCIÓN REALTIME — INSERT/UPDATE/DELETE
// ============================================================
export function suscribirRealtimePacientes() {
  if (_realtimeChannel) supabase.removeChannel(_realtimeChannel);

  _realtimeChannel = supabase
    .channel('pacientes-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pacientes' },
      (payload) => {
        const { eventType, new: nuevo, old: viejo } = payload;
        console.log('[Realtime] 📡 Cambio en pacientes:', eventType);

        if (eventType === 'INSERT') {
          _pacientes.push(mapRow(nuevo));
          _pacientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        } else if (eventType === 'UPDATE') {
          const idx = _pacientes.findIndex(p => p.id === nuevo.id);
          if (idx !== -1) _pacientes[idx] = mapRow(nuevo);
        } else if (eventType === 'DELETE') {
          _pacientes = _pacientes.filter(p => p.id !== viejo.id);
        }

        if (typeof window !== 'undefined') window.PACIENTES_DATA = _pacientes;
        renderPacientesLista(_pacientes);
      }
    )
    .subscribe((status) => {
      console.log('[Pacientes] Realtime:', status);
    });
}

// ============================================================
//  RENDER (sobreescribe el del HTML legacy)
//  Mantiene la misma estructura visual, pero pasa UUIDs
//  entre comillas para los onclicks.
// ============================================================
function renderPacientesLista(data) {
  const tb = document.getElementById('pacientesTbody');
  if (!tb) return;

  if (data.length === 0) {
    tb.innerHTML = `
      <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text4)">
        <div style="font-size:32px;margin-bottom:8px">👥</div>
        <div style="font-weight:700;color:var(--text3)">${_searchQuery ? 'Sin resultados para tu búsqueda' : 'Sin pacientes registrados'}</div>
        <div style="font-size:12px;margin-top:4px">${_searchQuery ? 'Probá con otro término' : 'Creá el primer paciente con el botón superior'}</div>
      </td></tr>`;
    return;
  }

  tb.innerHTML = data.map(p => {
    const scoreColor = p.score > 90 ? 'var(--emerald)' : p.score > 70 ? 'var(--amber)' : 'var(--rose)';
    const scorePct   = p.score + '%';
    const initials   = (p.nombre || '??').split(' ').map(w => w[0]).slice(0, 2).join('');
    const badgeFn    = (typeof badgeClass === 'function') ? badgeClass : () => '';
    const idQ        = `'${p.id}'`;     // UUID entre comillas para onclicks
    const nombreEsc  = (p.nombre || '').replace(/'/g, "\\'");

    return `
    <tr class="interactive-row">
      <td onclick="window.PacientesMod.showHCL(${idQ})" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar avatar-sm">${initials}</div>
          <div>
            <span style="font-weight:700;color:var(--sky);text-decoration:underline dotted;text-underline-offset:3px">${p.nombre}</span>
            <div style="font-size:10px;color:var(--text4);font-family:var(--mono)">${p.ref}</div>
          </div>
        </div>
      </td>
      <td style="color:var(--text4);font-family:var(--mono)">${p.dni}</td>
      <td style="font-size:12px">${p.cob}</td>
      <td style="font-size:12px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.diag}</td>
      <td style="font-weight:800;color:var(--sky2);text-align:center">${p.ses}</td>
      <td style="font-size:12px;white-space:nowrap">${p.prox}</td>
      <td><span class="badge ${badgeFn(p.est)}">${p.est}</span></td>
      <td>
        <div class="progress-wrap" style="min-width:80px">
          <div class="progress-bar"><div class="progress-fill" style="width:${scorePct};background:${scoreColor}"></div></div>
          <span style="font-size:11px;font-weight:700;color:${scoreColor}">${p.score}</span>
        </div>
      </td>
      <td style="font-weight:700;color:${p.deuda > 0 ? 'var(--rose)' : 'var(--emerald)'}">${p.deuda > 0 ? '$' + p.deuda.toLocaleString('es-AR') : 'Al día'}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="window.PacientesMod.showHCL(${idQ})">HCl</button>
          <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:4px 6px" onclick="window.PacientesMod.whatsapp(${idQ})" title="WhatsApp">📲</button>
          <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:4px 6px" onclick="window.PacientesMod.quickAgendar(${idQ})" title="Agendar turno">📅</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
//  SHOW HCL (Historia Clínica) — abre la ficha del paciente
//  Sobreescribe la del HTML legacy.
// ============================================================
export async function showHCL(id) {
  const p = await getPaciente(id);
  if (!p) {
    if (typeof showToast === 'function') showToast('❌ Paciente no encontrado');
    return;
  }

  // Estado global usado por el HCL legacy
  if (typeof window !== 'undefined') {
    window._currentHCLPacId = id;
  }

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  setText('hcl-paciente-nombre', p.nombre);
  setText('hcl-paciente-meta',
    `${p.ref} · ${p.cob} · DNI ${p.dni} · ${p.ses} sesiones realizadas`);

  const badgeFn = (typeof badgeClass === 'function') ? badgeClass : () => '';
  const scoreColor = p.score > 90 ? 'var(--emerald)' : p.score > 70 ? 'var(--amber)' : 'var(--rose)';

  setHTML('hcl-datos', `
    <div class="stat-row"><span class="stat-row-label">Nº Ref. Sistema</span><span class="stat-row-val" style="color:var(--sky);font-family:var(--mono)">${p.ref}</span></div>
    <div class="stat-row"><span class="stat-row-label">DNI</span><span class="stat-row-val" style="color:var(--text2)">${p.dni}</span></div>
    <div class="stat-row"><span class="stat-row-label">Teléfono</span><span class="stat-row-val" style="color:var(--text2)">${p.telefono || '—'}</span></div>
    <div class="stat-row"><span class="stat-row-label">Email</span><span class="stat-row-val" style="color:var(--text2)">${p.email || '—'}</span></div>
    <div class="stat-row"><span class="stat-row-label">Cobertura</span><span class="stat-row-val" style="color:var(--sky2)">${p.cob}</span></div>
    <div class="stat-row"><span class="stat-row-label">Nº Afiliado</span><span class="stat-row-val" style="color:var(--text2);font-family:var(--mono)">${p.numero_afiliado || '—'}</span></div>
    <div class="stat-row"><span class="stat-row-label">Diagnóstico</span><span class="stat-row-val" style="color:var(--text2);font-size:13px">${p.diag}</span></div>
    <div class="stat-row"><span class="stat-row-label">Estado</span><span class="badge ${badgeFn(p.est)}">${p.est}</span></div>
    <div class="stat-row"><span class="stat-row-label">Score No-Show</span><span class="stat-row-val" style="color:${scoreColor}">${p.score}/100</span></div>
    <div class="stat-row"><span class="stat-row-label">Deuda</span><span class="stat-row-val" style="color:${p.deuda > 0 ? 'var(--rose)' : 'var(--emerald)'}">${p.deuda > 0 ? '$' + p.deuda.toLocaleString('es-AR') : 'Sin deuda'}</span></div>
  `);

  // Mostrar el módulo HCL si la función legacy existe
  if (typeof window.showModule === 'function') {
    window.showModule('hclinica', null);
  }
}

// ============================================================
//  ACCIONES RÁPIDAS
// ============================================================
function whatsapp(id) {
  const p = _pacientes.find(x => x.id === id);
  if (!p) return;
  if (!p.telefono) {
    if (typeof showToast === 'function') showToast('⚠️ El paciente no tiene teléfono cargado');
    return;
  }
  // Limpiar teléfono y armar link wa.me
  const telLimpio = p.telefono.replace(/\D/g, '');
  const msg = encodeURIComponent(`Hola ${p.nombre.split(' ')[0]}, te escribimos de RehabMed.`);
  window.open(`https://wa.me/${telLimpio}?text=${msg}`, '_blank');
}

function quickAgendar(id) {
  const p = _pacientes.find(x => x.id === id);
  if (!p) return;
  if (typeof window.openModal === 'function') {
    window.openModal('modalNuevoTurno');
  }
  // Pre-cargar el select de pacientes
  setTimeout(() => {
    const sel = document.getElementById('turnoPac');
    if (sel) {
      let opt = Array.from(sel.options).find(o => o.value === p.id);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.nombre} (${p.ref})`;
        sel.appendChild(opt);
      }
      sel.value = p.id;
    }
    if (typeof showToast === 'function') showToast(`📅 Agendando turno para ${p.nombre}`);
  }, 200);
}

// ============================================================
//  EXPORT GLOBAL
// ============================================================
window.PacientesMod = {
  cargarPacientes,
  filterPacientes,
  crearPaciente,
  actualizarPaciente,
  getPaciente,
  eliminarPaciente,
  showHCL,
  whatsapp,
  quickAgendar,
  suscribirRealtimePacientes,
  // Acceso a la cache (read-only para legacy)
  get cache() { return _pacientes; },
};

// Sobreescribir las funciones globales del HTML legacy
window.renderPacientes = renderPacientesLista;
window.filterPacientes = filterPacientes;
window.showHCL         = showHCL;

// ============================================================
//  WRAPPERS para el modal "Nuevo/Editar Paciente" del HTML
//  Reemplazan: guardarNuevoPaciente, guardarEdicionPaciente, editarPaciente
// ============================================================
function getModalVal(id) {
  const el = document.getElementById(id);
  return el ? (el.value || '').trim() : '';
}

window.guardarNuevoPaciente = async function() {
  const nombre   = getModalVal('pacNombre');
  const apellido = getModalVal('pacApellido');
  const dni      = getModalVal('pacDNI');

  if (!nombre || !apellido) {
    if (typeof showToast === 'function') showToast('⚠️ Nombre y Apellido son obligatorios');
    return;
  }
  if (!dni) {
    if (typeof showToast === 'function') showToast('⚠️ DNI es obligatorio');
    return;
  }

  const datos = {
    nombre:           `${nombre} ${apellido}`,
    dni,
    telefono:         getModalVal('pacTel') || null,
    email:            getModalVal('pacEmail') || null,
    fecha_nacimiento: getModalVal('pacFechaNac') || null,
    cobertura:        getModalVal('pacCob') || 'Particular',
    numero_afiliado:  getModalVal('pacAfiliado') || null,
    diagnostico:      getModalVal('pacDiag') || getModalVal('pacMotivo') || null,
    estado:           'Nuevo',
    notas:            getModalVal('pacObs') || null,
  };

  const creado = await crearPaciente(datos);
  if (!creado) return;     // toast de error ya lo emitió crearPaciente

  if (typeof closeModal === 'function') closeModal('modalNuevoPaciente');
  if (typeof resetModalPacienteMode === 'function') resetModalPacienteMode();

  // Limpiar form
  ['pacNombre','pacApellido','pacDNI','pacDiag','pacMotivo','pacTel','pacEmail',
   'pacFechaNac','pacAfiliado','pacObs']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Realtime se encarga del refresh visual
};

window.guardarEdicionPaciente = async function() {
  const id = window._editandoPacienteId;
  if (!id) {
    if (typeof showToast === 'function') showToast('⚠️ No hay paciente en edición');
    return;
  }

  const nombre   = getModalVal('pacNombre');
  const apellido = getModalVal('pacApellido');
  if (!nombre || !apellido) {
    if (typeof showToast === 'function') showToast('⚠️ Nombre y Apellido son obligatorios');
    return;
  }

  const cambios = {
    nombre:           `${nombre} ${apellido}`,
    dni:              getModalVal('pacDNI') || undefined,
    telefono:         getModalVal('pacTel') || null,
    email:            getModalVal('pacEmail') || null,
    fecha_nacimiento: getModalVal('pacFechaNac') || null,
    cobertura:        getModalVal('pacCob') || undefined,
    numero_afiliado:  getModalVal('pacAfiliado') || null,
    diagnostico:      getModalVal('pacDiag') || getModalVal('pacMotivo') || null,
    notas:            getModalVal('pacObs') || null,
  };

  const ok = await actualizarPaciente(id, cambios);
  if (!ok) return;

  if (typeof closeModal === 'function') closeModal('modalNuevoPaciente');
  if (typeof resetModalPacienteMode === 'function') resetModalPacienteMode();
  window._editandoPacienteId = null;
};

window.editarPaciente = async function(id) {
  const p = await getPaciente(id);
  if (!p) {
    if (typeof showToast === 'function') showToast('❌ Paciente no encontrado');
    return;
  }
  window._editandoPacienteId = id;

  // Pre-cargar el modal con los datos actuales
  const partes = (p.nombre || '').split(' ');
  const setVal = (fieldId, v) => { const el = document.getElementById(fieldId); if (el) el.value = v || ''; };

  setVal('pacNombre',   partes[0] || '');
  setVal('pacApellido', partes.slice(1).join(' '));
  setVal('pacDNI',      p.dni);
  setVal('pacTel',      p.telefono);
  setVal('pacEmail',    p.email);
  setVal('pacFechaNac', p.fecha_nacimiento);
  setVal('pacCob',      p.cob);
  setVal('pacAfiliado', p.numero_afiliado);
  setVal('pacDiag',     p.diag);
  setVal('pacObs',      p.notas);

  // Cambiar título del modal a modo edición
  const title = document.getElementById('modalPacienteTitle');
  if (title) title.textContent = `✏️ Editar Paciente — ${p.nombre}`;
  const btn   = document.getElementById('btnGuardarPaciente');
  if (btn) btn.textContent = 'Guardar Cambios';

  if (typeof openModal === 'function') openModal('modalNuevoPaciente');
};
