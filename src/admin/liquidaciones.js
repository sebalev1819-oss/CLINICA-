// ============================================================
//  RehabMed ERP — Módulo Liquidaciones de Profesionales
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

const ESTADO_COLORS = {
  'Borrador':  'amber',
  'Cerrada':   'sky',
  'Pagada':    'emerald',
  'Anulada':   'slate',
};

export async function renderLiquidaciones(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <div class="page-title">💼 Liquidaciones de Profesionales</div>
        <div class="page-sub">Comisiones por sesión finalizada · Período configurable</div>
      </div>
      <button class="btn btn-sky" id="btnNuevaLiq">+ Generar liquidación</button>
    </div>

    <div id="liqList"></div>
  `;

  container.querySelector('#btnNuevaLiq').onclick = () => abrirModalGenerar();
  await renderListaLiquidaciones(container.querySelector('#liqList'));
}

async function renderListaLiquidaciones(container) {
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('*, profesionales ( nombre, iniciales, especialidad )')
    .order('periodo_hasta', { ascending: false })
    .limit(50);

  if (error) { container.innerHTML = escapeHtml(error.message); return; }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="card card-pad" style="text-align:center;padding:50px">
        <div style="font-size:40px;margin-bottom:12px">📑</div>
        <div style="font-size:14px;font-weight:700;color:var(--text3)">Sin liquidaciones generadas</div>
        <div style="font-size:12px;color:var(--text4);margin-top:4px">Apretá "Generar liquidación" para crear la primera</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="card card-pad">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Profesional</th><th>Período</th><th>Sesiones</th><th>Bruto</th><th>Comisión</th><th>Neto</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody id="liqTbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tb = container.querySelector('#liqTbody');
  tb.innerHTML = data.map(l => {
    const prof = l.profesionales;
    return `
      <tr data-liq="${escapeAttr(l.id)}" style="cursor:pointer">
        <td>
          <div style="font-weight:700">${escapeHtml(prof?.nombre || '—')}</div>
          <div style="font-size:10px;color:var(--text4)">${escapeHtml(prof?.especialidad || '')}</div>
        </td>
        <td style="font-size:12px">${escapeHtml(l.periodo_desde)} → ${escapeHtml(l.periodo_hasta)}</td>
        <td style="text-align:center;font-weight:700">${l.total_sesiones}</td>
        <td style="font-family:var(--mono)">$${Number(l.total_bruto).toLocaleString('es-AR')}</td>
        <td>${l.comision_pct}%</td>
        <td style="font-family:var(--mono);font-weight:700;color:var(--emerald)">$${Number(l.total_neto).toLocaleString('es-AR')}</td>
        <td><span class="badge badge-${ESTADO_COLORS[l.estado]}">${escapeHtml(l.estado)}</span></td>
        <td style="text-align:right">
          ${l.estado === 'Borrador' ? `<button class="btn btn-emerald btn-sm" data-pagar="${escapeAttr(l.id)}">💵 Pagar</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  tb.onclick = async (ev) => {
    const pagarBtn = ev.target.closest('[data-pagar]');
    if (pagarBtn) {
      ev.stopPropagation();
      await abrirModalPagarLiq(pagarBtn.getAttribute('data-pagar'));
      return;
    }
    const fila = ev.target.closest('[data-liq]');
    if (fila) await abrirDetalleLiq(fila.getAttribute('data-liq'));
  };
}

async function abrirModalGenerar() {
  const { data: profes } = await supabase
    .from('profesionales').select('id, nombre, especialidad').eq('activo', true).order('nombre');

  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10);

  const modal = crearModal('modalGenerarLiq', `
    <div class="modal-title">Generar Liquidación</div>
    <div class="form-group"><label class="form-label">Profesional *</label>
      <select class="form-select" id="liqProf">
        <option value="">Seleccionar...</option>
        ${(profes || []).map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.nombre)} · ${escapeHtml(p.especialidad)}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Desde *</label>
        <input class="form-input" id="liqDesde" type="date" value="${primerDiaMes}">
      </div>
      <div class="form-group"><label class="form-label">Hasta *</label>
        <input class="form-input" id="liqHasta" type="date" value="${hoy.toISOString().slice(0,10)}">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Comisión del profesional (%) *</label>
      <input class="form-input" id="liqComision" type="number" step="0.01" min="0" max="100" value="60">
      <div style="font-size:11px;color:var(--text4);margin-top:4px">
        Porcentaje que le toca al profesional sobre el valor bruto.
        Ej: 60% si la clínica retiene 40%.
      </div>
    </div>
    <div style="background:rgba(3,105,161,0.05);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text2);margin-bottom:14px">
      ℹ️ Se incluyen automáticamente todos los turnos en estado <strong>Finalizado</strong>
      del profesional en ese período. Cada sesión usa la tarifa vigente de la especialidad.
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGenerar">Generar</button>
    </div>
  `);

  modal.querySelector('#btnGenerar').onclick = async () => {
    const profId = modal.querySelector('#liqProf').value;
    if (!profId) { showToast('⚠️ Elegí un profesional'); return; }

    const { data, error } = await supabase.rpc('generar_liquidacion', {
      p_profesional_id: profId,
      p_desde: modal.querySelector('#liqDesde').value,
      p_hasta: modal.querySelector('#liqHasta').value,
      p_comision_pct: parseFloat(modal.querySelector('#liqComision').value) || 60,
    });

    if (error) { showToast(`❌ ${error.message}`); return; }
    showToast(`✅ Liquidación generada — ${data.total_sesiones} sesiones · $${Number(data.total_neto).toLocaleString('es-AR')}`);
    cerrarModal('modalGenerarLiq');
    const cont = document.getElementById('liqList');
    if (cont) await renderListaLiquidaciones(cont);
  };
}

async function abrirDetalleLiq(id) {
  const { data: liq } = await supabase
    .from('liquidaciones')
    .select('*, profesionales(nombre, especialidad), liquidacion_items(*)')
    .eq('id', id).single();
  if (!liq) return;

  const items = liq.liquidacion_items || [];

  const modal = crearModal('modalDetalleLiq', `
    <div class="modal-title">Liquidación — ${escapeHtml(liq.profesionales?.nombre || '')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><span style="color:var(--text4);font-size:11px">Período</span><br><strong>${escapeHtml(liq.periodo_desde)} → ${escapeHtml(liq.periodo_hasta)}</strong></div>
      <div><span style="color:var(--text4);font-size:11px">Estado</span><br><span class="badge badge-${ESTADO_COLORS[liq.estado]}">${escapeHtml(liq.estado)}</span></div>
      <div><span style="color:var(--text4);font-size:11px">Sesiones</span><br><strong>${liq.total_sesiones}</strong></div>
      <div><span style="color:var(--text4);font-size:11px">Comisión</span><br><strong>${liq.comision_pct}%</strong></div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Detalle de sesiones</div>
    <div class="table-wrap" style="max-height:280px;overflow-y:auto">
      <table>
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Cant</th><th>Unit</th><th>Subtotal</th></tr></thead>
        <tbody>${items.length === 0
          ? `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text4)">Sin sesiones</td></tr>`
          : items.map(it => `
          <tr>
            <td>${escapeHtml(it.fecha)}</td>
            <td style="font-size:12px">${escapeHtml(it.concepto)}</td>
            <td style="text-align:center">${it.cantidad}</td>
            <td style="font-family:var(--mono);font-size:12px">$${Number(it.monto_unitario).toLocaleString('es-AR')}</td>
            <td style="font-family:var(--mono);font-weight:700">$${Number(it.subtotal).toLocaleString('es-AR')}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>

    <div style="background:rgba(5,150,105,0.05);border-radius:8px;padding:14px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>Bruto</span><strong style="font-family:var(--mono)">$${Number(liq.total_bruto).toLocaleString('es-AR')}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>Descuentos</span><strong style="font-family:var(--mono);color:var(--rose)">-$${Number(liq.total_descuentos).toLocaleString('es-AR')}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)">
        <strong>NETO A PAGAR</strong>
        <strong style="font-family:var(--mono);font-size:18px;color:var(--emerald)">$${Number(liq.total_neto).toLocaleString('es-AR')}</strong>
      </div>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
      <button class="btn btn-ghost" onclick="window.print()">🖨️ Imprimir</button>
      ${liq.estado === 'Borrador' ? `<button class="btn btn-emerald" id="btnPagarDet">💵 Marcar como pagada</button>` : ''}
    </div>
  `);
  modal.querySelector('.modal').style.width = '700px';

  const btnPagar = modal.querySelector('#btnPagarDet');
  if (btnPagar) btnPagar.onclick = () => { cerrarModal('modalDetalleLiq'); abrirModalPagarLiq(id); };
}

async function abrirModalPagarLiq(id) {
  const modal = crearModal('modalPagarLiq', `
    <div class="modal-title">💵 Pagar Liquidación</div>
    <div class="form-group"><label class="form-label">Medio de pago *</label>
      <select class="form-select" id="liqMedio">
        <option>Transferencia</option><option>Efectivo</option><option>Cheque</option>
        <option>Mercado Pago</option><option>Otro</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Observaciones</label>
      <textarea class="form-input" id="liqObs" rows="2"></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-emerald" id="btnConfirmPagarLiq">Confirmar pago</button>
    </div>
  `);

  modal.querySelector('#btnConfirmPagarLiq').onclick = async () => {
    const { data: liq } = await supabase.from('liquidaciones').select('total_neto, profesionales(nombre)').eq('id', id).single();

    const { error } = await supabase.from('liquidaciones')
      .update({
        estado: 'Pagada',
        pagado_at: new Date().toISOString(),
        medio_pago: modal.querySelector('#liqMedio').value,
        observaciones: modal.querySelector('#liqObs').value.trim() || null,
      })
      .eq('id', id);

    if (error) { showToast(`❌ ${error.message}`); return; }

    // Registrar el pago como egreso de caja si hay caja abierta
    try {
      const { data: caja } = await supabase.from('caja_cierres')
        .select('id').eq('fecha', new Date().toISOString().slice(0,10)).eq('estado','abierta').maybeSingle();
      if (caja && liq) {
        await supabase.from('caja_movimientos').insert([{
          tipo: 'egreso',
          concepto: `Liquidación ${liq.profesionales?.nombre || ''}`,
          monto: liq.total_neto,
          medio: modal.querySelector('#liqMedio').value,
          categoria: 'Sueldos',
          cierre_id: caja.id,
        }]);
      }
    } catch (e) { /* noop */ }

    showToast('✅ Liquidación pagada');
    cerrarModal('modalPagarLiq');
    const cont = document.getElementById('liqList');
    if (cont) await renderListaLiquidaciones(cont);
  };
}
