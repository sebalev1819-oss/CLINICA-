// ============================================================
//  RehabMed ERP — Módulo Caja
//  Apertura, movimientos, cierre con arqueo y diferencias
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

export async function renderCaja(container) {
  if (!container) return;

  const hoy = new Date().toISOString().slice(0, 10);

  // Estado de caja hoy
  const { data: cajaHoy } = await supabase
    .from('caja_cierres')
    .select('*')
    .eq('fecha', hoy)
    .order('apertura_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <div class="page-title">💼 Caja Diaria</div>
        <div class="page-sub">Apertura, movimientos, arqueo y cierre</div>
      </div>
      <div id="cajaAcciones"></div>
    </div>

    <div id="cajaEstado"></div>
    <div id="cajaMovs"></div>
  `;

  const accionesDiv = container.querySelector('#cajaAcciones');
  const estadoDiv = container.querySelector('#cajaEstado');
  const movsDiv = container.querySelector('#cajaMovs');

  if (!cajaHoy || cajaHoy.estado === 'cerrada') {
    // No hay caja abierta hoy
    accionesDiv.innerHTML = `<button class="btn btn-sky" id="btnAbrirCaja">🔓 Abrir Caja</button>`;
    estadoDiv.innerHTML = `
      <div class="card card-pad" style="text-align:center;padding:40px">
        <div style="font-size:48px;margin-bottom:12px">🔒</div>
        <div style="font-size:15px;font-weight:700;color:var(--text2)">
          ${cajaHoy ? 'Caja cerrada hoy' : 'Caja sin abrir'}
        </div>
        <div style="font-size:12px;color:var(--text4);margin-top:6px">
          ${cajaHoy ? `Cerrada a las ${new Date(cajaHoy.cierre_at).toLocaleTimeString('es-AR')} con saldo real $${Number(cajaHoy.saldo_real||0).toLocaleString('es-AR')}` : 'Abrí la caja para registrar movimientos'}
        </div>
      </div>`;
    container.querySelector('#btnAbrirCaja').onclick = () => abrirModalApertura();

    if (cajaHoy) await renderMovimientosCaja(movsDiv, cajaHoy.id, true);
    else await renderMovimientosHistoricos(movsDiv);
    return;
  }

  // Hay caja abierta
  accionesDiv.innerHTML = `
    <button class="btn btn-ghost" id="btnNuevoMov">+ Movimiento</button>
    <button class="btn btn-rose" id="btnCerrarCaja">🔒 Cerrar Caja</button>
  `;

  // Calcular totales
  const { data: movs } = await supabase
    .from('caja_movimientos')
    .select('tipo, monto, medio')
    .eq('cierre_id', cajaHoy.id);

  const totales = { ingreso: 0, egreso: 0, efectivo: 0, otros: 0 };
  (movs || []).forEach(m => {
    if (m.tipo === 'ingreso') totales.ingreso += Number(m.monto);
    else if (m.tipo === 'egreso') totales.egreso += Number(m.monto);
    if (m.medio === 'Efectivo') totales.efectivo += (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto));
  });

  const saldoTeorico = Number(cajaHoy.saldo_inicial) + totales.ingreso - totales.egreso;

  estadoDiv.innerHTML = `
    <div class="grid-4">
      <div class="stat-card" data-color="sky">
        <div class="stat-label">SALDO INICIAL</div>
        <div class="stat-value">$${Number(cajaHoy.saldo_inicial).toLocaleString('es-AR')}</div>
        <div class="stat-footer"><span class="stat-desc">apertura ${new Date(cajaHoy.apertura_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</span></div>
      </div>
      <div class="stat-card" data-color="emerald">
        <div class="stat-label">INGRESOS</div>
        <div class="stat-value">$${totales.ingreso.toLocaleString('es-AR')}</div>
        <div class="stat-footer"><span class="stat-desc">${(movs || []).filter(m=>m.tipo==='ingreso').length} movimientos</span></div>
      </div>
      <div class="stat-card" data-color="rose">
        <div class="stat-label">EGRESOS</div>
        <div class="stat-value">$${totales.egreso.toLocaleString('es-AR')}</div>
        <div class="stat-footer"><span class="stat-desc">${(movs || []).filter(m=>m.tipo==='egreso').length} movimientos</span></div>
      </div>
      <div class="stat-card" data-color="violet">
        <div class="stat-label">SALDO TEÓRICO</div>
        <div class="stat-value">$${saldoTeorico.toLocaleString('es-AR')}</div>
        <div class="stat-footer"><span class="stat-desc">efectivo: $${totales.efectivo.toLocaleString('es-AR')}</span></div>
      </div>
    </div>
  `;

  container.querySelector('#btnNuevoMov').onclick = () => abrirModalMovimiento(cajaHoy.id);
  container.querySelector('#btnCerrarCaja').onclick = () => abrirModalCierre(cajaHoy.id, saldoTeorico);

  await renderMovimientosCaja(movsDiv, cajaHoy.id, false);
}

// ============================================================
//  MODAL: ABRIR CAJA
// ============================================================
function abrirModalApertura() {
  const modal = crearModal('modalAbrirCaja', `
    <div class="modal-title">🔓 Abrir Caja del Día</div>
    <div class="form-group">
      <label class="form-label">Saldo inicial en efectivo</label>
      <input class="form-input" id="saldoInicial" type="number" step="0.01" min="0" value="0">
      <div style="font-size:11px;color:var(--text4);margin-top:4px">Suele ser 0 o el cambio que dejaste ayer</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnConfirmAbrir">Abrir</button>
    </div>
  `);

  modal.querySelector('#btnConfirmAbrir').onclick = async () => {
    const saldo = parseFloat(modal.querySelector('#saldoInicial').value) || 0;
    const { error } = await supabase.rpc('abrir_caja', { p_saldo_inicial: saldo });
    if (error) { showToast(`❌ ${error.message}`); return; }
    showToast('✅ Caja abierta');
    cerrarModal('modalAbrirCaja');
    const cont = document.getElementById('mod-caja-container');
    if (cont) await renderCaja(cont);
  };
}

// ============================================================
//  MODAL: NUEVO MOVIMIENTO
// ============================================================
function abrirModalMovimiento(cierreId) {
  const modal = crearModal('modalMovimiento', `
    <div class="modal-title">+ Nuevo Movimiento</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo *</label>
        <select class="form-select" id="movTipo">
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Medio *</label>
        <select class="form-select" id="movMedio">
          <option>Efectivo</option><option>Transferencia</option><option>Tarjeta Débito</option>
          <option>Tarjeta Crédito</option><option>Mercado Pago</option><option>Modo</option><option>Otro</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto *</label>
        <input class="form-input" id="movMonto" type="number" step="0.01" min="0.01">
      </div>
      <div class="form-group"><label class="form-label">Categoría</label>
        <select class="form-select" id="movCategoria">
          <option value="">—</option>
          <option>Cobros</option><option>Consultas</option><option>Sueldos</option>
          <option>Insumos</option><option>Servicios</option><option>Alquiler</option>
          <option>Impuestos</option><option>Varios</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Concepto *</label>
      <input class="form-input" id="movConcepto" placeholder="Descripción del movimiento">
    </div>
    <div class="form-group"><label class="form-label">Referencia</label>
      <input class="form-input" id="movRef" placeholder="N° de comprobante, transferencia, etc.">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarMov">Registrar</button>
    </div>
  `);

  modal.querySelector('#btnGuardarMov').onclick = async () => {
    const monto = parseFloat(modal.querySelector('#movMonto').value);
    const concepto = modal.querySelector('#movConcepto').value.trim();
    if (!monto || monto <= 0 || !concepto) { showToast('⚠️ Monto y concepto obligatorios'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('caja_movimientos').insert([{
      tipo:      modal.querySelector('#movTipo').value,
      medio:     modal.querySelector('#movMedio').value,
      monto,
      concepto,
      categoria: modal.querySelector('#movCategoria').value || null,
      referencia: modal.querySelector('#movRef').value.trim() || null,
      cierre_id: cierreId,
      created_by: user?.id,
    }]);

    if (error) { showToast(`❌ ${error.message}`); return; }
    showToast('✅ Movimiento registrado');
    cerrarModal('modalMovimiento');
    const cont = document.getElementById('mod-caja-container');
    if (cont) await renderCaja(cont);
  };
}

// ============================================================
//  MODAL: CERRAR CAJA
// ============================================================
function abrirModalCierre(cierreId, saldoTeorico) {
  const modal = crearModal('modalCerrarCaja', `
    <div class="modal-title">🔒 Cerrar Caja del Día</div>
    <div style="background:rgba(3,105,161,0.05);border-radius:8px;padding:14px;margin-bottom:14px">
      <div style="font-size:11px;color:var(--text4);text-transform:uppercase">Saldo teórico</div>
      <div style="font-size:22px;font-weight:800;color:var(--sky);font-family:var(--mono)">$${saldoTeorico.toLocaleString('es-AR')}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Saldo real contado en caja *</label>
      <input class="form-input" id="saldoReal" type="number" step="0.01" placeholder="Monto contado">
      <div style="font-size:11px;color:var(--text4);margin-top:4px">Contá el efectivo físicamente. Si hay diferencia se registra.</div>
    </div>
    <div class="form-group"><label class="form-label">Observaciones</label>
      <textarea class="form-input" id="cierreObs" rows="2" placeholder="Notas del cierre..."></textarea>
    </div>
    <div id="cierreDiff"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-rose" id="btnConfirmarCierre">Confirmar cierre</button>
    </div>
  `);

  modal.querySelector('#saldoReal').addEventListener('input', (ev) => {
    const real = parseFloat(ev.target.value) || 0;
    const diff = real - saldoTeorico;
    const diffDiv = modal.querySelector('#cierreDiff');
    if (diff === 0) {
      diffDiv.innerHTML = `<div style="background:rgba(5,150,105,0.08);color:var(--emerald);padding:10px;border-radius:8px;text-align:center">✓ Saldo cuadra exactamente</div>`;
    } else if (diff > 0) {
      diffDiv.innerHTML = `<div style="background:rgba(217,119,6,0.08);color:var(--amber);padding:10px;border-radius:8px;text-align:center">Sobra $${diff.toLocaleString('es-AR')}</div>`;
    } else {
      diffDiv.innerHTML = `<div style="background:rgba(244,63,94,0.08);color:var(--rose);padding:10px;border-radius:8px;text-align:center">Falta $${Math.abs(diff).toLocaleString('es-AR')}</div>`;
    }
  });

  modal.querySelector('#btnConfirmarCierre').onclick = async () => {
    const real = parseFloat(modal.querySelector('#saldoReal').value);
    if (isNaN(real)) { showToast('⚠️ Ingresá el saldo real'); return; }

    const obs = modal.querySelector('#cierreObs').value.trim() || null;
    const { error } = await supabase.rpc('cerrar_caja', {
      p_cierre_id: cierreId, p_saldo_real: real, p_obs: obs,
    });

    if (error) { showToast(`❌ ${error.message}`); return; }
    showToast('✅ Caja cerrada');
    cerrarModal('modalCerrarCaja');
    const cont = document.getElementById('mod-caja-container');
    if (cont) await renderCaja(cont);
  };
}

// ============================================================
//  MOVIMIENTOS DEL DÍA
// ============================================================
async function renderMovimientosCaja(container, cierreId, readonly) {
  const { data } = await supabase
    .from('caja_movimientos')
    .select('*, profiles(nombre)')
    .eq('cierre_id', cierreId)
    .order('fecha', { ascending: false });

  container.innerHTML = `
    <div class="card card-pad" style="margin-top:14px">
      <div class="card-title">Movimientos ${readonly ? '(cerrada)' : 'en curso'}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Categoría</th><th>Medio</th><th>Monto</th><th>Usuario</th></tr></thead>
          <tbody>${(data || []).length === 0
            ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text4)">Sin movimientos</td></tr>`
            : data.map(m => `
            <tr>
              <td style="font-family:var(--mono);font-size:11px">${new Date(m.fecha).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</td>
              <td><span class="badge badge-${m.tipo === 'ingreso' ? 'emerald' : m.tipo === 'egreso' ? 'rose' : 'slate'}">${escapeHtml(m.tipo)}</span></td>
              <td>${escapeHtml(m.concepto)}</td>
              <td style="font-size:11px;color:var(--text3)">${escapeHtml(m.categoria || '')}</td>
              <td style="font-size:11px">${escapeHtml(m.medio || '')}</td>
              <td style="font-family:var(--mono);font-weight:700;color:${m.tipo === 'ingreso' ? 'var(--emerald)' : m.tipo === 'egreso' ? 'var(--rose)' : 'var(--text2)'}">
                ${m.tipo === 'egreso' ? '-' : ''}$${Number(m.monto).toLocaleString('es-AR')}
              </td>
              <td style="font-size:11px;color:var(--text4)">${escapeHtml(m.profiles?.nombre || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Caja cerrada: ver histórico
async function renderMovimientosHistoricos(container) {
  const { data } = await supabase
    .from('caja_cierres')
    .select('*, profiles(nombre)')
    .order('fecha', { ascending: false })
    .limit(30);

  container.innerHTML = `
    <div class="card card-pad" style="margin-top:14px">
      <div class="card-title">Histórico de cierres</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Inicial</th><th>Ingresos</th><th>Egresos</th><th>Teórico</th><th>Real</th><th>Dif</th></tr></thead>
          <tbody>${(data || []).length === 0
            ? `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text4)">Sin cierres aún</td></tr>`
            : data.map(c => `
            <tr>
              <td>${escapeHtml(c.fecha)}</td>
              <td style="font-size:11px">${escapeHtml(c.profiles?.nombre || '—')}</td>
              <td style="font-family:var(--mono);font-size:12px">$${Number(c.saldo_inicial).toLocaleString('es-AR')}</td>
              <td style="font-family:var(--mono);font-size:12px;color:var(--emerald)">$${Number(c.total_ingresos||0).toLocaleString('es-AR')}</td>
              <td style="font-family:var(--mono);font-size:12px;color:var(--rose)">$${Number(c.total_egresos||0).toLocaleString('es-AR')}</td>
              <td style="font-family:var(--mono);font-size:12px">$${Number(c.saldo_teorico||0).toLocaleString('es-AR')}</td>
              <td style="font-family:var(--mono);font-size:12px;font-weight:700">$${Number(c.saldo_real||0).toLocaleString('es-AR')}</td>
              <td style="font-family:var(--mono);font-size:12px;color:${Number(c.diferencia||0) === 0 ? 'var(--emerald)' : 'var(--rose)'}">
                ${Number(c.diferencia||0) === 0 ? '0' : (Number(c.diferencia) > 0 ? '+' : '') + Number(c.diferencia).toLocaleString('es-AR')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
