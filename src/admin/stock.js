// ============================================================
//  RehabMed ERP — Módulo Stock
//  Insumos + movimientos de entrada/salida
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

export async function renderStock(container) {
  if (!container) return;

  const [insumosR, movsR] = await Promise.all([
    supabase.from('insumos').select('*').eq('activo', true).order('nombre'),
    supabase.from('movimientos_stock').select('*, insumos(nombre)')
      .order('created_at', { ascending: false }).limit(20),
  ]);

  const insumos = insumosR.data || [];
  const criticos = insumos.filter(i => i.stock_actual <= i.stock_minimo);
  const valorizado = insumos.reduce((s, i) => s + (i.stock_actual * Number(i.costo_unitario)), 0);

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <div class="page-title">📦 Stock & Insumos</div>
        <div class="page-sub">Inventario, movimientos y alertas de reposición</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="btnMovimiento">+ Movimiento</button>
        <button class="btn btn-sky" id="btnNuevoInsumo">+ Nuevo Insumo</button>
      </div>
    </div>

    <div class="grid-4" style="margin-bottom:16px">
      <div class="stat-card" data-color="sky">
        <div class="stat-label">ÍTEMS ACTIVOS</div>
        <div class="stat-value">${insumos.length}</div>
        <div class="stat-footer"><span class="stat-desc">en catálogo</span></div>
      </div>
      <div class="stat-card" data-color="emerald">
        <div class="stat-label">VALORIZACIÓN</div>
        <div class="stat-value">$${(valorizado/1000).toFixed(1)}K</div>
        <div class="stat-footer"><span class="stat-desc">inventario total</span></div>
      </div>
      <div class="stat-card" data-color="amber">
        <div class="stat-label">STOCK BAJO</div>
        <div class="stat-value">${criticos.length}</div>
        <div class="stat-footer"><span class="stat-desc">ítems bajo mínimo</span></div>
      </div>
      <div class="stat-card" data-color="violet">
        <div class="stat-label">MOVIMIENTOS</div>
        <div class="stat-value">${(movsR.data || []).length}</div>
        <div class="stat-footer"><span class="stat-desc">últimos 20</span></div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab-stock="catalogo">📋 Catálogo</button>
      <button class="tab" data-tab-stock="movimientos">📜 Movimientos</button>
      ${criticos.length > 0 ? `<button class="tab" data-tab-stock="criticos">⚠️ Críticos (${criticos.length})</button>` : ''}
    </div>

    <div id="stockContent"></div>
  `;

  await renderCatalogo(container.querySelector('#stockContent'), insumos);

  container.querySelector('#btnNuevoInsumo').onclick = () => abrirModalInsumo();
  container.querySelector('#btnMovimiento').onclick = () => abrirModalMovimiento(insumos);

  container.querySelectorAll('[data-tab-stock]').forEach(btn => {
    btn.onclick = async () => {
      container.querySelectorAll('[data-tab-stock]').forEach(b => b.classList.toggle('active', b === btn));
      const tab = btn.getAttribute('data-tab-stock');
      const cont = container.querySelector('#stockContent');
      if (tab === 'catalogo') await renderCatalogo(cont, insumos);
      else if (tab === 'movimientos') await renderMovimientos(cont);
      else await renderCatalogo(cont, criticos);
    };
  });
}

async function renderCatalogo(container, insumos) {
  container.innerHTML = `
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Insumo</th><th>Categoría</th><th>Stock</th><th>Mínimo</th><th>Costo</th><th>Valor</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>${insumos.length === 0
            ? `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text4)">Sin insumos cargados</td></tr>`
            : insumos.map(i => {
                const bajo = i.stock_actual <= i.stock_minimo;
                const critico = i.stock_actual === 0 || i.stock_actual < i.stock_minimo * 0.5;
                return `
                <tr>
                  <td style="font-weight:700">${escapeHtml(i.nombre)}</td>
                  <td><span class="badge badge-slate">${escapeHtml(i.categoria)}</span></td>
                  <td style="font-family:var(--mono);font-weight:700">${i.stock_actual} ${escapeHtml(i.unidad)}</td>
                  <td style="font-family:var(--mono);font-size:12px;color:var(--text4)">${i.stock_minimo}</td>
                  <td style="font-family:var(--mono);font-size:12px">$${Number(i.costo_unitario).toLocaleString('es-AR')}</td>
                  <td style="font-family:var(--mono);font-weight:700">$${(i.stock_actual * Number(i.costo_unitario)).toLocaleString('es-AR')}</td>
                  <td>
                    <span class="stock-status ${critico ? 'stock-critico' : bajo ? 'stock-bajo' : 'stock-ok'}">
                      ${critico ? '🔴 Crítico' : bajo ? '🟡 Bajo' : '🟢 OK'}
                    </span>
                  </td>
                  <td><button class="btn btn-ghost btn-sm" data-edit-insumo="${escapeAttr(i.id)}">Editar</button></td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  container.onclick = (ev) => {
    const btn = ev.target.closest('[data-edit-insumo]');
    if (btn) abrirModalInsumo(btn.getAttribute('data-edit-insumo'), insumos);
  };
}

async function renderMovimientos(container) {
  const { data } = await supabase.from('movimientos_stock')
    .select('*, insumos(nombre), profiles(nombre)')
    .order('created_at', { ascending: false })
    .limit(100);

  container.innerHTML = `
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Insumo</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>
          <tbody>${(data || []).length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text4)">Sin movimientos</td></tr>`
            : data.map(m => `
            <tr>
              <td style="font-size:11px">${new Date(m.created_at).toLocaleString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
              <td style="font-weight:700">${escapeHtml(m.insumos?.nombre || '—')}</td>
              <td><span class="badge badge-${m.tipo === 'entrada' ? 'emerald' : m.tipo === 'salida' ? 'rose' : 'slate'}">${escapeHtml(m.tipo)}</span></td>
              <td style="font-family:var(--mono);font-weight:700;color:${m.tipo === 'entrada' ? 'var(--emerald)' : 'var(--rose)'}">
                ${m.tipo === 'salida' ? '-' : '+'}${m.cantidad}
              </td>
              <td style="font-size:11px;color:var(--text3)">${escapeHtml(m.motivo || '')}</td>
              <td style="font-size:11px;color:var(--text4)">${escapeHtml(m.profiles?.nombre || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function abrirModalInsumo(id = null, lista = []) {
  const i = id ? lista.find(x => x.id === id) : null;
  const modal = crearModal('modalInsumo', `
    <div class="modal-title">${i ? '✏️ Editar' : '+ Nuevo'} Insumo</div>
    <div class="form-group"><label class="form-label">Nombre *</label>
      <input class="form-input" id="insNombre" value="${escapeAttr(i?.nombre || '')}" placeholder="Ej: Vendas elásticas 10cm">
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Categoría *</label>
        <select class="form-select" id="insCat">
          ${['Insumos','Electroterapia','Fisioterapia','Limpieza','Descartables','Oficina','Otros']
            .map(c => `<option ${i?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Unidad *</label>
        <input class="form-input" id="insUnidad" value="${escapeAttr(i?.unidad || 'unid')}" placeholder="unid, pares, litros...">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Stock actual *</label>
        <input class="form-input" id="insStock" type="number" min="0" value="${i?.stock_actual ?? 0}">
      </div>
      <div class="form-group"><label class="form-label">Stock mínimo *</label>
        <input class="form-input" id="insMinimo" type="number" min="0" value="${i?.stock_minimo ?? 0}">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Costo unitario</label>
      <input class="form-input" id="insCosto" type="number" step="0.01" min="0" value="${i?.costo_unitario ?? 0}">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarIns">${i ? 'Guardar' : 'Crear'}</button>
    </div>
  `);

  modal.querySelector('#btnGuardarIns').onclick = async () => {
    const payload = {
      nombre:        modal.querySelector('#insNombre').value.trim(),
      categoria:     modal.querySelector('#insCat').value,
      unidad:        modal.querySelector('#insUnidad').value.trim() || 'unid',
      stock_actual:  parseInt(modal.querySelector('#insStock').value) || 0,
      stock_minimo:  parseInt(modal.querySelector('#insMinimo').value) || 0,
      costo_unitario: parseFloat(modal.querySelector('#insCosto').value) || 0,
    };
    if (!payload.nombre) { showToast('⚠️ Nombre obligatorio'); return; }

    const q = i
      ? supabase.from('insumos').update(payload).eq('id', i.id)
      : supabase.from('insumos').insert([payload]);
    const { error } = await q;
    if (error) { showToast(`❌ ${error.message}`); return; }

    showToast('✅ Insumo guardado');
    cerrarModal('modalInsumo');
    const cont = document.getElementById('mod-stock-container');
    if (cont) await renderStock(cont);
  };
}

function abrirModalMovimiento(insumos) {
  const modal = crearModal('modalMovStock', `
    <div class="modal-title">+ Movimiento de Stock</div>
    <div class="form-group"><label class="form-label">Insumo *</label>
      <select class="form-select" id="movInsumo">
        <option value="">Seleccionar...</option>
        ${insumos.map(i => `<option value="${escapeAttr(i.id)}">${escapeHtml(i.nombre)} · stock: ${i.stock_actual}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo *</label>
        <select class="form-select" id="movTipo">
          <option value="entrada">Entrada (+)</option>
          <option value="salida">Salida (−)</option>
          <option value="ajuste">Ajuste</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Cantidad *</label>
        <input class="form-input" id="movCant" type="number" min="1" value="1">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Motivo</label>
      <input class="form-input" id="movMotivo" placeholder="Ej: Compra proveedor X, uso en sesión, merma">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarMov">Registrar</button>
    </div>
  `);

  modal.querySelector('#btnGuardarMov').onclick = async () => {
    const insumoId = modal.querySelector('#movInsumo').value;
    const tipo = modal.querySelector('#movTipo').value;
    const cantidad = parseInt(modal.querySelector('#movCant').value);
    const motivo = modal.querySelector('#movMotivo').value.trim() || null;

    if (!insumoId || !cantidad || cantidad <= 0) { showToast('⚠️ Completá insumo y cantidad'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    const insumo = insumos.find(i => i.id === insumoId);
    if (!insumo) return;

    // Calcular nuevo stock
    let nuevoStock = insumo.stock_actual;
    if (tipo === 'entrada') nuevoStock += cantidad;
    else if (tipo === 'salida') {
      if (insumo.stock_actual < cantidad) {
        if (!confirm(`Stock actual ${insumo.stock_actual} < ${cantidad}. ¿Continuar?`)) return;
      }
      nuevoStock = Math.max(0, insumo.stock_actual - cantidad);
    } else {
      // ajuste: la cantidad es el nuevo stock absoluto
      nuevoStock = cantidad;
    }

    // Transacción: insertar movimiento + actualizar stock
    const [movR, stockR] = await Promise.all([
      supabase.from('movimientos_stock').insert([{
        insumo_id: insumoId, tipo,
        cantidad: tipo === 'ajuste' ? Math.abs(nuevoStock - insumo.stock_actual) : cantidad,
        motivo, usuario_id: user?.id,
      }]),
      supabase.from('insumos').update({ stock_actual: nuevoStock }).eq('id', insumoId),
    ]);

    if (movR.error || stockR.error) {
      showToast(`❌ ${(movR.error || stockR.error).message}`);
      return;
    }

    showToast('✅ Movimiento registrado');
    cerrarModal('modalMovStock');
    const cont = document.getElementById('mod-stock-container');
    if (cont) await renderStock(cont);
  };
}
