// ============================================================
//  RehabMed ERP — Módulo Configuración
//  ABM de Obras Sociales y Tarifario
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';

let _obrasSociales = [];
let _tarifas = [];
let _tabActual = 'obras-sociales';

// ============================================================
//  RENDER PRINCIPAL
// ============================================================
export async function renderConfig(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <div class="page-title">⚙️ Configuración</div>
        <div class="page-sub">Obras sociales, tarifario y parámetros del sistema</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${_tabActual === 'obras-sociales' ? 'active' : ''}" data-tab="obras-sociales">🏥 Obras Sociales</button>
      <button class="tab ${_tabActual === 'tarifas' ? 'active' : ''}" data-tab="tarifas">💰 Tarifario</button>
    </div>

    <div id="configContent"></div>
  `;

  container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => {
      _tabActual = btn.getAttribute('data-tab');
      renderConfig(container);
    };
  });

  const content = container.querySelector('#configContent');
  if (_tabActual === 'obras-sociales') {
    await renderObrasSociales(content);
  } else {
    await renderTarifas(content);
  }
}

// ============================================================
//  OBRAS SOCIALES
// ============================================================
async function renderObrasSociales(container) {
  const { data, error } = await supabase
    .from('obras_sociales')
    .select('*')
    .order('nombre');

  if (error) {
    container.innerHTML = `<div style="color:var(--rose);padding:20px">Error: ${escapeHtml(error.message)}</div>`;
    return;
  }
  _obrasSociales = data || [];

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn btn-sky" id="btnNuevaOS">+ Nueva Obra Social</button>
    </div>
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>CUIT</th>
              <th>Alícuota IVA</th>
              <th>Comisión %</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="osTbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tb = container.querySelector('#osTbody');
  if (_obrasSociales.length === 0) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text4)">
      Sin obras sociales cargadas. Creá la primera con "+ Nueva Obra Social".
    </td></tr>`;
  } else {
    tb.innerHTML = _obrasSociales.map(os => `
      <tr data-id="${escapeAttr(os.id)}">
        <td>
          <div style="font-weight:700;color:var(--text)">${escapeHtml(os.nombre)}</div>
          ${os.razon_social ? `<div style="font-size:10px;color:var(--text4)">${escapeHtml(os.razon_social)}</div>` : ''}
        </td>
        <td><span class="badge badge-sky">${escapeHtml(os.tipo)}</span></td>
        <td style="font-family:var(--mono);font-size:12px">${escapeHtml(os.cuit || '—')}</td>
        <td>${os.alicuota_iva}%</td>
        <td>${os.comision_pct}%</td>
        <td>${os.activo ? '<span style="color:var(--emerald)">✓</span>' : '<span style="color:var(--rose)">✗</span>'}</td>
        <td><button class="btn btn-ghost btn-sm" data-edit="${escapeAttr(os.id)}">Editar</button></td>
      </tr>
    `).join('');
  }

  container.querySelector('#btnNuevaOS').onclick = () => abrirModalOS();
  tb.onclick = (ev) => {
    const btn = ev.target.closest('[data-edit]');
    if (btn) abrirModalOS(btn.getAttribute('data-edit'));
  };
}

function abrirModalOS(id = null) {
  const os = id ? _obrasSociales.find(o => o.id === id) : null;
  const modal = crearModal('modalOS', `
    <div class="modal-title">${os ? '✏️ Editar' : '+ Nueva'} Obra Social</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="osNombre" value="${escapeAttr(os?.nombre || '')}" placeholder="Ej: OSDE 310"></div>
      <div class="form-group"><label class="form-label">Tipo *</label>
        <select class="form-select" id="osTipo">
          ${['Particular','Obra Social','Prepaga','ART','Mutual'].map(t =>
            `<option value="${t}" ${os?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Razón Social</label><input class="form-input" id="osRazon" value="${escapeAttr(os?.razon_social || '')}"></div>
      <div class="form-group"><label class="form-label">CUIT</label><input class="form-input" id="osCuit" value="${escapeAttr(os?.cuit || '')}" placeholder="30-XXXXXXXX-X"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Alícuota IVA %</label><input class="form-input" id="osIva" type="number" step="0.01" value="${os?.alicuota_iva ?? 21}"></div>
      <div class="form-group"><label class="form-label">Comisión OS %</label><input class="form-input" id="osComision" type="number" step="0.01" value="${os?.comision_pct ?? 0}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Día Presentación</label><input class="form-input" id="osDiaPres" type="number" min="1" max="31" value="${os?.dia_presentacion || ''}"></div>
      <div class="form-group"><label class="form-label">Día Cobro</label><input class="form-input" id="osDiaCobro" type="number" min="1" max="31" value="${os?.dia_cobro || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="osTel" value="${escapeAttr(os?.telefono || '')}"></div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="osEmail" type="email" value="${escapeAttr(os?.email || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Notas</label><textarea class="form-input" id="osNotas" rows="2">${escapeHtml(os?.notas || '')}</textarea></div>
    <div class="form-group" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="osActivo" ${os?.activo !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--emerald)">
      <label for="osActivo" style="font-size:13px;color:var(--text2)">Activo (se muestra en listas y dropdowns)</label>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarOS">${os ? 'Guardar cambios' : 'Crear'}</button>
    </div>
  `);

  modal.querySelector('#btnGuardarOS').onclick = async () => {
    const v = id => modal.querySelector('#' + id)?.value?.trim() || null;
    const payload = {
      nombre:           v('osNombre'),
      tipo:             v('osTipo'),
      razon_social:     v('osRazon'),
      cuit:             v('osCuit'),
      alicuota_iva:     parseFloat(v('osIva')) || 21,
      comision_pct:     parseFloat(v('osComision')) || 0,
      dia_presentacion: v('osDiaPres') ? parseInt(v('osDiaPres')) : null,
      dia_cobro:        v('osDiaCobro') ? parseInt(v('osDiaCobro')) : null,
      telefono:         v('osTel'),
      email:            v('osEmail'),
      notas:            v('osNotas'),
      activo:           modal.querySelector('#osActivo').checked,
    };
    if (!payload.nombre) { showToast('⚠️ Nombre es obligatorio'); return; }

    const q = os
      ? supabase.from('obras_sociales').update(payload).eq('id', os.id)
      : supabase.from('obras_sociales').insert([payload]);
    const { error } = await q;
    if (error) { showToast(`❌ ${error.message}`); return; }

    showToast(os ? '✅ OS actualizada' : '✅ OS creada');
    cerrarModal('modalOS');
    const cont = document.getElementById('configContent');
    if (cont) await renderObrasSociales(cont);
  };
}

// ============================================================
//  TARIFARIO
// ============================================================
async function renderTarifas(container) {
  const [tarifasR, osR] = await Promise.all([
    supabase.from('tarifas').select('*, obras_sociales(nombre)').order('especialidad').order('monto'),
    supabase.from('obras_sociales').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  if (tarifasR.error) {
    container.innerHTML = `<div style="color:var(--rose);padding:20px">${escapeHtml(tarifasR.error.message)}</div>`;
    return;
  }
  _tarifas = tarifasR.data || [];
  const obrasActivas = osR.data || [];

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--text3)">${_tarifas.length} tarifas cargadas</div>
      <button class="btn btn-sky" id="btnNuevaTarifa">+ Nueva Tarifa</button>
    </div>
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Especialidad</th>
              <th>Cobertura</th>
              <th>Monto</th>
              <th>Código</th>
              <th>Vigente desde</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tarifasTbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tb = container.querySelector('#tarifasTbody');
  if (_tarifas.length === 0) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text4)">Sin tarifas</td></tr>`;
  } else {
    tb.innerHTML = _tarifas.map(t => {
      const cobertura = t.obras_sociales?.nombre || '<span style="color:var(--emerald);font-weight:600">Particular</span>';
      return `
        <tr data-id="${escapeAttr(t.id)}">
          <td style="font-weight:700">${escapeHtml(t.especialidad)}</td>
          <td>${cobertura}</td>
          <td style="font-family:var(--mono);font-weight:700;color:var(--sky)">$${Number(t.monto).toLocaleString('es-AR')}</td>
          <td style="font-size:11px;color:var(--text4)">${escapeHtml(t.codigo_prestacion || '—')}</td>
          <td style="font-size:11px">${escapeHtml(t.vigencia_desde)}</td>
          <td>${t.activo ? '<span style="color:var(--emerald)">✓</span>' : '<span style="color:var(--rose)">✗</span>'}</td>
          <td><button class="btn btn-ghost btn-sm" data-edit="${escapeAttr(t.id)}">Editar</button></td>
        </tr>`;
    }).join('');
  }

  container.querySelector('#btnNuevaTarifa').onclick = () => abrirModalTarifa(null, obrasActivas);
  tb.onclick = (ev) => {
    const btn = ev.target.closest('[data-edit]');
    if (btn) abrirModalTarifa(btn.getAttribute('data-edit'), obrasActivas);
  };
}

function abrirModalTarifa(id, obrasActivas) {
  const t = id ? _tarifas.find(x => x.id === id) : null;
  const especialidades = ['Kinesiología','Fisioterapia','Psicología','Traumatología','Neurología','Reumatología','Pediatría','Deportología','Fonoaudiología','Terapia Ocupacional'];

  const modal = crearModal('modalTarifa', `
    <div class="modal-title">${t ? '✏️ Editar' : '+ Nueva'} Tarifa</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Especialidad *</label>
        <select class="form-select" id="tarEsp">
          ${especialidades.map(e => `<option ${t?.especialidad === e ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Cobertura</label>
        <select class="form-select" id="tarOS">
          <option value="">— Particular —</option>
          ${obrasActivas.map(os => `<option value="${escapeAttr(os.id)}" ${t?.obra_social_id === os.id ? 'selected' : ''}>${escapeHtml(os.nombre)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto *</label><input class="form-input" id="tarMonto" type="number" step="0.01" min="0" value="${t?.monto || ''}"></div>
      <div class="form-group"><label class="form-label">Código nomenclador</label><input class="form-input" id="tarCodigo" value="${escapeAttr(t?.codigo_prestacion || '')}" placeholder="Ej: 27.01.01"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Vigente desde *</label><input class="form-input" id="tarDesde" type="date" value="${t?.vigencia_desde || new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label class="form-label">Vigente hasta</label><input class="form-input" id="tarHasta" type="date" value="${t?.vigencia_hasta || ''}"></div>
    </div>
    <div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="tarDesc" value="${escapeAttr(t?.descripcion || '')}"></div>
    <div class="form-group" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="tarActivo" ${t?.activo !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--emerald)">
      <label for="tarActivo" style="font-size:13px">Activa</label>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarTar">${t ? 'Guardar' : 'Crear'}</button>
    </div>
  `);

  modal.querySelector('#btnGuardarTar').onclick = async () => {
    const payload = {
      especialidad:      modal.querySelector('#tarEsp').value,
      obra_social_id:    modal.querySelector('#tarOS').value || null,
      monto:             parseFloat(modal.querySelector('#tarMonto').value),
      codigo_prestacion: modal.querySelector('#tarCodigo').value.trim() || null,
      vigencia_desde:    modal.querySelector('#tarDesde').value,
      vigencia_hasta:    modal.querySelector('#tarHasta').value || null,
      descripcion:       modal.querySelector('#tarDesc').value.trim() || null,
      activo:            modal.querySelector('#tarActivo').checked,
    };
    if (!payload.monto || payload.monto < 0) { showToast('⚠️ Monto inválido'); return; }

    const q = t
      ? supabase.from('tarifas').update(payload).eq('id', t.id)
      : supabase.from('tarifas').insert([payload]);
    const { error } = await q;
    if (error) { showToast(`❌ ${error.message}`); return; }

    showToast('✅ Tarifa guardada');
    cerrarModal('modalTarifa');
    const cont = document.getElementById('configContent');
    if (cont) await renderTarifas(cont);
  };
}

// ============================================================
//  HELPER: crear modal dinámico
// ============================================================
export function crearModal(id, innerHtml) {
  let existing = document.getElementById(id);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = id;
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="modal" style="width:560px;max-width:95vw;max-height:90vh;overflow-y:auto">${innerHtml}</div>`;
  document.body.appendChild(overlay);

  // Cerrar con botones data-cerrar o click en overlay
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('[data-cerrar]')) {
      cerrarModal(id);
    }
  });
  return overlay;
}

export function cerrarModal(id) {
  const m = document.getElementById(id);
  if (m) m.remove();
}
