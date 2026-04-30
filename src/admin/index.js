// ============================================================
//  RehabMed ERP — Módulos administrativos
//  Orquestador: agrega items al sidebar y conecta los módulos
//  (config, facturacion, caja, liquidaciones, stock) al showModule.
// ============================================================
import { renderConfig } from './config.js';
import { renderFacturacion } from './facturacion.js';
import { renderCaja } from './caja.js';
import { renderLiquidaciones } from './liquidaciones.js';
import { renderStock } from './stock.js';
import { supabase } from '../lib/supabase.js';

// ============================================================
//  Crear / encontrar el contenedor de un módulo dinámico
//  Si no existe, lo agrega al <div id="content">
// ============================================================
function ensureModuleContainer(modId) {
  let mod = document.getElementById('mod-' + modId);
  if (!mod) {
    mod = document.createElement('div');
    mod.className = 'module';
    mod.id = 'mod-' + modId;
    mod.innerHTML = `<div id="${modId}-root"></div>`;
    const content = document.getElementById('content');
    if (content) content.appendChild(mod);
  }
  return mod;
}

// ============================================================
//  Agregar items al sidebar (solo admin/recepcion ve la sección)
// ============================================================
function agregarSidebar() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  // Si ya está instalado, salir
  if (document.querySelector('[data-admin-section]')) return;

  const rol = window.__profileRol;

  // Nueva sección en sidebar
  const seccion = document.createElement('div');
  seccion.className = 'nav-section';
  seccion.setAttribute('data-admin-section', '');
  seccion.textContent = 'Administración';

  const items = [
    { mod: 'config',         label: 'Configuración',   icon: '⚙️', roles: ['admin'] },
    { mod: 'facturacion',    label: 'Facturación',     icon: '💰', roles: ['admin','recepcion'] },
    { mod: 'caja',           label: 'Caja',            icon: '💼', roles: ['admin','recepcion'] },
    { mod: 'liquidaciones',  label: 'Liquidaciones',   icon: '📑', roles: ['admin'] },
    { mod: 'stock-admin',    label: 'Stock & Insumos', icon: '📦', roles: ['admin','recepcion'] },
  ];

  // No reemplazar el módulo 'facturacion' / 'stock' originales del HTML;
  // mi showModule hook los redirige a los nuevos renders.
  nav.appendChild(seccion);
  items.forEach(it => {
    // Si el usuario no tiene rol permitido, no mostrar
    if (rol && it.roles && !it.roles.includes(rol)) return;

    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.setAttribute('data-admin-item', it.mod);
    btn.setAttribute('onclick', `showModule('${it.mod}', this)`);
    btn.innerHTML = `<span style="font-size:14px">${it.icon}</span> ${it.label}`;
    nav.appendChild(btn);
  });
}

// ============================================================
//  Hook showModule: cuando se activa un módulo admin, renderizarlo
// ============================================================
export function instalarAdminModulos() {
  const _original = window.showModule;

  window.showModule = async function (mod, el) {
    // Para módulos admin nuevos, asegurar que existe el contenedor
    if (['config','caja','liquidaciones','stock-admin'].includes(mod)) {
      ensureModuleContainer(mod);
    }

    // Llamar al original (esconde todos, muestra el que corresponde, actualiza sidebar)
    if (typeof _original === 'function') _original(mod, el);

    // Renderizar según el módulo
    if (mod === 'config') {
      const m = document.getElementById('mod-config');
      if (m) await renderConfig(m.querySelector('#config-root') || m);
    } else if (mod === 'facturacion') {
      const m = document.getElementById('mod-facturacion');
      if (m) await renderFacturacion(m);
    } else if (mod === 'caja') {
      const m = document.getElementById('mod-caja');
      if (m) {
        m.id = 'mod-caja'; // asegurar id
        if (!m.querySelector('#mod-caja-container')) {
          const wrap = document.createElement('div');
          wrap.id = 'mod-caja-container';
          m.innerHTML = '';
          m.appendChild(wrap);
        }
        await renderCaja(m.querySelector('#mod-caja-container'));
      }
    } else if (mod === 'liquidaciones') {
      const m = document.getElementById('mod-liquidaciones');
      if (m) await renderLiquidaciones(m);
    } else if (mod === 'stock-admin' || mod === 'stock') {
      // Redirigir stock al nuevo renderer
      let m = document.getElementById('mod-stock');
      if (!m) { ensureModuleContainer('stock-admin'); m = document.getElementById('mod-stock-admin'); }
      if (m) {
        if (!m.querySelector('#mod-stock-container')) {
          const wrap = document.createElement('div');
          wrap.id = 'mod-stock-container';
          m.innerHTML = '';
          m.appendChild(wrap);
        }
        await renderStock(m.querySelector('#mod-stock-container'));
      }
    }
  };
}

// ============================================================
//  INSTALAR: setup completo tras login
// ============================================================
export async function instalarAdminPanel() {
  // Guardar el rol en window para usarlo en checks
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: prof } = await supabase.from('profiles').select('rol').eq('id', user.id).single();
    window.__profileRol = prof?.rol;
  }

  instalarAdminModulos();
  agregarSidebar();

  console.log('[Admin] ✅ Módulos administrativos conectados');
}
