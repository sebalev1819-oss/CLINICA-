// ============================================================
//  RehabMed ERP — Módulo Facturación
//  Listado de facturas, emisión manual/desde turno, pagos, cta cte
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

const ESTADO_COLORS = {
  'Borrador':    'amber',
  'Emitida':     'sky',
  'Pagada':      'emerald',
  'Parcial':     'violet',
  'Anulada':     'slate',
  'Vencida':     'rose',
  'Presupuesto': 'slate',
};

// ============================================================
//  RENDER
// ============================================================
export async function renderFacturacion(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <div class="page-title">💰 Facturación & Cobranzas</div>
        <div class="page-sub">Documentos fiscales, pagos y cuenta corriente</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="btnFacturarTurnos">⚡ Facturar turnos finalizados</button>
        <button class="btn btn-sky" id="btnNuevaFactura">+ Nueva Factura</button>
      </div>
    </div>

    <div class="grid-4" id="facKPIs" style="margin-bottom:16px"></div>

    <div class="tabs">
      <button class="tab active" data-tab-fac="facturas">📄 Facturas</button>
      <button class="tab" data-tab-fac="pagos">💵 Pagos</button>
      <button class="tab" data-tab-fac="cta-cte">📊 Cta Cte Pacientes</button>
    </div>

    <div id="facContent"></div>
  `;

  await renderKPIsFact(container.querySelector('#facKPIs'));
  await renderListaFacturas(container.querySelector('#facContent'));

  container.querySelector('#btnNuevaFactura').onclick = () => abrirModalNuevaFactura();
  container.querySelector('#btnFacturarTurnos').onclick = () => facturarTurnosFinalizados();

  container.querySelectorAll('[data-tab-fac]').forEach(btn => {
    btn.onclick = async () => {
      container.querySelectorAll('[data-tab-fac]').forEach(b => b.classList.toggle('active', b === btn));
      const tab = btn.getAttribute('data-tab-fac');
      const cont = container.querySelector('#facContent');
      if (tab === 'facturas') await renderListaFacturas(cont);
      else if (tab === 'pagos') await renderListaPagos(cont);
      else await renderCtaCte(cont);
    };
  });
}

// ============================================================
//  KPIs
// ============================================================
async function renderKPIsFact(container) {
  const now = new Date();
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const hoy = now.toISOString().slice(0,10);

  const [emitidasMes, pagadasMes, saldoTotal, vencidas] = await Promise.all([
    supabase.from('facturas').select('total', { count: 'exact' })
      .gte('fecha_emision', primerDiaMes).lte('fecha_emision', hoy)
      .in('estado', ['Emitida','Parcial','Pagada']),
    supabase.from('pagos').select('monto')
      .gte('fecha', primerDiaMes).lte('fecha', hoy),
    supabase.from('facturas').select('saldo')
      .in('estado', ['Emitida','Parcial','Vencida']),
    supabase.from('facturas').select('id', { count: 'exact' })
      .in('estado', ['Emitida','Parcial']).lt('fecha_vencimiento', hoy),
  ]);

  const totalEmitido = (emitidasMes.data || []).reduce((s,f) => s + Number(f.total), 0);
  const totalCobrado = (pagadasMes.data || []).reduce((s,p) => s + Number(p.monto), 0);
  const saldoPendiente = (saldoTotal.data || []).reduce((s,f) => s + Number(f.saldo), 0);

  container.innerHTML = `
    <div class="stat-card" data-color="sky">
      <div class="stat-label">FACTURADO MES</div>
      <div class="stat-value">$${(totalEmitido/1000).toFixed(1)}K</div>
      <div class="stat-footer"><span class="stat-desc">${emitidasMes.count || 0} facturas</span></div>
    </div>
    <div class="stat-card" data-color="emerald">
      <div class="stat-label">COBRADO MES</div>
      <div class="stat-value">$${(totalCobrado/1000).toFixed(1)}K</div>
      <div class="stat-footer"><span class="stat-desc">${(pagadasMes.data || []).length} pagos</span></div>
    </div>
    <div class="stat-card" data-color="amber">
      <div class="stat-label">SALDO PENDIENTE</div>
      <div class="stat-value">$${(saldoPendiente/1000).toFixed(1)}K</div>
      <div class="stat-footer"><span class="stat-desc">total por cobrar</span></div>
    </div>
    <div class="stat-card" data-color="rose">
      <div class="stat-label">VENCIDAS</div>
      <div class="stat-value">${vencidas.count || 0}</div>
      <div class="stat-footer"><span class="stat-desc">facturas vencidas</span></div>
    </div>
  `;
}

// ============================================================
//  LISTA FACTURAS
// ============================================================
async function renderListaFacturas(container) {
  const { data, error } = await supabase
    .from('facturas')
    .select(`
      id, numero, tipo, fecha_emision, fecha_vencimiento,
      subtotal, total, saldo, estado,
      pacientes ( nombre, dni ),
      obras_sociales ( nombre )
    `)
    .order('fecha_emision', { ascending: false })
    .order('numero', { ascending: false })
    .limit(100);

  if (error) {
    container.innerHTML = `<div style="color:var(--rose);padding:20px">${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="card card-pad" style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:12px">📄</div>
        <div style="font-size:15px;font-weight:700;color:var(--text3)">Sin facturas emitidas</div>
        <div style="font-size:12px;color:var(--text4);margin-top:4px">Cargá tarifas y obras sociales en Configuración para empezar</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N°</th>
              <th>Tipo</th>
              <th>Fecha</th>
              <th>Destinatario</th>
              <th>Total</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="facturasTbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tb = container.querySelector('#facturasTbody');
  tb.innerHTML = data.map(f => {
    const dest = f.pacientes?.nombre || f.obras_sociales?.nombre || '—';
    const badge = ESTADO_COLORS[f.estado] || 'slate';
    return `
      <tr data-factura="${escapeAttr(f.id)}" style="cursor:pointer">
        <td style="font-family:var(--mono);font-weight:700">#${String(f.numero).padStart(6,'0')}</td>
        <td><span class="badge badge-${f.tipo === 'Presupuesto' ? 'slate' : 'sky'}">${escapeHtml(f.tipo)}</span></td>
        <td style="font-size:12px">${escapeHtml(f.fecha_emision)}</td>
        <td>${escapeHtml(dest)}</td>
        <td style="font-family:var(--mono);font-weight:700">$${Number(f.total).toLocaleString('es-AR')}</td>
        <td style="font-family:var(--mono);color:${Number(f.saldo) > 0 ? 'var(--rose)' : 'var(--emerald)'}">$${Number(f.saldo).toLocaleString('es-AR')}</td>
        <td><span class="badge badge-${badge}">${escapeHtml(f.estado)}</span></td>
        <td style="text-align:right">
          ${Number(f.saldo) > 0 ? `<button class="btn btn-emerald btn-sm" data-pagar="${escapeAttr(f.id)}">💵 Cobrar</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  tb.onclick = (ev) => {
    const btnPagar = ev.target.closest('[data-pagar]');
    if (btnPagar) {
      ev.stopPropagation();
      abrirModalPago(btnPagar.getAttribute('data-pagar'));
      return;
    }
    const fila = ev.target.closest('[data-factura]');
    if (fila) abrirDetalleFactura(fila.getAttribute('data-factura'));
  };
}

// ============================================================
//  NUEVA FACTURA
// ============================================================
async function abrirModalNuevaFactura() {
  const [pacR, osR, tarifasR] = await Promise.all([
    supabase.from('pacientes').select('id, nombre').order('nombre'),
    supabase.from('obras_sociales').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('v_tarifas_vigentes').select('*'),
  ]);
  const pacientes = pacR.data || [];
  const obras = osR.data || [];
  const tarifas = tarifasR.data || [];

  const modal = crearModal('modalNuevaFactura', `
    <div class="modal-title">+ Nueva Factura</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="facTipo">
          <option>Recibo</option><option>A</option><option>B</option><option>C</option><option>Presupuesto</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Fecha emisión</label>
        <input class="form-input" id="facFecha" type="date" value="${new Date().toISOString().slice(0,10)}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Paciente</label>
        <input class="form-input" id="facPac" list="facPacList" placeholder="Buscar...">
        <datalist id="facPacList">${pacientes.map(p => `<option value="${escapeAttr(p.nombre)}" data-id="${escapeAttr(p.id)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group"><label class="form-label">Obra Social (opcional)</label>
        <select class="form-select" id="facOS">
          <option value="">—</option>
          ${obras.map(os => `<option value="${escapeAttr(os.id)}">${escapeHtml(os.nombre)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;color:var(--text3);margin:14px 0 8px;text-transform:uppercase">Items</div>
    <div id="facItems" style="display:flex;flex-direction:column;gap:8px"></div>
    <button class="btn btn-ghost btn-sm" id="btnAddItem" style="margin-top:8px">+ Agregar item</button>

    <div style="background:rgba(0,0,0,0.03);border-radius:8px;padding:12px;margin-top:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:700;color:var(--text2)">TOTAL</span>
      <span id="facTotal" style="font-size:20px;font-weight:800;color:var(--sky);font-family:var(--mono)">$0</span>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnEmitir">Emitir factura</button>
    </div>
  `);

  const itemsDiv = modal.querySelector('#facItems');
  let items = [];

  function renderItems() {
    itemsDiv.innerHTML = items.map((it, i) => `
      <div style="display:grid;grid-template-columns:2fr 70px 100px 100px 30px;gap:6px;align-items:center">
        <input class="form-input" data-item-concepto="${i}" placeholder="Concepto" value="${escapeAttr(it.concepto || '')}">
        <input class="form-input" data-item-cant="${i}" type="number" step="0.5" min="1" value="${it.cantidad || 1}" style="text-align:center">
        <input class="form-input" data-item-monto="${i}" type="number" step="0.01" min="0" value="${it.monto || 0}" placeholder="Monto">
        <div style="text-align:right;font-weight:700;font-family:var(--mono);font-size:12px">$${((it.cantidad || 1) * (it.monto || 0)).toLocaleString('es-AR')}</div>
        <button class="btn btn-ghost btn-sm" data-del-item="${i}" style="padding:4px 8px;color:var(--rose)">×</button>
      </div>`).join('');

    const total = items.reduce((s, it) => s + (Number(it.cantidad) || 1) * (Number(it.monto) || 0), 0);
    modal.querySelector('#facTotal').textContent = '$' + total.toLocaleString('es-AR');
  }

  // Autocompletar tarifa al elegir paciente (si tiene cobertura)
  modal.querySelector('#btnAddItem').onclick = () => {
    // Buscar tarifa default Particular o primera disponible
    const tar = tarifas.find(t => !t.obra_social_id) || tarifas[0];
    items.push({
      concepto: tar ? `Sesión ${tar.especialidad}` : 'Consulta',
      cantidad: 1,
      monto: tar?.monto || 0,
    });
    renderItems();
  };

  itemsDiv.addEventListener('input', (ev) => {
    const idx = ev.target.getAttribute('data-item-concepto') || ev.target.getAttribute('data-item-cant') || ev.target.getAttribute('data-item-monto');
    if (idx === null) return;
    const i = parseInt(idx);
    if (!items[i]) return;
    if (ev.target.hasAttribute('data-item-concepto')) items[i].concepto = ev.target.value;
    if (ev.target.hasAttribute('data-item-cant')) items[i].cantidad = parseFloat(ev.target.value) || 1;
    if (ev.target.hasAttribute('data-item-monto')) items[i].monto = parseFloat(ev.target.value) || 0;
    renderItems();
  });

  itemsDiv.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del-item]');
    if (!btn) return;
    items.splice(parseInt(btn.getAttribute('data-del-item')), 1);
    renderItems();
  });

  modal.querySelector('#btnEmitir').onclick = async () => {
    if (items.length === 0) { showToast('⚠️ Agregá al menos un item'); return; }

    const pacNombre = modal.querySelector('#facPac').value.trim();
    const pac = pacientes.find(p => p.nombre === pacNombre);
    const osId = modal.querySelector('#facOS').value || null;
    if (!pac && !osId) { showToast('⚠️ Elegí paciente o OS'); return; }

    const subtotal = items.reduce((s, it) => s + (Number(it.cantidad) || 1) * (Number(it.monto) || 0), 0);
    const { data: { user } } = await supabase.auth.getUser();

    const { data: factura, error } = await supabase.from('facturas').insert([{
      tipo:          modal.querySelector('#facTipo').value,
      paciente_id:   pac?.id || null,
      obra_social_id: osId,
      fecha_emision: modal.querySelector('#facFecha').value,
      subtotal, total: subtotal, saldo: subtotal,
      estado: 'Emitida',
      created_by: user?.id,
    }]).select().single();

    if (error) { showToast(`❌ ${error.message}`); return; }

    const itemsPayload = items.map((it, i) => ({
      factura_id:    factura.id,
      concepto:      it.concepto || 'Item',
      cantidad:      Number(it.cantidad) || 1,
      monto_unitario: Number(it.monto) || 0,
      subtotal:      (Number(it.cantidad) || 1) * (Number(it.monto) || 0),
      orden:         i,
    }));
    await supabase.from('factura_items').insert(itemsPayload);

    showToast(`✅ Factura #${String(factura.numero).padStart(6,'0')} emitida`);
    cerrarModal('modalNuevaFactura');
    const cont = document.getElementById('facContent');
    if (cont) await renderListaFacturas(cont);
    const kpis = document.getElementById('facKPIs');
    if (kpis) await renderKPIsFact(kpis);
  };
}

// ============================================================
//  DETALLE FACTURA + ITEMS + PAGOS
// ============================================================
async function abrirDetalleFactura(id) {
  const { data: f } = await supabase.from('facturas')
    .select('*, pacientes(nombre,dni), obras_sociales(nombre), factura_items(*)')
    .eq('id', id).single();
  const { data: pagos } = await supabase.from('pagos')
    .select('*').eq('factura_id', id).order('fecha', { ascending: false });

  if (!f) return;

  const modal = crearModal('modalDetalleFac', `
    <div class="modal-title">Factura #${String(f.numero).padStart(6,'0')} — ${escapeHtml(f.tipo)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><span style="color:var(--text4);font-size:11px">Destinatario</span><br><strong>${escapeHtml(f.pacientes?.nombre || f.obras_sociales?.nombre || '—')}</strong></div>
      <div><span style="color:var(--text4);font-size:11px">Estado</span><br><span class="badge badge-${ESTADO_COLORS[f.estado]}">${escapeHtml(f.estado)}</span></div>
      <div><span style="color:var(--text4);font-size:11px">Emisión</span><br><strong>${escapeHtml(f.fecha_emision)}</strong></div>
      <div><span style="color:var(--text4);font-size:11px">Total</span><br><strong style="font-family:var(--mono);color:var(--sky)">$${Number(f.total).toLocaleString('es-AR')}</strong></div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Items</div>
    <div class="table-wrap">
      <table><thead><tr><th>Concepto</th><th>Cant</th><th>Unit</th><th>Subtotal</th></tr></thead>
      <tbody>${(f.factura_items || []).map(it => `
        <tr>
          <td>${escapeHtml(it.concepto)}</td>
          <td style="text-align:center">${it.cantidad}</td>
          <td style="font-family:var(--mono)">$${Number(it.monto_unitario).toLocaleString('es-AR')}</td>
          <td style="font-family:var(--mono);font-weight:700">$${Number(it.subtotal).toLocaleString('es-AR')}</td>
        </tr>`).join('')}</tbody></table>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Pagos aplicados</div>
    <div class="table-wrap">
      <table><thead><tr><th>Fecha</th><th>Medio</th><th>Monto</th><th>Referencia</th></tr></thead>
      <tbody>${(pagos || []).length === 0
        ? `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text4)">Sin pagos</td></tr>`
        : pagos.map(p => `
        <tr>
          <td>${escapeHtml(p.fecha)}</td>
          <td><span class="badge badge-emerald">${escapeHtml(p.medio)}</span></td>
          <td style="font-family:var(--mono);font-weight:700;color:var(--emerald)">$${Number(p.monto).toLocaleString('es-AR')}</td>
          <td style="font-size:11px;color:var(--text4)">${escapeHtml(p.referencia || '')}</td>
        </tr>`).join('')}</tbody></table>
    </div>

    <div style="background:rgba(3,105,161,0.05);border-radius:8px;padding:12px;margin-top:14px;display:flex;justify-content:space-between">
      <span>Saldo pendiente</span>
      <strong style="font-family:var(--mono);color:${Number(f.saldo)>0?'var(--rose)':'var(--emerald)'}">$${Number(f.saldo).toLocaleString('es-AR')}</strong>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
      <button class="btn btn-ghost" onclick="window.print()">🖨️ Imprimir</button>
      ${Number(f.saldo) > 0 ? `<button class="btn btn-emerald" id="btnCobrarDet">💵 Registrar Pago</button>` : ''}
    </div>
  `);
  modal.querySelector('.modal').style.width = '680px';

  const btnCob = modal.querySelector('#btnCobrarDet');
  if (btnCob) btnCob.onclick = () => { cerrarModal('modalDetalleFac'); abrirModalPago(id); };
}

// ============================================================
//  REGISTRAR PAGO
// ============================================================
async function abrirModalPago(facturaId) {
  const { data: f } = await supabase.from('facturas')
    .select('*, pacientes(nombre)').eq('id', facturaId).single();
  if (!f) return;

  const modal = crearModal('modalPago', `
    <div class="modal-title">💵 Registrar Pago</div>
    <div style="background:rgba(3,105,161,0.05);border-radius:8px;padding:12px;margin-bottom:14px">
      <div style="font-size:11px;color:var(--text4)">Factura #${String(f.numero).padStart(6,'0')} · ${escapeHtml(f.pacientes?.nombre || '—')}</div>
      <div style="margin-top:4px"><strong>Saldo: <span style="font-family:var(--mono);color:var(--rose)">$${Number(f.saldo).toLocaleString('es-AR')}</span></strong></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Medio *</label>
        <select class="form-select" id="pagoMedio">
          <option>Efectivo</option><option>Transferencia</option><option>Tarjeta Débito</option>
          <option>Tarjeta Crédito</option><option>Mercado Pago</option><option>Modo</option>
          <option>Cheque</option><option>Crédito OS</option><option>Otro</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Monto *</label>
        <input class="form-input" id="pagoMonto" type="number" step="0.01" min="0.01" value="${f.saldo}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fecha</label>
        <input class="form-input" id="pagoFecha" type="date" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="form-group"><label class="form-label">Referencia</label>
        <input class="form-input" id="pagoRef" placeholder="N° operación, cheque, etc.">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Notas</label>
      <input class="form-input" id="pagoNotas">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-emerald" id="btnConfirmPago">Confirmar pago</button>
    </div>
  `);

  modal.querySelector('#btnConfirmPago').onclick = async () => {
    const monto = parseFloat(modal.querySelector('#pagoMonto').value);
    if (!monto || monto <= 0) { showToast('⚠️ Monto inválido'); return; }
    if (monto > Number(f.saldo)) {
      if (!confirm('El monto es mayor al saldo. ¿Continuar?')) return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('pagos').insert([{
      factura_id:  facturaId,
      paciente_id: f.paciente_id,
      fecha:       modal.querySelector('#pagoFecha').value,
      medio:       modal.querySelector('#pagoMedio').value,
      monto,
      referencia:  modal.querySelector('#pagoRef').value.trim() || null,
      notas:       modal.querySelector('#pagoNotas').value.trim() || null,
      created_by:  user?.id,
    }]);

    if (error) { showToast(`❌ ${error.message}`); return; }

    // También registrar en caja si hay caja abierta
    try {
      const { data: caja } = await supabase.from('caja_cierres')
        .select('id').eq('fecha', new Date().toISOString().slice(0,10)).eq('estado','abierta').maybeSingle();
      if (caja) {
        await supabase.from('caja_movimientos').insert([{
          tipo: 'ingreso',
          concepto: `Cobro factura #${String(f.numero).padStart(6,'0')}`,
          monto,
          medio: modal.querySelector('#pagoMedio').value,
          factura_id: facturaId,
          cierre_id: caja.id,
          categoria: 'Cobros',
        }]);
      }
    } catch (e) { /* noop */ }

    showToast('✅ Pago registrado');
    cerrarModal('modalPago');
    const cont = document.getElementById('facContent');
    if (cont) await renderListaFacturas(cont);
    const kpis = document.getElementById('facKPIs');
    if (kpis) await renderKPIsFact(kpis);
  };
}

// ============================================================
//  FACTURAR TURNOS FINALIZADOS (masivo)
// ============================================================
async function facturarTurnosFinalizados() {
  // 1. Traer turnos finalizados
  const { data: turnos, error: errTurnos } = await supabase
    .from('turnos')
    .select('id, pacientes(nombre)')
    .eq('estado', 'Finalizado');

  if (errTurnos) { showToast(`❌ ${errTurnos.message}`); return; }

  // 2. Traer turno_ids ya facturados (subquery no soportada, se filtra en cliente)
  const { data: itemsExistentes } = await supabase
    .from('factura_items')
    .select('turno_id')
    .not('turno_id', 'is', null);

  const yaFacturados = new Set((itemsExistentes || []).map(i => i.turno_id));
  const pendientes = (turnos || []).filter(t => !yaFacturados.has(t.id));

  if (pendientes.length === 0) {
    showToast('✅ No hay turnos finalizados sin facturar');
    return;
  }

  if (!confirm(`¿Facturar ${pendientes.length} turnos finalizados? Se emite un recibo por cada uno.`)) return;

  let ok = 0, errores = 0;
  for (const t of pendientes) {
    const { error } = await supabase.rpc('facturar_turno', { p_turno_id: t.id });
    if (error) { errores++; console.error(error); } else { ok++; }
  }

  showToast(`✅ ${ok} facturas emitidas${errores > 0 ? ` · ⚠️ ${errores} errores` : ''}`);
  const cont = document.getElementById('facContent');
  if (cont) await renderListaFacturas(cont);
  const kpis = document.getElementById('facKPIs');
  if (kpis) await renderKPIsFact(kpis);
}

// ============================================================
//  LISTA DE PAGOS
// ============================================================
async function renderListaPagos(container) {
  const { data, error } = await supabase
    .from('pagos')
    .select(`
      id, fecha, medio, monto, referencia, notas,
      facturas ( numero, tipo ),
      pacientes ( nombre )
    `)
    .order('fecha', { ascending: false })
    .limit(100);

  if (error) { container.innerHTML = escapeHtml(error.message); return; }

  container.innerHTML = `
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Paciente</th><th>Factura</th><th>Medio</th><th>Monto</th><th>Referencia</th></tr></thead>
          <tbody>${(data || []).length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text4)">Sin pagos registrados</td></tr>`
            : data.map(p => `
            <tr>
              <td>${escapeHtml(p.fecha)}</td>
              <td>${escapeHtml(p.pacientes?.nombre || '—')}</td>
              <td style="font-family:var(--mono);font-size:12px">${p.facturas ? `#${String(p.facturas.numero).padStart(6,'0')}` : '—'}</td>
              <td><span class="badge badge-emerald">${escapeHtml(p.medio)}</span></td>
              <td style="font-family:var(--mono);font-weight:700;color:var(--emerald)">$${Number(p.monto).toLocaleString('es-AR')}</td>
              <td style="font-size:11px;color:var(--text4)">${escapeHtml(p.referencia || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================
//  CUENTA CORRIENTE PACIENTES
// ============================================================
async function renderCtaCte(container) {
  const { data, error } = await supabase
    .from('pacientes')
    .select('id, nombre, dni, cobertura')
    .order('nombre');

  if (error) { container.innerHTML = escapeHtml(error.message); return; }

  // Query saldos en batch
  const saldos = {};
  if (data && data.length > 0) {
    for (const p of data) {
      const { data: saldo } = await supabase.rpc('saldo_cta_cte_paciente', { p_paciente_id: p.id });
      saldos[p.id] = Number(saldo) || 0;
    }
  }

  const conDeuda = (data || []).filter(p => saldos[p.id] > 0);
  const sinDeuda = (data || []).filter(p => saldos[p.id] <= 0);

  container.innerHTML = `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0">Pacientes con saldo pendiente (${conDeuda.length})</div>
        <div style="font-family:var(--mono);font-weight:700;color:var(--rose)">
          Total: $${conDeuda.reduce((s,p) => s + saldos[p.id], 0).toLocaleString('es-AR')}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Paciente</th><th>DNI</th><th>Cobertura</th><th>Saldo</th></tr></thead>
          <tbody>${conDeuda.length === 0
            ? `<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--emerald)">✅ Todos los pacientes al día</td></tr>`
            : conDeuda.map(p => `
            <tr>
              <td style="font-weight:700">${escapeHtml(p.nombre)}</td>
              <td style="font-family:var(--mono);font-size:12px">${escapeHtml(p.dni || '—')}</td>
              <td style="font-size:12px">${escapeHtml(p.cobertura)}</td>
              <td style="font-family:var(--mono);font-weight:700;color:var(--rose)">$${saldos[p.id].toLocaleString('es-AR')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
