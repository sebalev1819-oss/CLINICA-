// ============================================================
//  RehabMed ERP — Menú contextual (click derecho) sobre rows
//  Usable en: pacientes, profesionales, turnos, facturas, etc.
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

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
export function instalarContextMenuPacientes() {
  // Delegación global: click derecho en cualquier [data-pac-id] o row de pacientes
  document.addEventListener('contextmenu', (ev) => {
    // Buscar el row de paciente — el HTML tiene `data-pac-id` o clickea en botones con ID
    const tr = ev.target.closest('[data-pac-id], tr[data-id]');
    if (!tr) return;

    // Extraer ID (data-pac-id o data-id)
    const pacId = tr.getAttribute('data-pac-id') || tr.getAttribute('data-id');
    if (!pacId) return;

    // Verificar que el row esté dentro del módulo pacientes
    const modPac = tr.closest('#mod-pacientes');
    if (!modPac) return;

    ev.preventDefault();

    const paciente = (window.PACIENTES_DATA || []).find(p => String(p.id) === String(pacId));

    abrirMenu(ev.clientX, ev.clientY, [
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
    ]);
  });

  console.log('[ContextMenu] ✅ Click derecho en pacientes activado');
}
