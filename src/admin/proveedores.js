// ============================================================
//  RehabMed ERP — Módulo Proveedores (CRUD + archivos)
//
//  Reemplaza el array legacy CT_PROVEEDORES del HTML por datos
//  reales de Supabase. Provee:
//    • cargarProveedores()         — hidrata window.CT_PROVEEDORES
//    • abrirFichaProveedor(id)     — modal con tabs (datos + archivos)
//    • upload/download/delete archivos al bucket "proveedores-docs"
//
//  Sobreescribe:
//    • window.guardarNuevoProv()   — handler del modal nuevo prov
//    • window.renderProveedores()  — render de la grid
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { formatSupabaseError } from '../lib/errors.js';
import { crearModal, cerrarModal } from './config.js';

const BUCKET = 'proveedores-docs';

// Estado del módulo
let _proveedores = [];
let _editandoProvId = null;
let _modalFicha = null;
let _provActivoFicha = null;

// ============================================================
//  CARGAR PROVEEDORES
// ============================================================
export async function cargarProveedores() {
  const { data, error } = await supabase
    .from('v_proveedores_full')
    .select('*')
    .order('razon_social');

  if (error) {
    console.error('[Proveedores] Error al cargar:', error);
    showToast('❌ ' + formatSupabaseError(error, 'proveedores'));
    return;
  }

  _proveedores = data || [];

  // Mantener compatibilidad con el render legacy del HTML
  // (el array legacy usa shape distinto; mapeamos)
  if (typeof window !== 'undefined') {
    window.CT_PROVEEDORES = _proveedores.map(p => ({
      id:    p.id,
      nom:   p.razon_social,
      cat:   p.categoria || p.rubro || '—',
      tel:   p.telefono || '',
      // datos extras para la grid:
      _real: true,
      _cuit: p.cuit,
      _email: p.email,
      _condIva: p.condicion_iva,
      _condPago: p.condicion_pago,
      _activo: p.activo,
      _archivos: p.cantidad_archivos || 0,
      _proxVenc: p.proximo_vencimiento,
    }));
  }

  // Forzar re-render
  if (typeof window.renderProveedores === 'function') {
    try { window.renderProveedores(); } catch (e) { console.warn(e); }
  }

  console.log(`[Proveedores] ✅ ${_proveedores.length} cargados`);
}

// ============================================================
//  GUARDAR (crear o actualizar)
// ============================================================
async function guardarHandler() {
  const v = id => document.getElementById(id)?.value?.trim() || null;
  const vNum = id => {
    const n = parseFloat(document.getElementById(id)?.value);
    return Number.isFinite(n) ? n : null;
  };
  const vBool = id => !!document.getElementById(id)?.checked;

  const razon = v('provRazon');
  const cuit  = v('provCuit');
  if (!razon) { showToast('⚠️ La razón social es obligatoria'); return; }

  const payload = {
    razon_social:        razon,
    nombre_fantasia:     v('provFantasia'),
    cuit,
    categoria:           v('provCategoria'),
    rubro:               v('provRubro'),

    condicion_iva:       v('provCondIva'),
    ingresos_brutos_nro: v('provIIBB'),
    iibb_jurisdiccion:   v('provIIBBJur'),
    iibb_exento:         vBool('provIIBBExento'),
    agente_retencion:    vBool('provAgRet'),
    agente_percepcion:   vBool('provAgPerc'),

    persona_contacto:    v('provContacto'),
    cargo_contacto:      v('provCargo'),
    email:               v('provEmail'),
    web:                 v('provWeb'),
    telefono:            v('provTel'),
    telefono_secundario: v('provTel2'),
    direccion:           v('provDir'),
    localidad:           v('provLocalidad'),
    provincia:           v('provProvincia'),
    codigo_postal:       v('provCP'),
    pais:                v('provPais') || 'Argentina',

    condicion_pago:      v('provCondPago') || 'Contado',
    dias_plazo:          parseInt(document.getElementById('provDiasPlazo')?.value) || 0,
    limite_credito:      vNum('provLimite') || 0,
    moneda:              v('provMoneda') || 'ARS',
    descuento_pct:       vNum('provDescuento') || 0,

    banco:               v('provBanco'),
    tipo_cuenta:         v('provTipoCuenta'),
    cbu:                 v('provCBU'),
    alias_cbu:           v('provAliasCBU'),
    titular:             v('provTitular'),
    titular_cuit:        v('provTitularCuit'),

    notas:               v('provNotas'),
  };

  let result;
  if (_editandoProvId) {
    result = await supabase.from('proveedores').update(payload).eq('id', _editandoProvId).select().single();
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    payload.created_by = user?.id;
    result = await supabase.from('proveedores').insert([payload]).select().single();
  }

  if (result.error) {
    console.error('[Proveedores] guardar:', result.error);
    showToast('❌ ' + formatSupabaseError(result.error, 'proveedor'));
    return;
  }

  showToast(_editandoProvId
    ? `✅ ${result.data.razon_social} actualizado`
    : `✅ ${result.data.razon_social} agregado al sistema`);

  // Limpiar form + cerrar modal + recargar
  if (typeof window.closeModal === 'function') window.closeModal('modalNuevoProv');
  resetFormProv();
  _editandoProvId = null;
  await cargarProveedores();
}

function resetFormProv() {
  [
    'provRazon','provCuit','provFantasia','provCategoria','provRubro',
    'provIIBB','provIIBBJur',
    'provContacto','provCargo','provEmail','provWeb','provTel','provTel2',
    'provDir','provLocalidad','provProvincia','provCP',
    'provLimite','provDescuento',
    'provBanco','provCBU','provAliasCBU','provTitular','provTitularCuit',
    'provNotas',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Defaults
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('provPais', 'Argentina');
  setVal('provDiasPlazo', '0');
  setVal('provCondPago', 'Contado');
  setVal('provMoneda', 'ARS');
  setVal('provCondIva', '');
  setVal('provTipoCuenta', '');

  // Checkboxes
  ['provIIBBExento', 'provAgRet', 'provAgPerc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.checked = false;
  });

  // Restaurar título y botón
  const title = document.getElementById('modalProvTitle');
  if (title) title.textContent = '📦 Nuevo Proveedor';
  const btn = document.getElementById('btnGuardarProv');
  if (btn) btn.textContent = 'Crear proveedor';
}

// ============================================================
//  EDITAR — abre el modal pre-cargado
// ============================================================
async function editarProveedor(id) {
  const { data: prov, error } = await supabase
    .from('proveedores').select('*').eq('id', id).single();
  if (error || !prov) {
    showToast('❌ ' + formatSupabaseError(error || { message: 'No encontrado' }, 'proveedor'));
    return;
  }

  _editandoProvId = id;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  const setBool = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

  setVal('provRazon',         prov.razon_social);
  setVal('provFantasia',      prov.nombre_fantasia);
  setVal('provCuit',          prov.cuit);
  setVal('provCategoria',     prov.categoria);
  setVal('provRubro',         prov.rubro);

  setVal('provCondIva',       prov.condicion_iva);
  setVal('provIIBB',          prov.ingresos_brutos_nro);
  setVal('provIIBBJur',       prov.iibb_jurisdiccion);
  setBool('provIIBBExento',   prov.iibb_exento);
  setBool('provAgRet',        prov.agente_retencion);
  setBool('provAgPerc',       prov.agente_percepcion);

  setVal('provContacto',      prov.persona_contacto);
  setVal('provCargo',         prov.cargo_contacto);
  setVal('provEmail',         prov.email);
  setVal('provWeb',           prov.web);
  setVal('provTel',           prov.telefono);
  setVal('provTel2',          prov.telefono_secundario);
  setVal('provDir',           prov.direccion);
  setVal('provLocalidad',     prov.localidad);
  setVal('provProvincia',     prov.provincia);
  setVal('provCP',            prov.codigo_postal);
  setVal('provPais',          prov.pais || 'Argentina');

  setVal('provCondPago',      prov.condicion_pago || 'Contado');
  setVal('provDiasPlazo',     prov.dias_plazo ?? 0);
  setVal('provLimite',        prov.limite_credito);
  setVal('provMoneda',        prov.moneda || 'ARS');
  setVal('provDescuento',     prov.descuento_pct ?? 0);

  setVal('provBanco',         prov.banco);
  setVal('provTipoCuenta',    prov.tipo_cuenta);
  setVal('provCBU',           prov.cbu);
  setVal('provAliasCBU',      prov.alias_cbu);
  setVal('provTitular',       prov.titular);
  setVal('provTitularCuit',   prov.titular_cuit);

  setVal('provNotas',         prov.notas);

  // Cambiar título y botón
  const title = document.getElementById('modalProvTitle');
  if (title) title.textContent = `✏️ Editar Proveedor — ${prov.razon_social}`;
  const btn = document.getElementById('btnGuardarProv');
  if (btn) btn.textContent = 'Guardar cambios';

  if (typeof window.openModal === 'function') window.openModal('modalNuevoProv');
}

// ============================================================
//  ELIMINAR
// ============================================================
async function eliminarProveedor(id, razon) {
  if (!confirm(`¿Eliminar al proveedor "${razon}"?\n\nSus archivos también serán eliminados.\nEsta acción no se puede deshacer.`)) return;

  // Borrar archivos del storage primero (si los hay)
  const { data: archivos } = await supabase
    .from('proveedores_archivos')
    .select('storage_path').eq('proveedor_id', id);

  if (archivos && archivos.length > 0) {
    const paths = archivos.map(a => a.storage_path);
    await supabase.storage.from(BUCKET).remove(paths);
  }

  const { error } = await supabase.from('proveedores').delete().eq('id', id);
  if (error) {
    showToast('❌ ' + formatSupabaseError(error, 'proveedor'));
    return;
  }

  showToast(`🗑️ ${razon} eliminado`);
  await cargarProveedores();
}

// ============================================================
//  FICHA DEL PROVEEDOR (modal con tabs)
// ============================================================
async function abrirFichaProveedor(id) {
  const { data: prov, error } = await supabase
    .from('v_proveedores_full').select('*').eq('id', id).single();
  if (error || !prov) {
    showToast('❌ ' + formatSupabaseError(error || { message: 'Proveedor no encontrado' }, 'proveedor'));
    return;
  }

  _provActivoFicha = prov;

  _modalFicha = crearModal('modalFichaProv', `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:8px">
      <div>
        <div class="modal-title" style="margin-bottom:2px">📦 ${escapeHtml(prov.razon_social)}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:2px">
          ${prov.cuit ? `CUIT ${escapeHtml(prov.cuit)}` : 'Sin CUIT'}
          ${prov.condicion_iva ? ` · ${escapeHtml(prov.condicion_iva)}` : ''}
        </div>
        <div style="font-size:11px;color:var(--text4);display:flex;gap:14px;flex-wrap:wrap">
          ${prov.email ? `<span>✉️ ${escapeHtml(prov.email)}</span>` : ''}
          ${prov.telefono ? `<span>📞 ${escapeHtml(prov.telefono)}</span>` : ''}
          ${prov.persona_contacto ? `<span>👤 ${escapeHtml(prov.persona_contacto)}</span>` : ''}
        </div>
      </div>
      <button class="modal-close" data-cerrar>×</button>
    </div>

    <!-- TABS -->
    <div style="display:flex;gap:2px;margin:14px 0;background:var(--bg);border-radius:8px;padding:4px;width:fit-content">
      <button data-fp-tab="datos" style="background:var(--bg3);color:var(--sky);font-weight:700;padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">📋 Datos completos</button>
      <button data-fp-tab="archivos" style="background:transparent;color:var(--text3);padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">📎 Archivos (${prov.cantidad_archivos || 0})</button>
    </div>

    <div id="fichaProvContent" style="max-height:60vh;overflow-y:auto"></div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
      <button class="btn btn-ghost btn-sm" id="btnCerrarFichaProv">Cerrar</button>
      <button class="btn btn-rose btn-sm" id="btnEliminarProv" style="color:var(--rose)">🗑️ Eliminar</button>
      <button class="btn btn-sky btn-sm" id="btnEditarProv">✏️ Editar datos</button>
    </div>
  `);
  _modalFicha.querySelector('.modal').style.cssText = 'width:780px;max-width:96vw;max-height:92vh;overflow:hidden;display:flex;flex-direction:column';

  _modalFicha.querySelectorAll('[data-fp-tab]').forEach(btn => {
    btn.addEventListener('click', () => cambiarTabFicha(btn.getAttribute('data-fp-tab')));
  });
  _modalFicha.querySelector('#btnCerrarFichaProv').onclick = () => cerrarModal('modalFichaProv');
  _modalFicha.querySelector('#btnEditarProv').onclick = () => {
    cerrarModal('modalFichaProv');
    editarProveedor(prov.id);
  };
  _modalFicha.querySelector('#btnEliminarProv').onclick = () => {
    cerrarModal('modalFichaProv');
    eliminarProveedor(prov.id, prov.razon_social);
  };

  renderTabDatosProv(prov);
}

function cambiarTabFicha(tab) {
  _modalFicha.querySelectorAll('[data-fp-tab]').forEach(b => {
    if (b.getAttribute('data-fp-tab') === tab) {
      b.style.background = 'var(--bg3)'; b.style.color = 'var(--sky)'; b.style.fontWeight = '700';
    } else {
      b.style.background = 'transparent'; b.style.color = 'var(--text3)'; b.style.fontWeight = '500';
    }
  });
  if (tab === 'datos') renderTabDatosProv(_provActivoFicha);
  else if (tab === 'archivos') renderTabArchivos(_provActivoFicha);
}

function renderTabDatosProv(p) {
  const cont = _modalFicha.querySelector('#fichaProvContent');
  const fila = (label, val) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--text4)">${escapeHtml(label)}</span>
      <span style="font-size:12px;color:var(--text);font-weight:500;text-align:right">${val == null || val === '' ? '<span style="color:var(--text4)">—</span>' : escapeHtml(String(val))}</span>
    </div>`;
  const seccion = (titulo, color, filas) => `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">${titulo}</div>
      ${filas}
    </div>`;

  cont.innerHTML = `
    ${seccion('📦 Datos básicos', 'var(--sky)', `
      ${fila('Razón social', p.razon_social)}
      ${fila('Nombre fantasía', p.nombre_fantasia)}
      ${fila('CUIT', p.cuit)}
      ${fila('Categoría', p.categoria)}
      ${fila('Rubro', p.rubro)}
    `)}
    ${seccion('🏛️ Datos fiscales', 'var(--violet)', `
      ${fila('Condición IVA', p.condicion_iva)}
      ${fila('Nº IIBB', p.ingresos_brutos_nro)}
      ${fila('Jurisdicción IIBB', p.iibb_jurisdiccion)}
      ${fila('Exento IIBB', p.iibb_exento ? 'Sí' : 'No')}
      ${fila('Agente retención', p.agente_retencion ? 'Sí' : 'No')}
      ${fila('Agente percepción', p.agente_percepcion ? 'Sí' : 'No')}
    `)}
    ${seccion('📞 Contacto y domicilio', 'var(--emerald)', `
      ${fila('Persona contacto', p.persona_contacto)}
      ${fila('Cargo', p.cargo_contacto)}
      ${fila('Email', p.email)}
      ${fila('Web', p.web)}
      ${fila('Teléfono', p.telefono)}
      ${fila('Tel. alternativo', p.telefono_secundario)}
      ${fila('Dirección', p.direccion)}
      ${fila('Localidad', p.localidad)}
      ${fila('Provincia', p.provincia)}
      ${fila('Código postal', p.codigo_postal)}
      ${fila('País', p.pais)}
    `)}
    ${seccion('💰 Condiciones comerciales', 'var(--amber)', `
      ${fila('Condición de pago', p.condicion_pago)}
      ${fila('Días de plazo', p.dias_plazo)}
      ${fila('Límite de crédito', p.limite_credito ? '$' + Number(p.limite_credito).toLocaleString('es-AR') : null)}
      ${fila('Moneda', p.moneda)}
      ${fila('Descuento habitual', p.descuento_pct ? p.descuento_pct + '%' : null)}
    `)}
    ${seccion('🏦 Datos bancarios', 'var(--sky2)', `
      ${fila('Banco', p.banco)}
      ${fila('Tipo de cuenta', p.tipo_cuenta)}
      ${fila('CBU', p.cbu)}
      ${fila('Alias CBU', p.alias_cbu)}
      ${fila('Titular', p.titular)}
      ${fila('CUIT titular', p.titular_cuit)}
    `)}
    ${p.notas ? seccion('📝 Notas', 'var(--text3)', `<div style="font-size:13px;color:var(--text2);white-space:pre-wrap;line-height:1.5">${escapeHtml(p.notas)}</div>`) : ''}
  `;
}

// ============================================================
//  ARCHIVOS — listar / subir / descargar / eliminar
// ============================================================
async function renderTabArchivos(p) {
  const cont = _modalFicha.querySelector('#fichaProvContent');
  cont.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text4)">⏳ Cargando archivos...</div>';

  const { data: archivos, error } = await supabase
    .from('proveedores_archivos')
    .select('*')
    .eq('proveedor_id', p.id)
    .order('created_at', { ascending: false });

  if (error) {
    cont.innerHTML = `<div style="padding:30px;text-align:center;color:var(--rose)">❌ ${escapeHtml(formatSupabaseError(error, 'archivos'))}</div>`;
    return;
  }

  cont.innerHTML = `
    <!-- Form de subida -->
    <div style="background:rgba(3,105,161,0.05);border:1px dashed rgba(3,105,161,0.3);border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">📤 Subir nuevo archivo</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre / Descripción</label>
          <input class="form-input" id="upArchNombre" placeholder="Ej: Contrato 2026, Última factura...">
        </div>
        <div class="form-group"><label class="form-label">Tipo</label>
          <select class="form-select" id="upArchTipo">
            <option value="contrato">📄 Contrato</option>
            <option value="factura">🧾 Factura</option>
            <option value="comprobante">📋 Comprobante</option>
            <option value="remito">📦 Remito</option>
            <option value="constancia">🏛️ Constancia AFIP</option>
            <option value="otro">❓ Otro</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Archivo</label>
          <input type="file" id="upArchFile" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style="font-size:12px">
          <div style="font-size:10px;color:var(--text4);margin-top:2px">PDF, JPG, PNG, DOC, XLS — Máx 10MB</div>
        </div>
        <div class="form-group"><label class="form-label">Vencimiento (opcional)</label>
          <input class="form-input" id="upArchVenc" type="date">
          <div style="font-size:10px;color:var(--text4);margin-top:2px">Para alertas (ej: contratos)</div>
        </div>
      </div>
      <div style="text-align:right">
        <button class="btn btn-sky btn-sm" id="btnSubirArchivo">📤 Subir archivo</button>
      </div>
    </div>

    <!-- Lista -->
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Archivos del proveedor (${archivos?.length || 0})</div>
    <div id="archList">
      ${(archivos || []).length === 0
        ? `<div style="text-align:center;padding:30px;color:var(--text4);background:var(--bg);border-radius:8px;font-size:12px">
            <div style="font-size:32px;margin-bottom:6px">📭</div>
            Sin archivos cargados
          </div>`
        : (archivos || []).map(a => renderArchivoRow(a)).join('')}
    </div>
  `;

  cont.querySelector('#btnSubirArchivo').onclick = () => subirArchivo(p.id);
  cont.querySelector('#archList').addEventListener('click', async (ev) => {
    const dlBtn = ev.target.closest('[data-arch-dl]');
    if (dlBtn) { descargarArchivo(dlBtn.getAttribute('data-arch-dl')); return; }
    const delBtn = ev.target.closest('[data-arch-del]');
    if (delBtn) { eliminarArchivo(delBtn.getAttribute('data-arch-del'), delBtn.getAttribute('data-arch-path')); return; }
  });
}

function renderArchivoRow(a) {
  const tipoIcono = {
    contrato: '📄', factura: '🧾', comprobante: '📋',
    remito: '📦', constancia: '🏛️', otro: '📁',
  };
  const icono = tipoIcono[a.tipo] || '📁';
  const tamano = a.tamano_bytes ? formatearTamano(a.tamano_bytes) : '';
  const vencProx = a.vencimiento && new Date(a.vencimiento) < new Date(Date.now() + 30 * 86400000);

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <div style="font-size:24px">${icono}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.nombre)}</div>
        <div style="font-size:11px;color:var(--text4);display:flex;gap:10px;flex-wrap:wrap">
          <span>${escapeHtml(a.tipo)}</span>
          ${tamano ? `<span>${tamano}</span>` : ''}
          <span>${escapeHtml(formatearFecha(a.created_at))}</span>
          ${a.vencimiento ? `<span style="color:${vencProx ? 'var(--rose)' : 'var(--text4)'}">${vencProx ? '⚠️ ' : '📅 '}Vence ${formatearFechaCorta(a.vencimiento)}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" data-arch-dl="${escapeAttr(a.id)}" title="Descargar">⬇️</button>
      <button class="btn btn-ghost btn-sm" data-arch-del="${escapeAttr(a.id)}" data-arch-path="${escapeAttr(a.storage_path)}" title="Eliminar" style="color:var(--rose)">🗑️</button>
    </div>`;
}

async function subirArchivo(provId) {
  const fileInput = document.getElementById('upArchFile');
  const file = fileInput?.files?.[0];
  if (!file) { showToast('⚠️ Elegí un archivo'); return; }

  if (file.size > 10 * 1024 * 1024) {
    showToast('⚠️ El archivo supera los 10MB');
    return;
  }

  const nombre = document.getElementById('upArchNombre')?.value?.trim() || file.name;
  const tipo = document.getElementById('upArchTipo')?.value || 'otro';
  const vencimiento = document.getElementById('upArchVenc')?.value || null;

  // Generar path único en el bucket
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin';
  const timestamp = Date.now();
  const safeName = nombre.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const path = `${provId}/${timestamp}_${safeName}.${ext}`;

  showToast('⏳ Subiendo archivo...');

  // Upload al bucket
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (errUp) {
    console.error('[Proveedores] upload:', errUp);
    showToast('❌ ' + formatSupabaseError(errUp, 'archivo'));
    return;
  }

  // Insertar metadata
  const { data: { user } } = await supabase.auth.getUser();
  const { error: errIns } = await supabase.from('proveedores_archivos').insert([{
    proveedor_id: provId,
    nombre,
    tipo,
    storage_path: path,
    tipo_mime:    file.type,
    tamano_bytes: file.size,
    vencimiento,
    uploaded_by:  user?.id,
  }]);

  if (errIns) {
    // Rollback del upload si falla la metadata
    await supabase.storage.from(BUCKET).remove([path]);
    console.error('[Proveedores] insert metadata:', errIns);
    showToast('❌ ' + formatSupabaseError(errIns, 'archivo'));
    return;
  }

  showToast(`✅ ${nombre} subido correctamente`);

  // Limpiar form + refrescar
  if (fileInput) fileInput.value = '';
  document.getElementById('upArchNombre').value = '';
  document.getElementById('upArchVenc').value = '';
  await renderTabArchivos(_provActivoFicha);
  await cargarProveedores(); // actualizar conteo en grid
}

async function descargarArchivo(archId) {
  const { data: arch, error: errSel } = await supabase
    .from('proveedores_archivos').select('storage_path, nombre, tipo_mime')
    .eq('id', archId).single();
  if (errSel || !arch) { showToast('❌ Archivo no encontrado'); return; }

  showToast('⏳ Descargando...');

  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(arch.storage_path, 60); // URL válida 60s

  if (error || !data) {
    console.error('[Proveedores] signed url:', error);
    showToast('❌ ' + formatSupabaseError(error, 'archivo'));
    return;
  }

  // Abrir en nueva pestaña
  window.open(data.signedUrl, '_blank');
}

async function eliminarArchivo(archId, path) {
  if (!confirm('¿Eliminar este archivo?\nEsta acción no se puede deshacer.')) return;

  // Borrar del bucket
  await supabase.storage.from(BUCKET).remove([path]);

  // Borrar metadata
  const { error } = await supabase.from('proveedores_archivos').delete().eq('id', archId);
  if (error) {
    showToast('❌ ' + formatSupabaseError(error, 'archivo'));
    return;
  }

  showToast('🗑️ Archivo eliminado');
  await renderTabArchivos(_provActivoFicha);
  await cargarProveedores();
}

// ============================================================
//  RENDER LISTA (sobreescribe el legacy)
// ============================================================
function renderProveedoresLista() {
  const g = document.getElementById('provGrid');
  if (!g) return;

  if (_proveedores.length === 0) {
    g.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text4);background:var(--bg);border-radius:10px">
        <div style="font-size:36px;margin-bottom:10px">📦</div>
        <div style="font-size:14px;font-weight:700;color:var(--text3)">Sin proveedores cargados</div>
        <div style="font-size:11px;margin-top:4px">Click en "+ Nuevo Proveedor" para empezar</div>
      </div>`;
    return;
  }

  g.innerHTML = _proveedores.map(p => {
    const archivosBadge = p.cantidad_archivos > 0
      ? `<span style="font-size:10px;color:var(--sky)">📎 ${p.cantidad_archivos} archivo${p.cantidad_archivos !== 1 ? 's' : ''}</span>`
      : '';
    const vencProx = p.proximo_vencimiento && new Date(p.proximo_vencimiento) < new Date(Date.now() + 30 * 86400000);
    const vencBadge = vencProx
      ? `<span style="font-size:10px;color:var(--rose);font-weight:600">⚠️ Doc vence ${formatearFechaCorta(p.proximo_vencimiento)}</span>`
      : '';

    return `
      <div class="prov-card" style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px;cursor:pointer" data-prov-id="${escapeAttr(p.id)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="min-width:0;flex:1">
            <div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.razon_social)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">${escapeHtml(p.categoria || '—')}${p.cuit ? ` · CUIT ${escapeHtml(p.cuit)}` : ''}</div>
          </div>
          <span class="badge" style="font-size:10px;background:${p.activo ? 'rgba(5,150,105,0.15)' : 'rgba(148,163,184,0.15)'};color:${p.activo ? 'var(--emerald)' : 'var(--text3)'};padding:2px 8px;border-radius:99px">${p.activo ? 'Activo' : 'Inactivo'}</span>
        </div>
        <div style="font-size:11px;color:var(--text4);margin-bottom:8px">
          ${p.condicion_iva ? `<div>🏛️ ${escapeHtml(p.condicion_iva)}</div>` : ''}
          ${p.condicion_pago ? `<div>💰 ${escapeHtml(p.condicion_pago)}${p.dias_plazo ? ' · ' + p.dias_plazo + 'd' : ''}</div>` : ''}
          ${p.email ? `<div>✉️ ${escapeHtml(p.email)}</div>` : ''}
          ${p.telefono ? `<div>📞 ${escapeHtml(p.telefono)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;border-top:1px solid var(--border);padding-top:8px">
          <div style="display:flex;flex-direction:column;gap:2px">${archivosBadge}${vencBadge}</div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sky btn-sm" data-prov-action="ficha" data-prov-id-action="${escapeAttr(p.id)}" style="font-size:11px;padding:4px 10px">📋 Ficha</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Click en card → abrir ficha
  g.querySelectorAll('.prov-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      // Si el click vino de un botón con data-prov-action, lo maneja el listener delegate de abajo
      if (ev.target.closest('[data-prov-action]')) return;
      abrirFichaProveedor(card.getAttribute('data-prov-id'));
    });
  });

  // Listener para botón ficha (delegate)
  g.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-prov-action="ficha"]');
    if (btn) {
      ev.stopPropagation();
      abrirFichaProveedor(btn.getAttribute('data-prov-id-action'));
    }
  });
}

// ============================================================
//  HELPERS
// ============================================================
function formatearTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatearFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatearFechaCorta(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
//  INSTALAR
// ============================================================
export async function instalarProveedores() {
  // Sobreescribir handlers legacy del HTML
  window.guardarNuevoProv = guardarHandler;
  window.renderProveedores = renderProveedoresLista;
  window.editarProveedor = editarProveedor;
  window.eliminarProveedor = eliminarProveedor;
  window.abrirFichaProveedor = abrirFichaProveedor;

  // Reset del form al cerrar el modal (para que la próxima vez abra limpio)
  document.addEventListener('click', (ev) => {
    const cerrar = ev.target.closest('[onclick*="closeModal(\'modalNuevoProv\')"]');
    if (cerrar) {
      setTimeout(() => { _editandoProvId = null; resetFormProv(); }, 100);
    }
  });

  // Hidratar
  await cargarProveedores();
}

// Export para acceso externo
window.ProveedoresMod = {
  cargarProveedores,
  abrirFichaProveedor,
  editarProveedor,
  eliminarProveedor,
};
