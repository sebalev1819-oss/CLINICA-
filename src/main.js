// ============================================================
//  RehabMed ERP — Punto de entrada principal
//  Reemplaza: el bloque <script> inline del HTML
//  Importar en el HTML como: <script type="module" src="src/main.js">
// ============================================================
import { doLogin, doLogout, restoreSession } from './auth.js';
import { cargarAgenda, suscribirRealtime, filterAgenda } from './agenda.js';
import { cargarPacientes, suscribirRealtimePacientes } from './pacientes.js';
import { suscribirRealtimeEvoluciones, cargarEvolucionesPaciente } from './evoluciones.js';
import { suscribirRealtimeAutorizaciones, cargarCriticas, cargarParaHCl as cargarAutorizacionesParaHCl } from './autorizaciones.js';
import { cargarDashboard, suscribirRealtimeDashboard, startAutoRefresh as startDashboardAutoRefresh } from './dashboard.js';
import { supabase } from './lib/supabase.js';

// ── Exponer funciones al HTML (onclick, etc.) ─────────────
// Las funciones que el HTML llama inline necesitan ser globales
window.doLogin   = doLogin;
window.doLogout  = doLogout;

// ============================================================
//  INIT — Al cargar la página
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {

  // 1. Intentar restaurar sesión existente
  const sesionActiva = await restoreSession();

  if (sesionActiva) {
    // Vino con sesión → arrancar directo
    await iniciarERP();
  } else {
    // Sin sesión → mostrar login
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginUser').focus();
  }

  // 2. Enter en el form de login
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', doLogin);
  }
});

// ============================================================
//  INICIAR ERP (después del login exitoso)
// ============================================================
async function iniciarERP() {
  // Conectar Realtime de todos los módulos
  suscribirRealtime();
  suscribirRealtimePacientes();
  suscribirRealtimeEvoluciones();
  suscribirRealtimeAutorizaciones();
  suscribirRealtimeDashboard();
  startDashboardAutoRefresh();

  // Cargar datos en paralelo
  await Promise.all([
    cargarAgenda('hoy'),
    cargarPacientes(),
    cargarCriticas(),     // alertas globales de autorizaciones
    cargarDashboard(),    // KPIs + charts del panel principal
  ]);

  // Iniciar reloj
  actualizarClock();
  setInterval(actualizarClock, 1000);

  // Auto-liberar consultorios cuya limpieza venció (P2.3)
  // Llama una vez al arranque y después cada 60s.
  // En producción con pg_cron habilitado, esto es redundante pero inocuo.
  liberarConsultoriosExpirados();
  setInterval(liberarConsultoriosExpirados, 60_000);

  console.log('[ERP] ✅ Sistema iniciado');
}

// ============================================================
//  AUTO-LIBERAR CONSULTORIOS — P2.3
//  Llama a la función SQL public.liberar_consultorios_expirados()
//  que cambia los consultorios con limpieza vencida a 'libre'.
//  Realtime hace que la UI se actualice automáticamente.
// ============================================================
async function liberarConsultoriosExpirados() {
  try {
    const { data, error } = await supabase.rpc('liberar_consultorios_expirados');
    if (error) {
      console.warn('[Consultorios] No se pudo liberar:', error.message);
      return;
    }
    if (data && data > 0) {
      console.log(`[Consultorios] 🧹 ${data} consultorio(s) liberado(s) tras limpieza`);
    }
  } catch (e) {
    console.warn('[Consultorios] Error inesperado:', e.message);
  }
}

// Exponer iniciarERP para que auth.js lo llame al hacer login
window.iniciarERP = iniciarERP;

// ============================================================
//  RELOJ (sidebar)
// ============================================================
function actualizarClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('es-AR', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ============================================================
//  INTEGRACIÓN: showModule llama a cargarAgenda al abrir agenda
// ============================================================
const _originalShowModule = window.showModule;
window.showModule = async function(mod, el) {
  if (typeof _originalShowModule === 'function') {
    _originalShowModule(mod, el);
  }
  if (mod === 'agenda') {
    const activeTab = document.querySelector('#mod-agenda .tabs .tab.active');
    const view = activeTab ? activeTab.getAttribute('data-view') : 'hoy';
    await cargarAgenda(view);
  }
  if (mod === 'pacientes') {
    await cargarPacientes();
  }
  if (mod === 'dashboard') {
    await cargarDashboard();
  }
  if (mod === 'hclinica') {
    // Al abrir HCl: cargar evoluciones + autorizaciones del paciente activo
    const pid = window._currentHCLPacId;
    if (pid) {
      await Promise.all([
        cargarEvolucionesPaciente(pid),
        cargarAutorizacionesParaHCl(pid),
      ]);
    }
  }
};

// ============================================================
//  HOOK adicional: cuando showHCL marca un paciente activo,
//  disparamos la carga de su historia clínica enriquecida.
//  pacientes.showHCL ya llama a window.showModule('hclinica')
//  arriba, así que este hook se dispara automáticamente.
// ============================================================
const _originalShowHCL = window.showHCL;
window.showHCL = async function(id) {
  if (typeof _originalShowHCL === 'function') {
    await _originalShowHCL(id);
  }
  // _currentHCLPacId ya quedó seteado por pacientes.showHCL
  // El window.showModule('hclinica') arriba lo dispara, pero
  // si llaman showHCL directamente, garantizamos la carga acá:
  const pid = window._currentHCLPacId;
  if (pid) {
    cargarEvolucionesPaciente(pid);
    cargarAutorizacionesParaHCl(pid);
  }
};
