// ============================================================
//  RehabMed ERP — Punto de entrada
// ============================================================
import { doLogin, doLogout, restoreSession } from './auth.js';
import { cargarAgenda, suscribirRealtime, filterAgenda } from './agenda.js';

// Exponer al HTML (onclick inline en el HTML legacy)
window.doLogin  = doLogin;
window.doLogout = doLogout;

document.addEventListener('DOMContentLoaded', async () => {
  // Intentar restaurar sesión
  const sesionActiva = await restoreSession();

  if (sesionActiva) {
    await iniciarERP();
  } else {
    const login = document.getElementById('loginScreen');
    if (login) login.style.display = 'flex';
    document.getElementById('loginUser')?.focus();
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', doLogin);
});

async function iniciarERP() {
  suscribirRealtime();
  await cargarAgenda('hoy');
  actualizarClock();
  setInterval(actualizarClock, 1000);
  console.log('[ERP] ✅ Sistema iniciado');
}

window.iniciarERP = iniciarERP;

function actualizarClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// Hook para cargar agenda al cambiar a ese módulo
const _originalShowModule = window.showModule;
window.showModule = async function (mod, el) {
  if (typeof _originalShowModule === 'function') _originalShowModule(mod, el);
  if (mod === 'agenda') {
    const activeTab = document.querySelector('#mod-agenda .tabs .tab.active');
    const view = activeTab ? activeTab.getAttribute('data-view') : 'hoy';
    await cargarAgenda(view);
  }
};

// Exponer filterAgenda por compatibilidad con inputs legacy
window.filterAgenda = filterAgenda;
