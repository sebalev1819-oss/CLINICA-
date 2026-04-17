// ============================================================
//  RehabMed ERP — Consolidación del sidebar
//
//  Junta módulos relacionados bajo un solo item con tabs:
//    📊 Contabilidad & BI     → tabs: Contabilidad / BI & Analytics
//    📢 Marketing & CRM       → tabs: Marketing / CRM & Ventas
//
//  Oculta los 4 items originales y agrega 2 nuevos consolidados.
// ============================================================

const GRUPOS = [
  {
    id:         'contab-bi',
    icon:       '📊',
    label:      'Contabilidad & BI',
    section:    'ESTRATÉGICO',
    modulos: [
      { mod: 'contabilidad', label: 'Contabilidad' },
      { mod: 'bi',           label: 'BI & Analytics' },
    ],
  },
  {
    id:      'mkt-crm',
    icon:    '📢',
    label:   'Marketing & CRM',
    section: 'ESTRATÉGICO',
    modulos: [
      { mod: 'marketing', label: 'Marketing' },
      { mod: 'crm',       label: 'CRM & Ventas' },
    ],
  },
];

// ============================================================
//  Ocultar los items originales del sidebar
// ============================================================
function ocultarItemsOriginales() {
  const mods = GRUPOS.flatMap(g => g.modulos.map(m => m.mod));
  document.querySelectorAll('.nav-item').forEach(n => {
    const onclick = n.getAttribute('onclick') || '';
    const match = onclick.match(/showModule\('(\w+)'/);
    if (match && mods.includes(match[1])) {
      n.style.display = 'none';
      n.setAttribute('data-consolidado-oculto', 'true');
    }
  });
}

// ============================================================
//  Agregar los items consolidados al sidebar
// ============================================================
function agregarItemsConsolidados() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  GRUPOS.forEach(g => {
    if (document.querySelector(`[data-consolidado="${g.id}"]`)) return;

    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.setAttribute('data-consolidado', g.id);
    btn.setAttribute('onclick', `showModule('${g.modulos[0].mod}', this)`);
    btn.innerHTML = `<span style="font-size:14px">${g.icon}</span> ${g.label}`;

    // Inserto el item justo antes del primer item oculto del grupo
    // para mantener el orden visual
    const primerOriginal = document.querySelector(`[onclick*="showModule('${g.modulos[0].mod}'"]`);
    if (primerOriginal?.parentElement === nav) {
      nav.insertBefore(btn, primerOriginal);
    } else {
      nav.appendChild(btn);
    }
  });
}

// ============================================================
//  Inyectar tabs en los módulos agrupados
//  Cuando el usuario abre uno de los 4 módulos, se ven las tabs
//  arriba para saltar al hermano sin volver al sidebar
// ============================================================
function inyectarTabs(mod) {
  const grupo = GRUPOS.find(g => g.modulos.some(m => m.mod === mod));
  if (!grupo) return;

  const modEl = document.getElementById('mod-' + mod);
  if (!modEl) return;

  // Si ya tiene tabs inyectadas, actualizar active y salir
  let tabsExistente = modEl.querySelector('.tabs-consolidado');
  if (tabsExistente) {
    tabsExistente.querySelectorAll('[data-mod-tab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-mod-tab') === mod);
    });
    return;
  }

  // Crear tab bar y ponerlo al inicio del módulo
  const tabBar = document.createElement('div');
  tabBar.className = 'tabs tabs-consolidado';
  tabBar.style.cssText = 'margin-bottom:20px;display:inline-flex';
  tabBar.innerHTML = grupo.modulos.map(m => `
    <button class="tab ${m.mod === mod ? 'active' : ''}" data-mod-tab="${m.mod}">
      ${grupo.icon} ${m.label}
    </button>
  `).join('');

  tabBar.onclick = (ev) => {
    const btn = ev.target.closest('[data-mod-tab]');
    if (btn) {
      const targetMod = btn.getAttribute('data-mod-tab');
      if (typeof window.showModule === 'function') window.showModule(targetMod, null);
    }
  };

  modEl.insertBefore(tabBar, modEl.firstChild);
}

// ============================================================
//  Hook: resaltar el item consolidado activo cuando uno de
//  sus módulos hijos está visible (y no los originales ocultos)
// ============================================================
function resaltarConsolidadoActivo(mod) {
  // Quitar active de todos los consolidados
  document.querySelectorAll('[data-consolidado]').forEach(b => b.classList.remove('active'));

  // Marcar el grupo correspondiente
  const grupo = GRUPOS.find(g => g.modulos.some(m => m.mod === mod));
  if (grupo) {
    const btn = document.querySelector(`[data-consolidado="${grupo.id}"]`);
    if (btn) btn.classList.add('active');
  }
}

// ============================================================
//  INSTALAR
//  Se llama post-login tras aplicar role permissions
// ============================================================
export function instalarConsolidacionSidebar() {
  ocultarItemsOriginales();
  agregarItemsConsolidados();

  // Hook sobre showModule para inyectar tabs y resaltar el item consolidado
  const _orig = window.showModule;
  window.showModule = function (mod, el) {
    if (typeof _orig === 'function') _orig(mod, el);
    setTimeout(() => {
      inyectarTabs(mod);
      resaltarConsolidadoActivo(mod);
    }, 10);
  };

  console.log('[Sidebar] ✅ Consolidación aplicada (Contabilidad+BI, Marketing+CRM)');
}
