// ============================================================
//  RehabMed ERP — Menú contextual (click derecho) sobre rows
//  Usable en: pacientes, profesionales, turnos, facturas, etc.
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';
import { abrirConfigHorarios, abrirExcepciones } from './horarios.js';

let _menuActivo = null;

// ============================================================
//  UI: menú contextual
// ============================================================
function cerrarMenu() {
  if (_menuActivo) {
    _menuActivo.remove();
    _menuActivo = null;
  }
}

function abrirMenu(x, y, opciones) {
  cerrarMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = `
    position:fixed;left:${x}px;top:${y}px;z-index:9999;
    background:var(--bg3);border:1px solid var(--border2);border-radius:10px;
    box-shadow:var(--shadow-lg);padding:6px;min-width:220px;
    animation:ctxMenuIn 0.12s ease;
  `;
  menu.innerHTML = opciones.map((op, i) => {
    if (op.separator) return `<div style="height:1px;background:var(--border);margin:4px 0"></div>`;
    const disabled = op.disabled ? 'opacity:0.4;cursor:not-allowed' : 'cursor:pointer';
    return `
      <button data-ctx-idx="${i}" ${op.disabled ? 'disabled' : ''} style="
        display:flex;align-items:center;gap:10px;width:100%;
        padding:8px 12px;border:none;background:transparent;text-align:left;
        font-family:var(--font);font-size:13px;color:var(--text2);border-radius:6px;
        ${disabled}
        transition:background 0.1s;
      " onmouseover="this.style.background='rgba(3,105,161,0.08)'" onmouseout="this.style.background='transparent'">
        <span style="width:16px;text-align:center;font-size:13px">${op.icon || ''}</span>
        <span>${escapeHtml(op.label)}</span>
        ${op.hint ? `<span style="margin-left:auto;font-size:10px;color:var(--text4)">${escapeHtml(op.hint)}</span>` : ''}
      </button>`;
  }).join('');

  document.body.appendChild(menu);
  _menuActivo = menu;

  // Reposicionar si se sale de la pantalla
  setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  }, 0);

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-ctx-idx]');
    if (!btn || btn.disabled) return;
    const op = opciones[parseInt(btn.getAttribute('data-ctx-idx'))];
    cerrarMenu();
    if (op.action) op.action();
  });
}

// Cerrar menú al clickear afuera o hacer scroll/resize
document.addEventListener('click', (ev) => {
  if (_menuActivo && !_menuActivo.contains(ev.target)) cerrarMenu();
});
document.addEventListener('scroll', cerrarMenu, true);
window.addEventListener('resize', cerrarMenu);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarMenu(); });

// Agregar animación CSS
if (!document.getElementById('ctxMenuStyles')) {
  const st = document.createElement('style');
  st.id = 'ctxMenuStyles';
  st.textContent = `
    @keyframes ctxMenuIn { from { opacity:0; transform:translateY(-4px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }
  `;
  document.head.appendChild(st);
}

// ============================================================
//  ACCIONES sobre paciente
// ============================================================

async function verHistorialTurnos(pacId) {
  const { data: turnos } = await supabase
    .from('v_turnos_dia')
    .select('*')
    .eq('paciente_id', pacId)
    .order('fecha', { ascending: false })
    .order('hora', { ascending: false })
    .limit(50);

  const { data: pac } = await supabase.from('pacientes').select('nombre').eq('id', pacId).single();

  const modal = crearModal('modalHistTurnos', `
    <div class="modal-title">📅 Historial de turnos — ${escapeHtml(pac?.nombre || '')}</div>
    <div class="table-wrap" style="max-height:500px;overflow-y:auto">
      <table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>Profesional</th><th>Especialidad</th><th>Estado</th></tr></thead>
        <tbody>${(turnos || []).length === 0
          ? `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text4)">Sin turnos registrados</td></tr>`
          : turnos.map(t => `
          <tr>
            <td>${escapeHtml(t.fecha)}</td>
            <td style="font-family:var(--mono)">${String(t.hora).slice(0,5)}</td>
            <td>${escapeHtml(t.prof_nombre || '—')}</td>
            <td style="font-size:12px;color:var(--text3)">${escapeHtml(t.especialidad)}</td>
            <td><span class="badge badge-${
              t.estado === 'Finalizado' ? 'emerald' :
              t.estado === 'Confirmado' ? 'sky' :
              t.estado === 'No Show' ? 'rose' :
              t.estado === 'Cancelado' ? 'slate' : 'amber'
            }">${escapeHtml(t.estado)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
      <button class="btn btn-ghost" onclick="window.print()">🖨️ Imprimir</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '780px';
}

async function verProximosTurnos(pacId) {
  const hoy = new Date().toISOString().slice(0,10);
  const { data: turnos } = await supabase
    .from('v_turnos_dia')
    .select('*')
    .eq('paciente_id', pacId)
    .gte('fecha', hoy)
    .in('estado', ['Pendiente','Confirmado','En curso','Lista espera'])
    .order('fecha').order('hora');

  const { data: pac } = await supabase.from('pacientes').select('nombre').eq('id', pacId).single();

  const modal = crearModal('modalProxTurnos', `
    <div class="modal-title">📆 Próximos turnos — ${escapeHtml(pac?.nombre || '')}</div>
    ${(turnos || []).length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--text4)">
           <div style="font-size:40px;margin-bottom:8px">📭</div>
           Sin turnos futuros agendados
         </div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${turnos.map(t => `
            <div style="display:flex;align-items:center;gap:14px;padding:12px 14px;background:rgba(3,105,161,0.05);border-radius:10px">
              <div style="font-family:var(--mono);font-weight:800;color:var(--sky)">${escapeHtml(t.fecha)} ${String(t.hora).slice(0,5)}</div>
              <div style="flex:1">
                <div style="font-weight:700">${escapeHtml(t.prof_nombre || '—')}</div>
                <div style="font-size:11px;color:var(--text3)">${escapeHtml(t.especialidad)} · Consultorio ${t.consultorio_id}</div>
              </div>
              <span class="badge badge-${t.estado === 'Confirmado' ? 'emerald' : 'amber'}">${escapeHtml(t.estado)}</span>
            </div>`).join('')}
        </div>`}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
    </div>
  `);
}

async function verCtaCte(pacId) {
  const [facturasR, pagosR, saldoR, pacR] = await Promise.all([
    supabase.from('facturas')
      .select('id, numero, tipo, fecha_emision, total, saldo, estado')
      .eq('paciente_id', pacId)
      .order('fecha_emision', { ascending: false }),
    supabase.from('pagos')
      .select('id, fecha, medio, monto, referencia, facturas(numero)')
      .eq('paciente_id', pacId)
      .order('fecha', { ascending: false }),
    supabase.rpc('saldo_cta_cte_paciente', { p_paciente_id: pacId }),
    supabase.from('pacientes').select('nombre').eq('id', pacId).single(),
  ]);

  const facturas = facturasR.data || [];
  const pagos = pagosR.data || [];
  const saldo = Number(saldoR.data) || 0;
  const nombre = pacR.data?.nombre || '';

  const modal = crearModal('modalCtaCte', `
    <div class="modal-title">💰 Cuenta corriente — ${escapeHtml(nombre)}</div>

    <div style="background:${saldo > 0 ? 'rgba(244,63,94,0.08)' : 'rgba(5,150,105,0.08)'};border-radius:10px;padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;color:var(--text3);text-transform:uppercase">Saldo actual</span>
      <strong style="font-family:var(--mono);font-size:22px;color:${saldo > 0 ? 'var(--rose)' : 'var(--emerald)'}">
        $${saldo.toLocaleString('es-AR')}
      </strong>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 8px">Facturas</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto">
      <table>
        <thead><tr><th>N°</th><th>Fecha</th><th>Total</th><th>Saldo</th><th>Estado</th></tr></thead>
        <tbody>${facturas.length === 0
          ? `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text4)">Sin facturas</td></tr>`
          : facturas.map(f => `
          <tr>
            <td style="font-family:var(--mono);font-size:12px">#${String(f.numero).padStart(6,'0')}</td>
            <td style="font-size:12px">${escapeHtml(f.fecha_emision)}</td>
            <td style="font-family:var(--mono)">$${Number(f.total).toLocaleString('es-AR')}</td>
            <td style="font-family:var(--mono);color:${Number(f.saldo) > 0 ? 'var(--rose)' : 'var(--emerald)'}">$${Number(f.saldo).toLocaleString('es-AR')}</td>
            <td><span class="badge badge-${
              f.estado === 'Pagada' ? 'emerald' :
              f.estado === 'Parcial' ? 'violet' :
              f.estado === 'Vencida' ? 'rose' : 'sky'
            }">${escapeHtml(f.estado)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 8px">Pagos</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto">
      <table>
        <thead><tr><th>Fecha</th><th>Factura</th><th>Medio</th><th>Monto</th><th>Referencia</th></tr></thead>
        <tbody>${pagos.length === 0
          ? `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text4)">Sin pagos registrados</td></tr>`
          : pagos.map(p => `
          <tr>
            <td style="font-size:12px">${escapeHtml(p.fecha)}</td>
            <td style="font-family:var(--mono);font-size:12px">${p.facturas ? '#'+String(p.facturas.numero).padStart(6,'0') : '—'}</td>
            <td><span class="badge badge-emerald">${escapeHtml(p.medio)}</span></td>
            <td style="font-family:var(--mono);font-weight:700;color:var(--emerald)">$${Number(p.monto).toLocaleString('es-AR')}</td>
            <td style="font-size:11px;color:var(--text4)">${escapeHtml(p.referencia || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
      <button class="btn btn-ghost" onclick="window.print()">🖨️ Imprimir</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '780px';
}

async function editarPaciente(pacId) {
  // Abre el modal nuevoPaciente pre-poblado con los datos
  const { data: p } = await supabase.from('pacientes').select('*').eq('id', pacId).single();
  if (!p) return;

  if (typeof window.openModal === 'function') window.openModal('modalNuevoPaciente');

  // Popular los campos
  setTimeout(() => {
    const [nombre, ...apellidoParts] = (p.nombre || '').split(' ');
    const apellido = apellidoParts.join(' ');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };

    set('pacNombre', nombre);
    set('pacApellido', apellido);
    set('pacDNI', p.dni);
    set('pacFechaNac', p.fecha_nacimiento);
    set('pacGenero', p.genero);
    set('pacEstCivil', p.estado_civil);
    set('pacTel', p.telefono);
    set('pacTel2', p.telefono_secundario);
    set('pacEmail', p.email);
    set('pacDir', p.direccion);
    set('pacOcupacion', p.ocupacion);
    set('pacNacionalidad', p.nacionalidad);
    set('pacCob', p.cobertura);
    set('pacAfiliado', p.numero_afiliado);
    set('pacPlan', p.plan_cobertura);
    set('pacDiag', p.diagnostico);
    set('pacDiag2', p.diagnostico_secundario);
    set('pacEsp', p.especialidad_derivada);
    set('pacMedDer', p.medico_derivante);
    set('pacMedMat', p.matricula_derivante);
    set('pacSesiones', p.sesiones_autorizadas);
    set('pacSangre', p.grupo_sanguineo);
    set('pacAlergias', p.alergias);
    set('pacMedicacion', p.medicacion);
    set('pacCirugias', p.cirugias);
    set('pacCronicas', p.cronicas);
    set('pacEmergNombre', p.emerg_nombre);
    set('pacEmergRel', p.emerg_relacion);
    set('pacEmergTel', p.emerg_telefono);
    set('pacObs', p.observaciones);
    set('pacMotivo', p.motivo_consulta);

    // Guardar el ID para que al guardar haga UPDATE en vez de INSERT
    window._editingPacienteId = pacId;
    showToast('✏️ Editando paciente — cambios se guardarán al hacer click en "Guardar Paciente"');
  }, 50);
}

async function darAlta(pacId, nuevoEstado) {
  const { error } = await supabase.from('pacientes').update({ estado: nuevoEstado }).eq('id', pacId);
  if (error) { showToast(`❌ ${error.message}`); return; }
  showToast(`✅ Paciente marcado como ${nuevoEstado}`);
  if (window.BridgeMod?.hidratarPacientes) await window.BridgeMod.hidratarPacientes();
}

// ============================================================
//  MENÚ CONTEXTUAL PACIENTE
// ============================================================
function construirMenuPaciente(pacId) {
  const paciente = (window.PACIENTES_DATA || []).find(p => String(p.id) === String(pacId));
  return [
      { icon: '👁️',  label: 'Ver ficha completa',    action: () => window.showHCL && window.showHCL(pacId) },
      { icon: '📅',  label: 'Historial de turnos',   action: () => verHistorialTurnos(pacId) },
      { icon: '📆',  label: 'Próximos turnos',       action: () => verProximosTurnos(pacId) },
      { icon: '💰',  label: 'Cuenta corriente',      action: () => verCtaCte(pacId) },
      { separator: true },
      { icon: '✏️',  label: 'Editar datos',          action: () => editarPaciente(pacId) },
      { icon: '➕',  label: 'Nuevo turno para este paciente', action: () => {
          if (typeof window.openModal === 'function') window.openModal('modalNuevoTurno');
          setTimeout(() => {
            const input = document.getElementById('turnoPac');
            if (input && paciente) input.value = paciente.nombre;
          }, 50);
        }
      },
      { separator: true },
      { icon: '✓',   label: paciente?.est === 'Activo' ? 'Dar de alta' : 'Marcar como activo',
                     action: () => darAlta(pacId, 'Alta'),
                     disabled: paciente?.est === 'Alta' },
      { icon: '💬',  label: 'Enviar WhatsApp',
                     action: () => {
                       const tel = paciente?.tel || '';
                       if (!tel) { showToast('⚠️ Sin teléfono registrado'); return; }
                       const msg = encodeURIComponent(`Hola ${paciente.nombre}, te escribimos de la clínica.`);
                       window.open(`https://wa.me/${tel.replace(/\D/g,'')}?text=${msg}`, '_blank');
                     },
                     disabled: !paciente?.tel
      },
  ];
}

// ============================================================
//  ACCIONES sobre profesional
// ============================================================

async function verAgendaProfesional(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  if (!prof) return;

  // Cargar turnos de este profesional
  const { data } = await supabase
    .from('v_turnos_dia')
    .select('*')
    .eq('profesional_id', profId)
    .gte('fecha', new Date().toISOString().slice(0, 10))
    .order('fecha').order('hora');

  const turnos = data || [];

  const modal = crearModal('modalAgendaProf', `
    <div class="modal-title">📅 Agenda — ${escapeHtml(prof.nombre)}</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${escapeHtml(prof.esp)} · Consultorio C${prof.c} · Próximos ${turnos.length} turnos</div>

    ${turnos.length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--text4)">
          <div style="font-size:40px;margin-bottom:8px">📭</div>
          Sin turnos próximos agendados
         </div>`
      : `<div class="table-wrap" style="max-height:420px;overflow-y:auto">
          <table><thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Cobertura</th><th>Estado</th></tr></thead>
          <tbody>${turnos.map(t => `
            <tr>
              <td>${escapeHtml(t.fecha)}</td>
              <td style="font-family:var(--mono);font-weight:700;color:var(--sky)">${String(t.hora).slice(0,5)}</td>
              <td style="font-weight:700">${escapeHtml(t.pac_nombre || '—')}</td>
              <td style="font-size:11px;color:var(--text3)">${escapeHtml(t.cobertura || t.pac_cobertura || 'Particular')}</td>
              <td><span class="badge badge-${
                t.estado === 'Finalizado' ? 'emerald' :
                t.estado === 'Confirmado' ? 'sky' :
                t.estado === 'No Show' ? 'rose' :
                t.estado === 'Cancelado' ? 'slate' : 'amber'
              }">${escapeHtml(t.estado)}</span></td>
            </tr>`).join('')}</tbody></table>
         </div>`}

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '780px';
}

async function generarLiquidacionProf(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  if (!prof) return;

  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

  // Resumen antes de generar
  const { data: resumen } = await supabase.rpc('resumen_profesional', {
    p_profesional_id: profId,
    p_desde: primerDia,
    p_hasta: hoyStr,
  });
  const r = (resumen && resumen[0]) || { total_turnos: 0, finalizados: 0, no_show: 0, cancelados: 0, pacientes_unicos: 0, monto_estimado: 0 };

  const modal = crearModal('modalLiqProf', `
    <div class="modal-title">💼 Liquidar — ${escapeHtml(prof.nombre)}</div>

    <div class="grid-4" style="margin-bottom:14px;gap:8px">
      <div class="stat-card" data-color="sky" style="padding:10px">
        <div class="stat-label" style="font-size:9px">FINALIZADOS</div>
        <div class="stat-value" style="font-size:20px">${r.finalizados}</div>
      </div>
      <div class="stat-card" data-color="rose" style="padding:10px">
        <div class="stat-label" style="font-size:9px">NO-SHOW</div>
        <div class="stat-value" style="font-size:20px">${r.no_show}</div>
      </div>
      <div class="stat-card" data-color="amber" style="padding:10px">
        <div class="stat-label" style="font-size:9px">CANCELADOS</div>
        <div class="stat-value" style="font-size:20px">${r.cancelados}</div>
      </div>
      <div class="stat-card" data-color="emerald" style="padding:10px">
        <div class="stat-label" style="font-size:9px">BRUTO EST.</div>
        <div class="stat-value" style="font-size:16px">$${(Number(r.monto_estimado)/1000).toFixed(1)}K</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group"><label class="form-label">Desde *</label><input class="form-input" id="liqPDesde" type="date" value="${primerDia}"></div>
      <div class="form-group"><label class="form-label">Hasta *</label><input class="form-input" id="liqPHasta" type="date" value="${hoyStr}"></div>
    </div>
    <div class="form-group"><label class="form-label">Comisión del profesional (%) *</label>
      <input class="form-input" id="liqPComision" type="number" step="0.01" min="0" max="100" value="60">
      <div style="font-size:11px;color:var(--text4);margin-top:4px">% del valor bruto que le corresponde al profesional.</div>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="liqPAplicarPenal" checked style="width:16px;height:16px;accent-color:var(--rose)">
      <label for="liqPAplicarPenal" style="font-size:13px">Aplicar penalizaciones pendientes del período (se descuentan del neto)</label>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnLiqPGenerar">Generar liquidación</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '620px';

  modal.querySelector('#btnLiqPGenerar').onclick = async () => {
    const desde = modal.querySelector('#liqPDesde').value;
    const hasta = modal.querySelector('#liqPHasta').value;
    const comision = parseFloat(modal.querySelector('#liqPComision').value) || 60;
    const aplicarPenal = modal.querySelector('#liqPAplicarPenal').checked;

    const { data, error } = await supabase.rpc('generar_liquidacion', {
      p_profesional_id: profId,
      p_desde: desde,
      p_hasta: hasta,
      p_comision_pct: comision,
    });

    if (error) { showToast(`❌ ${error.message}`); return; }

    // Aplicar penalizaciones si corresponde
    if (aplicarPenal && data) {
      const { data: penals } = await supabase
        .from('penalizaciones')
        .select('id, monto')
        .eq('profesional_id', profId)
        .eq('aplicada', false)
        .gte('fecha', desde)
        .lte('fecha', hasta);

      if (penals && penals.length > 0) {
        const totalPenal = penals.reduce((s, p) => s + Number(p.monto), 0);
        await supabase.from('liquidaciones').update({
          total_descuentos: totalPenal,
          total_neto: Number(data.total_neto) - totalPenal,
        }).eq('id', data.id);
        // Marcar penalizaciones como aplicadas
        await supabase.from('penalizaciones')
          .update({ aplicada: true, liquidacion_id: data.id })
          .in('id', penals.map(p => p.id));
      }
    }

    showToast(`✅ Liquidación generada — ${data.total_sesiones} sesiones · $${Number(data.total_neto).toLocaleString('es-AR')}`);
    cerrarModal('modalLiqProf');

    if (typeof window.showModule === 'function') window.showModule('liquidaciones', null);
  };
}

async function verCtaCteProfesional(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  if (!prof) return;

  const [liqR, penalR] = await Promise.all([
    supabase.from('liquidaciones')
      .select('*')
      .eq('profesional_id', profId)
      .order('periodo_hasta', { ascending: false })
      .limit(24),
    supabase.from('penalizaciones')
      .select('*')
      .eq('profesional_id', profId)
      .order('fecha', { ascending: false })
      .limit(50),
  ]);

  const liqs = liqR.data || [];
  const penals = penalR.data || [];

  const totalPagado = liqs.filter(l => l.estado === 'Pagada').reduce((s, l) => s + Number(l.total_neto), 0);
  const totalPendiente = liqs.filter(l => l.estado !== 'Pagada' && l.estado !== 'Anulada').reduce((s, l) => s + Number(l.total_neto), 0);
  const penalPendientes = penals.filter(p => !p.aplicada).reduce((s, p) => s + Number(p.monto), 0);

  const modal = crearModal('modalCtaCteProf', `
    <div class="modal-title">💰 Cuenta corriente — ${escapeHtml(prof.nombre)}</div>

    <div class="grid-3" style="margin-bottom:14px;gap:8px">
      <div class="stat-card" data-color="emerald" style="padding:12px">
        <div class="stat-label" style="font-size:9px">PAGADO HISTÓRICO</div>
        <div class="stat-value" style="font-size:18px">$${(totalPagado/1000).toFixed(1)}K</div>
      </div>
      <div class="stat-card" data-color="amber" style="padding:12px">
        <div class="stat-label" style="font-size:9px">PENDIENTE PAGO</div>
        <div class="stat-value" style="font-size:18px">$${(totalPendiente/1000).toFixed(1)}K</div>
      </div>
      <div class="stat-card" data-color="rose" style="padding:12px">
        <div class="stat-label" style="font-size:9px">PENAL. PENDIENTES</div>
        <div class="stat-value" style="font-size:18px">$${(penalPendientes/1000).toFixed(1)}K</div>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Liquidaciones</div>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto">
      <table><thead><tr><th>Período</th><th>Sesiones</th><th>Bruto</th><th>Desc.</th><th>Neto</th><th>Estado</th></tr></thead>
      <tbody>${liqs.length === 0
        ? `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--text4)">Sin liquidaciones aún</td></tr>`
        : liqs.map(l => `
        <tr>
          <td style="font-size:11px">${escapeHtml(l.periodo_desde)} → ${escapeHtml(l.periodo_hasta)}</td>
          <td style="text-align:center">${l.total_sesiones}</td>
          <td style="font-family:var(--mono);font-size:11px">$${Number(l.total_bruto).toLocaleString('es-AR')}</td>
          <td style="font-family:var(--mono);font-size:11px;color:var(--rose)">-$${Number(l.total_descuentos).toLocaleString('es-AR')}</td>
          <td style="font-family:var(--mono);font-weight:700">$${Number(l.total_neto).toLocaleString('es-AR')}</td>
          <td><span class="badge badge-${l.estado === 'Pagada' ? 'emerald' : l.estado === 'Cerrada' ? 'sky' : 'amber'}">${escapeHtml(l.estado)}</span></td>
        </tr>`).join('')}</tbody></table>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Penalizaciones</div>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto">
      <table><thead><tr><th>Fecha</th><th>Motivo</th><th>Tipo</th><th>Monto</th><th>Estado</th></tr></thead>
      <tbody>${penals.length === 0
        ? `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text4)">Sin penalizaciones</td></tr>`
        : penals.map(p => `
        <tr>
          <td style="font-size:11px">${escapeHtml(p.fecha)}</td>
          <td style="font-size:12px">${escapeHtml(p.motivo || '—')}</td>
          <td><span class="badge badge-slate" style="font-size:10px">${escapeHtml(p.tipo)}</span></td>
          <td style="font-family:var(--mono);font-weight:700;color:var(--rose)">-$${Number(p.monto).toLocaleString('es-AR')}</td>
          <td><span class="badge badge-${p.aplicada ? 'slate' : 'amber'}">${p.aplicada ? 'Aplicada' : 'Pendiente'}</span></td>
        </tr>`).join('')}</tbody></table>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
      <button class="btn btn-rose" id="btnNuevaPenal">+ Nueva penalización</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '780px';

  modal.querySelector('#btnNuevaPenal').onclick = () => {
    cerrarModal('modalCtaCteProf');
    abrirModalPenalizacion(profId);
  };
}

async function abrirModalPenalizacion(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));

  const modal = crearModal('modalPenal', `
    <div class="modal-title">⚠️ Nueva penalización — ${escapeHtml(prof?.nombre || '')}</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fecha *</label>
        <input class="form-input" id="penalFecha" type="date" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="form-group"><label class="form-label">Tipo *</label>
        <select class="form-select" id="penalTipo">
          <option>Cancelación tardía</option>
          <option>No-show profesional</option>
          <option>Llegada tarde</option>
          <option>Ausencia injustificada</option>
          <option>Reclamo paciente</option>
          <option>Otro</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Monto descuento *</label>
      <input class="form-input" id="penalMonto" type="number" step="0.01" min="0" placeholder="0">
      <div style="font-size:11px;color:var(--text4);margin-top:4px">Se descuenta automáticamente en la próxima liquidación del período.</div>
    </div>
    <div class="form-group"><label class="form-label">Motivo / Detalle</label>
      <textarea class="form-input" id="penalMotivo" rows="3" placeholder="Describir la situación..."></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-rose" id="btnGuardarPenal">Aplicar penalización</button>
    </div>
  `);

  modal.querySelector('#btnGuardarPenal').onclick = async () => {
    const monto = parseFloat(modal.querySelector('#penalMonto').value);
    if (!monto || monto <= 0) { showToast('⚠️ Monto inválido'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('penalizaciones').insert([{
      profesional_id: profId,
      fecha: modal.querySelector('#penalFecha').value,
      tipo: modal.querySelector('#penalTipo').value,
      motivo: modal.querySelector('#penalMotivo').value.trim() || null,
      monto,
      aplicada: false,
      created_by: user?.id,
    }]);

    if (error) { showToast(`❌ ${error.message}`); return; }
    showToast('⚠️ Penalización registrada');
    cerrarModal('modalPenal');
  };
}

// ============================================================
//  CONSTRUIR MENÚ PROFESIONAL
// ============================================================
function construirMenuProfesional(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  return [
    { icon: '📅',  label: 'Ver agenda',               action: () => verAgendaProfesional(profId) },
    { icon: '💼',  label: 'Generar liquidación',      action: () => generarLiquidacionProf(profId) },
    { icon: '💰',  label: 'Cuenta corriente',         action: () => verCtaCteProfesional(profId) },
    { separator: true },
    { icon: '🕐',  label: 'Configurar horarios',      action: () => abrirConfigHorarios(profId) },
    { icon: '📆',  label: 'Excepciones / Ausencias',  action: () => abrirExcepciones(profId) },
    { separator: true },
    { icon: '⚠️',  label: 'Aplicar penalización',     action: () => abrirModalPenalizacion(profId) },
    { icon: '📊',  label: 'Ver resumen del mes',      action: async () => {
        const hoy = new Date();
        const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
        const hoyStr = hoy.toISOString().slice(0, 10);
        const { data } = await supabase.rpc('resumen_profesional', {
          p_profesional_id: profId, p_desde: primerDia, p_hasta: hoyStr
        });
        const r = (data && data[0]) || {};
        showToast(`📊 ${prof?.nombre}: ${r.finalizados || 0} finalizados · ${r.no_show || 0} no-shows · $${Math.round((r.monto_estimado || 0)/1000)}K estimado`);
      }
    },
    { separator: true },
    { icon: '💬',  label: 'Enviar WhatsApp',
                   action: () => {
                     const tel = prof?.tel || prof?.telefono || '';
                     if (!tel) { showToast('⚠️ Profesional sin teléfono'); return; }
                     window.open(`https://wa.me/${String(tel).replace(/\D/g,'')}`, '_blank');
                   },
                   disabled: !(prof?.tel || prof?.telefono)
    },
  ];
}

export function instalarContextMenuPacientes() {
  function findPacienteId(target) {
    const tr = target.closest('[data-pac-id], tr[data-id]');
    if (!tr) return null;
    const pacId = tr.getAttribute('data-pac-id') || tr.getAttribute('data-id');
    if (!pacId) return null;
    if (!tr.closest('#mod-pacientes')) return null;
    return pacId;
  }

  function findProfesionalId(target) {
    const card = target.closest('[data-prof-id]');
    if (!card) return null;
    return card.getAttribute('data-prof-id');
  }

  // Handler botones de acción rápida en cards profesional
  document.addEventListener('click', (ev) => {
    // Profesional (cards)
    const btnProf = ev.target.closest('[data-prof-action]');
    if (btnProf) {
      ev.preventDefault();
      ev.stopPropagation();
      const action = btnProf.getAttribute('data-prof-action');
      const profId = btnProf.getAttribute('data-prof-id-action');
      if (action === 'ver-agenda') verAgendaProfesional(profId);
      else if (action === 'liquidar') generarLiquidacionProf(profId);
      return;
    }

    // Paciente (tabla)
    const btnPac = ev.target.closest('[data-pac-action]');
    if (btnPac) {
      ev.preventDefault();
      ev.stopPropagation();
      const action = btnPac.getAttribute('data-pac-action');
      const pacId = btnPac.getAttribute('data-pac-id-action');
      const paciente = (window.PACIENTES_DATA || []).find(p => String(p.id) === String(pacId));
      if (action === 'agendar') {
        if (typeof window.openModal === 'function') window.openModal('modalNuevoTurno');
        setTimeout(() => {
          const input = document.getElementById('turnoPac');
          if (input && paciente) input.value = paciente.nombre;
          if (typeof window.autoFillCobertura === 'function') window.autoFillCobertura();
        }, 60);
      } else if (action === 'ctacte') {
        verCtaCte(pacId);
      } else if (action === 'whatsapp') {
        const tel = paciente?.tel || '';
        if (!tel) { showToast('⚠️ El paciente no tiene teléfono registrado'); return; }
        const nombre = paciente?.nombre || 'paciente';
        const msg = encodeURIComponent(`Hola ${nombre}, te escribimos desde la clínica.`);
        window.open(`https://wa.me/${tel.replace(/\D/g,'')}?text=${msg}`, '_blank');
      }
    }
  });

  // Click derecho
  document.addEventListener('contextmenu', (ev) => {
    const pacId = findPacienteId(ev.target);
    if (pacId && !ev.target.closest('button, a, input, select')) {
      ev.preventDefault();
      abrirMenu(ev.clientX, ev.clientY, construirMenuPaciente(pacId));
      return;
    }
    const profId = findProfesionalId(ev.target);
    if (profId && !ev.target.closest('button, a, input, select')) {
      ev.preventDefault();
      abrirMenu(ev.clientX, ev.clientY, construirMenuProfesional(profId));
    }
  });

  // Doble click
  document.addEventListener('dblclick', (ev) => {
    const pacId = findPacienteId(ev.target);
    if (pacId && !ev.target.closest('button, a, input, select')) {
      ev.preventDefault();
      abrirMenu(ev.clientX, ev.clientY, construirMenuPaciente(pacId));
      return;
    }
    const profId = findProfesionalId(ev.target);
    if (profId && !ev.target.closest('button, a, input, select')) {
      ev.preventDefault();
      abrirMenu(ev.clientX, ev.clientY, construirMenuProfesional(profId));
    }
  });

  console.log('[ContextMenu] ✅ Click derecho y doble click en pacientes y profesionales activados');
}
