// ============================================================
//  RehabMed ERP — Módulo Auth (Supabase)
// ============================================================
import { supabase } from './lib/supabase.js';
import { formatSupabaseError } from './lib/errors.js';

export const ROLE_PERMISSIONS = {
  admin:       ['dashboard','agenda','pacientes','hclinica','profesionales','noshow','facturacion','stock','proveedores','rrhh','crm','marketing','bi','contabilidad','whatsapp','leadficha'],
  profesional: ['dashboard','agenda','pacientes','hclinica','profesionales','noshow'],
  recepcion:   ['dashboard','agenda','pacientes','hclinica','noshow','stock','crm','whatsapp','leadficha'],
};

export const ROLE_LABELS = {
  admin:       'Administrador General',
  profesional: 'Profesional Clínico',
  recepcion:   'Recepción',
};

export let currentUser    = null;
export let currentProfile = null;

// ============================================================
//  LOGIN
// ============================================================
export async function doLogin(e) {
  if (e) e.preventDefault();

  const email = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btnEl = document.getElementById('loginBtn');

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Ingresando...'; }
  errEl?.classList.remove('show');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      console.warn('[Auth] login rechazado:', error);
      throw error;       // será formateado en el catch de abajo
    }
    if (!data.user) throw new Error('No se pudo iniciar sesión. Reintentá.');

    const { data: profile, error: profileErr } = await supabase
      .from('profiles').select('*').eq('id', data.user.id).single();

    if (profileErr || !profile) throw new Error('Tu cuenta no tiene perfil asignado. Pedile a un admin que te active.');
    if (!profile.activo)        throw new Error('Tu cuenta está desactivada. Contactá a un admin para reactivarla.');

    currentUser    = data.user;
    currentProfile = profile;

    aplicarUIPerfil(profile);
    applyRolePermissions(profile.rol);

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('erpWrapper').classList.add('visible');
    document.getElementById('loginPass').value = '';

    if (typeof window.showModule === 'function') window.showModule('dashboard', null);
    if (typeof window.iniciarERP === 'function') await window.iniciarERP();

    console.log(`[Auth] ✅ ${profile.nombre} (${profile.rol})`);
  } catch (err) {
    // Si vino de Supabase Auth, lo formateamos. Si es uno nuestro, ya tiene mensaje humano.
    const mensaje = err?.code || err?.error_code
      ? formatSupabaseError(err, 'sesión')
      : (err?.message || 'No se pudo iniciar sesión. Reintentá.');

    if (errEl) {
      errEl.textContent = mensaje;
      errEl.classList.add('show');
    }
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    console.warn('[Auth] ❌', err);
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
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'flex';
  const u = document.getElementById('loginUser'); if (u) u.value = '';
  const p = document.getElementById('loginPass'); if (p) p.value = '';
  document.getElementById('loginError')?.classList.remove('show');
  u?.focus();

  document.querySelectorAll('.nav-item').forEach(n => { n.style.display = ''; });
  console.log('[Auth] 👋 Sesión cerrada');
}

// ============================================================
//  RESTAURAR SESIÓN
// ============================================================
export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', session.user.id).single();
  if (!profile || !profile.activo) return false;

  currentUser    = session.user;
  currentProfile = profile;

  aplicarUIPerfil(profile);
  applyRolePermissions(profile.rol);

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('erpWrapper').classList.add('visible');
  console.log(`[Auth] 🔄 Sesión restaurada — ${profile.nombre}`);
  return true;
}

function aplicarUIPerfil(profile) {
  const avatar = document.getElementById('sidebarAvatar');
  const name   = document.getElementById('sidebarUserName');
  const role   = document.getElementById('sidebarUserRole');
  if (avatar) avatar.textContent = profile.iniciales;
  if (name)   name.textContent   = profile.nombre;
  if (role)   role.textContent   = ROLE_LABELS[profile.rol] || profile.rol;
}

// ============================================================
//  PERMISOS DE NAVEGACIÓN
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
//  CAMBIO DE SESIÓN
// ============================================================
supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_OUT' || !session) && currentUser) {
    doLogout();
  }
  if (event === 'TOKEN_REFRESHED') {
    console.log('[Auth] 🔑 Token renovado');
  }
});
