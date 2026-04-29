// ============================================================
//  RehabMed ERP — Módulo Auth
//  Reemplaza: const USERS = [...] y doLogin() hardcodeado
// ============================================================
import { supabase } from './lib/supabase.js';

// ── Permisos por rol (igual que antes, sin cambios) ──────
export const ROLE_PERMISSIONS = {
  admin:        ['dashboard','agenda','pacientes','hclinica','profesionales','noshow','facturacion','stock','proveedores','rrhh','crm','marketing','bi','contabilidad','whatsapp','leadficha'],
  profesional:  ['dashboard','agenda','pacientes','hclinica','profesionales','noshow'],
  recepcion:    ['dashboard','agenda','pacientes','hclinica','noshow','stock','crm','whatsapp','leadficha'],
};

export const ROLE_LABELS = {
  admin:       'Administrador General',
  profesional: 'Profesional Clínico',
  recepcion:   'Recepción',
};

// ── Estado global del usuario ─────────────────────────────
export let currentUser   = null;   // objeto auth.user de Supabase
export let currentProfile = null;  // fila de public.profiles

// ============================================================
//  LOGIN con Supabase Auth (email + password)
// ============================================================
export async function doLogin(e) {
  if (e) e.preventDefault();

  const email  = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass   = document.getElementById('loginPass').value;
  const errEl  = document.getElementById('loginError');
  const btnEl  = document.getElementById('loginBtn');

  // UX: loading state
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Ingresando...'; }
  errEl.classList.remove('show');

  try {
    // 1. Autenticar con Supabase
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

    if (error || !data.user) {
      throw new Error('Credenciales incorrectas');
    }

    // 2. Cargar perfil con rol
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileErr || !profile) {
      throw new Error('Perfil no encontrado. Contactá al administrador.');
    }

    if (!profile.activo) {
      throw new Error('Tu cuenta está desactivada. Contactá al administrador.');
    }

    // 3. Guardar estado global
    currentUser    = data.user;
    currentProfile = profile;

    // 4. Actualizar sidebar
    document.getElementById('sidebarAvatar').textContent    = profile.iniciales;
    document.getElementById('sidebarUserName').textContent  = profile.nombre;
    document.getElementById('sidebarUserRole').textContent  = ROLE_LABELS[profile.rol] || profile.rol;

    // 5. Aplicar permisos de navegación
    applyRolePermissions(profile.rol);

    // 6. Mostrar ERP
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('erpWrapper').classList.add('visible');
    document.getElementById('loginPass').value = '';

    // 7. Ir al dashboard
    showModule('dashboard', null);

    console.log(`[Auth] ✅ Login exitoso — ${profile.nombre} (${profile.rol})`);

  } catch (err) {
    errEl.textContent = err.message || 'Error al ingresar';
    errEl.classList.add('show');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    console.warn('[Auth] ❌ Login fallido:', err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; }
  }
}

// ============================================================
//  LOGOUT
// ============================================================
export async function doLogout() {
  await supabase.auth.signOut();

  currentUser    = null;
  currentProfile = null;

  document.getElementById('erpWrapper').classList.remove('visible');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginUser').value  = '';
  document.getElementById('loginPass').value  = '';
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('loginUser').focus();

  // Restaurar nav items
  document.querySelectorAll('.nav-item').forEach(n => { n.style.display = ''; });

  console.log('[Auth] 👋 Sesión cerrada');
}

// ============================================================
//  RESTAURAR SESIÓN AL RECARGAR (sin volver a pedir login)
// ============================================================
export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (!profile || !profile.activo) return false;

  currentUser    = session.user;
  currentProfile = profile;

  document.getElementById('sidebarAvatar').textContent    = profile.iniciales;
  document.getElementById('sidebarUserName').textContent  = profile.nombre;
  document.getElementById('sidebarUserRole').textContent  = ROLE_LABELS[profile.rol] || profile.rol;

  applyRolePermissions(profile.rol);

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('erpWrapper').classList.add('visible');

  console.log(`[Auth] 🔄 Sesión restaurada — ${profile.nombre}`);
  return true;
}

// ============================================================
//  PERMISOS DE NAVEGACIÓN (igual que antes)
// ============================================================
export function applyRolePermissions(rol) {
  const allowed = ROLE_PERMISSIONS[rol] || [];
  document.querySelectorAll('.nav-item').forEach(n => {
    const onclick = n.getAttribute('onclick') || '';
    const match   = onclick.match(/showModule\('(\w+)'/);
    if (match) {
      n.style.display = allowed.includes(match[1]) ? '' : 'none';
    }
  });
}

// ============================================================
//  LISTENER — Cambios de sesión (token refresh, etc.)
// ============================================================
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    if (currentUser) doLogout();   // limpia UI solo si había sesión activa
  }
  if (event === 'TOKEN_REFRESHED') {
    console.log('[Auth] 🔑 Token renovado automáticamente');
  }
});
