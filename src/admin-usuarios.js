// ============================================================
//  RehabMed ERP — Admin de Usuarios
//  Modal accesible desde el avatar del sidebar (solo admin).
//  Permite: listar usuarios, cambiar rol, activar/desactivar.
//  Crear usuarios sigue haciéndose desde Supabase Auth Dashboard
//  (requiere service_role y envío de magic link / password).
// ============================================================
import { supabase } from './lib/supabase.js';
import { escapeHtml, showToast } from './lib/dom.js';

const MODAL_ID = 'modalAdminUsuarios';

// ============================================================
//  RENDER del modal (se inyecta al DOM una sola vez)
// ============================================================
function crearModalSiNoExiste() {
  if (document.getElementById(MODAL_ID)) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = MODAL_ID;
  overlay.innerHTML = `
    <div class="modal" style="width:780px;max-width:95vw;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div class="modal-title">⚙️ Administración de Usuarios</div>
        <button class="modal-close" onclick="closeModal('${MODAL_ID}')">×</button>
      </div>
      <div style="background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text2);line-height:1.5">
        <strong>ℹ️ Crear nuevos usuarios:</strong> Supabase Dashboard → Authentication → Add user.
        Acá podés administrar los existentes (rol y activo).
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Activo</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody id="adminUsuariosTbody"></tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" onclick="closeModal('${MODAL_ID}')">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ============================================================
//  CARGAR lista de usuarios
// ============================================================
async function cargarUsuarios() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, nombre, iniciales, rol, activo, created_at')
    .order('created_at', { ascending: false });

  const tb = document.getElementById('adminUsuariosTbody');
  if (!tb) return;

  if (error) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--rose);padding:20px">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text4);padding:20px">Sin usuarios</td></tr>`;
    return;
  }

  tb.innerHTML = data.map(u => {
    const fecha = u.created_at
      ? new Date(u.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    return `
      <tr data-user-id="${escapeHtml(u.id)}">
        <td style="font-family:var(--mono);font-size:12px">${escapeHtml(u.email || '—')}</td>
        <td>
          <div style="font-weight:700;color:var(--text)">${escapeHtml(u.nombre)}</div>
          <div style="font-size:10px;color:var(--text4)">${escapeHtml(u.iniciales)}</div>
        </td>
        <td>
          <select class="form-select" data-cambiar-rol style="width:auto;padding:5px 10px;font-size:12px">
            <option value="admin"       ${u.rol === 'admin'       ? 'selected' : ''}>Administrador</option>
            <option value="profesional" ${u.rol === 'profesional' ? 'selected' : ''}>Profesional</option>
            <option value="recepcion"   ${u.rol === 'recepcion'   ? 'selected' : ''}>Recepción</option>
          </select>
        </td>
        <td>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" data-toggle-activo ${u.activo ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--emerald)">
            <span style="font-size:12px;color:${u.activo ? 'var(--emerald)' : 'var(--rose)'};font-weight:600">${u.activo ? 'Sí' : 'No'}</span>
          </label>
        </td>
        <td style="font-size:11px;color:var(--text4)">${escapeHtml(fecha)}</td>
      </tr>
    `;
  }).join('');

  // Event delegation para cambio de rol y activo
  tb.onchange = async (ev) => {
    const tr = ev.target.closest('[data-user-id]');
    if (!tr) return;
    const userId = tr.getAttribute('data-user-id');

    if (ev.target.matches('[data-cambiar-rol]')) {
      const nuevoRol = ev.target.value;
      await actualizarUsuario(userId, { rol: nuevoRol });
    } else if (ev.target.matches('[data-toggle-activo]')) {
      const nuevoActivo = ev.target.checked;
      await actualizarUsuario(userId, { activo: nuevoActivo });
    }
  };
}

// ============================================================
//  ACTUALIZAR usuario via función segura
// ============================================================
async function actualizarUsuario(userId, cambios) {
  const { data, error } = await supabase.rpc('admin_actualizar_usuario', {
    p_user_id: userId,
    p_rol:     cambios.rol ?? null,
    p_activo:  cambios.activo ?? null,
  });

  if (error) {
    showToast(`❌ ${error.message}`);
    console.error('[Admin]', error);
    // Recargar para revertir el cambio visual
    await cargarUsuarios();
    return;
  }

  showToast(`✅ Usuario actualizado`);
  await cargarUsuarios();
}

// ============================================================
//  ABRIR el modal (solo si admin)
// ============================================================
export async function abrirAdminUsuarios() {
  // Verificar rol
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { showToast('⚠️ Sin sesión'); return; }

  const { data: profile } = await supabase
    .from('profiles').select('rol').eq('id', user.id).single();

  if (profile?.rol !== 'admin') {
    showToast('🔒 Solo admin puede gestionar usuarios');
    return;
  }

  crearModalSiNoExiste();
  if (typeof window.openModal === 'function') window.openModal(MODAL_ID);
  await cargarUsuarios();
}

// ============================================================
//  INSTALAR: botón en el sidebar (click en la user-card)
// ============================================================
export function instalarAdminUsuarios() {
  // Agregamos un botoncito en el sidebar-footer que solo se ve si admin
  const userCard = document.querySelector('.user-card');
  if (!userCard) return;

  // Evitar duplicar si ya existe
  if (document.getElementById('btnAdminUsuarios')) return;

  const btn = document.createElement('button');
  btn.id = 'btnAdminUsuarios';
  btn.className = 'logout-btn';
  btn.style.cssText = 'background:rgba(124,58,237,0.08);color:var(--violet);border-color:rgba(124,58,237,0.25);margin-top:8px;display:none';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
    Admin Usuarios`;
  btn.onclick = abrirAdminUsuarios;

  // Insertar después del user-card
  const footer = userCard.parentElement;
  if (footer) footer.appendChild(btn);

  // Mostrar solo si el usuario es admin (consultamos el rol una vez)
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    supabase.from('profiles').select('rol').eq('id', user.id).single().then(({ data }) => {
      if (data?.rol === 'admin') btn.style.display = 'flex';
    });
  });

  window.abrirAdminUsuarios = abrirAdminUsuarios;
  console.log('[Admin] ✅ Botón admin usuarios instalado');
}
