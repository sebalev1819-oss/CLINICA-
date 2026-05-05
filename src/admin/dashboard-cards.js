// ============================================================
//  RehabMed ERP — Cards del dashboard principal con datos REALES
//
//  Las 3 cards más importantes para una clínica que arranca:
//    🚨 Alertas accionables HOY
//        - autorizaciones por vencer / vencidas
//        - stock crítico
//        - documentos de proveedores por vencer
//    📅 Pulso del día
//        - turnos hoy + estados (finalizados / en curso / pendientes / no-show)
//        - % de ejecución del día
//    👥 Salud del negocio
//        - pacientes activos
//        - profesionales activos
//        - ocupación promedio del equipo (últimos 30d)
//
//  Auto-refresh cada 60s. Click en cada card → navega al módulo.
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, showToast } from '../lib/dom.js';

const CONTAINER_ID = 'dash-cards-real';

let _refreshTimer = null;
let _datosCache = null;

// ============================================================
//  ENTRADA — render inicial + setup auto-refresh
// ============================================================
export async function instalarDashboardCards() {
  await render();
  // Auto-refresh cada 60 segundos cuando el dashboard está visible
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    const dashEl = document.getElementById('mod-dashboard');
    if (dashEl && dashEl.classList.contains('active')) render();
  }, 60_000);

  // Hook para refrescar cuando el user vuelve al dashboard
  const _orig = window.showModule;
  window.showModule = function (mod, el) {
    if (typeof _orig === 'function') _orig(mod, el);
    if (mod === 'dashboard') setTimeout(render, 100);
  };
}

// ============================================================
//  RENDER — carga datos + arma las 3 cards
// ============================================================
async function render() {
  const cont = document.getElementById(CONTAINER_ID);
  if (!cont) return;

  // Cargar todo en paralelo
  const [alertas, pulsoDia, salud] = await Promise.all([
    cargarAlertas(),
    cargarPulsoDia(),
    cargarSaludNegocio(),
  ]);

  _datosCache = { alertas, pulsoDia, salud };

  cont.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
      ${renderCardAlertas(alertas)}
      ${renderCardPulso(pulsoDia)}
      ${renderCardSalud(salud)}
    </div>
  `;

  // Click handlers
  cont.querySelectorAll('[data-card-action]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = el.getAttribute('data-card-action');
      const mod    = el.getAttribute('data-card-mod');
      if (mod && typeof window.showModule === 'function') {
        window.showModule(mod, null);
      }
    });
  });
}

// ============================================================
//  CARGA DE DATOS — 1: Alertas
// ============================================================
async function cargarAlertas() {
  const result = {
    autorizaciones_por_vencer: 0,
    autorizaciones_vencidas:   0,
    autorizaciones_sin_sesiones: 0,
    stock_critico:             0,
    proveedores_doc_vencen:    0,
    detalle_top: [],
  };

  // Autorizaciones críticas
  try {
    const { data: criticas } = await supabase
      .from('v_autorizaciones_criticas')
      .select('numero, paciente_nombre, estado_calculado, dias_al_vencimiento, sesiones_restantes, obra_social')
      .limit(50);

    if (criticas) {
      criticas.forEach(c => {
        if (c.estado_calculado === 'Vencida') result.autorizaciones_vencidas++;
        else if (c.estado_calculado === 'Por vencer') result.autorizaciones_por_vencer++;
        else if (c.estado_calculado === 'Sin sesiones') result.autorizaciones_sin_sesiones++;
      });
      result.detalle_top = criticas.slice(0, 3);
    }
  } catch (e) { /* tabla puede no existir */ }

  // Stock crítico (insumos por debajo del mínimo)
  try {
    const { count } = await supabase
      .from('insumos')
      .select('*', { count: 'exact', head: true })
      .eq('activo', true)
      .filter('stock_actual', 'lt', 'stock_minimo');
    result.stock_critico = count || 0;
  } catch (e) { /* tabla puede no existir */ }

  // Proveedores con documentos por vencer
  try {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + 30);
    const { count } = await supabase
      .from('proveedores_archivos')
      .select('*', { count: 'exact', head: true })
      .gte('vencimiento', new Date().toISOString().slice(0, 10))
      .lte('vencimiento', fechaLimite.toISOString().slice(0, 10));
    result.proveedores_doc_vencen = count || 0;
  } catch (e) { /* tabla puede no existir */ }

  return result;
}

// ============================================================
//  CARGA DE DATOS — 2: Pulso del día
// ============================================================
async function cargarPulsoDia() {
  const result = {
    turnos_hoy:           0,
    turnos_finalizados:   0,
    turnos_en_curso:      0,
    turnos_confirmados:   0,
    turnos_pendientes:    0,
    turnos_noshow:        0,
    turnos_cancelados:    0,
    pct_ejecucion:        0,
  };

  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: turnos } = await supabase
      .from('turnos')
      .select('estado')
      .eq('fecha', hoy);

    if (turnos) {
      result.turnos_hoy = turnos.length;
      turnos.forEach(t => {
        if (t.estado === 'Finalizado')     result.turnos_finalizados++;
        else if (t.estado === 'En curso')  result.turnos_en_curso++;
        else if (t.estado === 'Confirmado') result.turnos_confirmados++;
        else if (t.estado === 'Pendiente') result.turnos_pendientes++;
        else if (t.estado === 'No Show')   result.turnos_noshow++;
        else if (t.estado === 'Cancelado') result.turnos_cancelados++;
      });

      const ejecutados = result.turnos_finalizados + result.turnos_en_curso + result.turnos_noshow;
      result.pct_ejecucion = result.turnos_hoy > 0
        ? Math.round((ejecutados / result.turnos_hoy) * 100)
        : 0;
    }
  } catch (e) { /* error silencioso */ }

  return result;
}

// ============================================================
//  CARGA DE DATOS — 3: Salud del negocio
// ============================================================
async function cargarSaludNegocio() {
  const result = {
    pacientes_activos:        0,
    pacientes_sin_actividad:  0,
    pacientes_total:          0,
    profesionales_activos:    0,
    ocupacion_promedio:       0,
    turnos_mes:               0,
    sesiones_finalizadas_mes: 0,
  };

  // Pacientes por situación
  try {
    const { data: pacientes } = await supabase
      .from('v_rep_pacientes_estado')
      .select('situacion');

    if (pacientes) {
      result.pacientes_total = pacientes.length;
      pacientes.forEach(p => {
        if (p.situacion === 'Activo')                        result.pacientes_activos++;
        else if (p.situacion === 'Sin actividad reciente')   result.pacientes_sin_actividad++;
      });
    }
  } catch (e) { /* error silencioso */ }

  // Profesionales activos
  try {
    const { count } = await supabase
      .from('profesionales')
      .select('*', { count: 'exact', head: true })
      .eq('activo', true);
    result.profesionales_activos = count || 0;
  } catch (e) { /* error silencioso */ }

  // Turnos del mes (último mes)
  try {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 1);
    const { data: turnos } = await supabase
      .from('turnos')
      .select('estado')
      .gte('fecha', desde.toISOString().slice(0, 10));

    if (turnos) {
      result.turnos_mes = turnos.length;
      result.sesiones_finalizadas_mes = turnos.filter(t => t.estado === 'Finalizado').length;
      const efectivos = turnos.filter(t => ['Finalizado','En curso','Confirmado','Pendiente'].includes(t.estado)).length;
      result.ocupacion_promedio = result.turnos_mes > 0
        ? Math.round((efectivos / result.turnos_mes) * 100)
        : 0;
    }
  } catch (e) { /* error silencioso */ }

  return result;
}

// ============================================================
//  RENDER — Card 1: Alertas accionables HOY
// ============================================================
function renderCardAlertas(d) {
  const total = d.autorizaciones_por_vencer + d.autorizaciones_vencidas
              + d.autorizaciones_sin_sesiones + d.stock_critico
              + d.proveedores_doc_vencen;

  const colorBg = total > 0 ? 'linear-gradient(135deg,rgba(225,29,72,0.08),rgba(217,119,6,0.04))' : 'linear-gradient(135deg,rgba(5,150,105,0.06),rgba(14,165,233,0.04))';
  const colorBorde = total > 0 ? 'rgba(225,29,72,0.25)' : 'rgba(5,150,105,0.25)';

  let contenido;
  if (total === 0) {
    contenido = `
      <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:20px 0">
        <div style="font-size:42px">✅</div>
        <div style="font-size:13px;color:var(--emerald);font-weight:700">Todo bajo control</div>
        <div style="font-size:11px;color:var(--text4)">Sin alertas pendientes</div>
      </div>`;
  } else {
    const items = [];
    if (d.autorizaciones_vencidas > 0)      items.push({ ic: '🚫', txt: `${d.autorizaciones_vencidas} autorización${d.autorizaciones_vencidas !== 1 ? 'es' : ''} vencida${d.autorizaciones_vencidas !== 1 ? 's' : ''}`, color: '#dc2626', mod: 'pacientes' });
    if (d.autorizaciones_por_vencer > 0)    items.push({ ic: '⏰', txt: `${d.autorizaciones_por_vencer} por vencer (≤10 días)`, color: '#d97706', mod: 'pacientes' });
    if (d.autorizaciones_sin_sesiones > 0)  items.push({ ic: '📊', txt: `${d.autorizaciones_sin_sesiones} sin sesiones disponibles`, color: '#d97706', mod: 'pacientes' });
    if (d.stock_critico > 0)                items.push({ ic: '📦', txt: `${d.stock_critico} insumo${d.stock_critico !== 1 ? 's' : ''} bajo el mínimo`, color: '#dc2626', mod: 'stock' });
    if (d.proveedores_doc_vencen > 0)       items.push({ ic: '📎', txt: `${d.proveedores_doc_vencen} doc${d.proveedores_doc_vencen !== 1 ? 's' : ''} de proveedores vence(n)`, color: '#d97706', mod: 'proveedores' });

    contenido = items.map(it => `
      <div data-card-action="alerta" data-card-mod="${it.mod}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.5);border-radius:6px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.85)'" onmouseout="this.style.background='rgba(255,255,255,0.5)'">
        <div style="font-size:16px">${it.ic}</div>
        <div style="flex:1;font-size:12px;color:${it.color};font-weight:600">${escapeHtml(it.txt)}</div>
        <div style="color:var(--text4);font-size:14px">›</div>
      </div>`).join('');

    // Top 3 detalle
    if (d.detalle_top.length > 0) {
      contenido += `
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.08)">
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Top 3 críticas</div>
          ${d.detalle_top.map(c => `
            <div style="font-size:10px;color:var(--text3);margin-bottom:2px">
              <strong>${escapeHtml(c.paciente_nombre || '—')}</strong> · ${escapeHtml(c.obra_social || '')} ·
              ${c.estado_calculado === 'Vencida' ? `Venció hace ${Math.abs(c.dias_al_vencimiento || 0)}d` : ''}
              ${c.estado_calculado === 'Por vencer' ? `Vence en ${c.dias_al_vencimiento}d` : ''}
              ${c.estado_calculado === 'Sin sesiones' ? `${c.sesiones_restantes || 0} sesiones rest.` : ''}
            </div>
          `).join('')}
        </div>`;
    }
  }

  return `
    <div style="background:${colorBg};border:1px solid ${colorBorde};border-radius:12px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text);display:flex;align-items:center;gap:6px">
            🚨 Alertas accionables
          </div>
          <div style="font-size:10px;color:var(--text4)">Lo que hay que hacer hoy</div>
        </div>
        ${total > 0 ? `<div style="background:var(--rose);color:white;font-size:13px;font-weight:800;padding:3px 10px;border-radius:99px">${total}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${contenido}
      </div>
    </div>`;
}

// ============================================================
//  RENDER — Card 2: Pulso del día
// ============================================================
function renderCardPulso(d) {
  const sinTurnos = d.turnos_hoy === 0;

  return `
    <div data-card-action="pulso" data-card-mod="agenda" style="background:linear-gradient(135deg,rgba(3,105,161,0.06),rgba(14,165,233,0.04));border:1px solid rgba(3,105,161,0.25);border-radius:12px;padding:14px;cursor:pointer;transition:transform 0.15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text);display:flex;align-items:center;gap:6px">
            📅 Pulso del día
          </div>
          <div style="font-size:10px;color:var(--text4)">Cómo va la operación AHORA</div>
        </div>
        <div style="background:var(--sky);color:white;font-size:13px;font-weight:800;padding:3px 10px;border-radius:99px">${d.turnos_hoy}</div>
      </div>

      ${sinTurnos ? `
        <div style="text-align:center;padding:14px 0;color:var(--text4);font-size:12px">
          📭 Sin turnos para hoy
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px">
          ${d.turnos_finalizados > 0 ? renderMiniStat('✅', 'Finalizados', d.turnos_finalizados, '#059669') : ''}
          ${d.turnos_en_curso > 0    ? renderMiniStat('🟦', 'En curso',    d.turnos_en_curso,    '#0369a1') : ''}
          ${d.turnos_confirmados > 0 ? renderMiniStat('📌', 'Confirmados', d.turnos_confirmados, '#0369a1') : ''}
          ${d.turnos_pendientes > 0  ? renderMiniStat('⏳', 'Pendientes',  d.turnos_pendientes,  '#d97706') : ''}
          ${d.turnos_noshow > 0      ? renderMiniStat('❌', 'No-Show',     d.turnos_noshow,      '#dc2626') : ''}
          ${d.turnos_cancelados > 0  ? renderMiniStat('⊘',  'Cancelados',  d.turnos_cancelados,  '#6b7280') : ''}
        </div>

        <!-- Barra de progreso de ejecución -->
        <div style="margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text4);margin-bottom:4px">
            <span>Ejecución del día</span>
            <span style="font-weight:700;color:${d.pct_ejecucion >= 80 ? '#059669' : d.pct_ejecucion >= 50 ? '#d97706' : '#dc2626'}">${d.pct_ejecucion}%</span>
          </div>
          <div style="background:rgba(255,255,255,0.5);border-radius:99px;height:6px;overflow:hidden">
            <div style="height:100%;width:${d.pct_ejecucion}%;background:${d.pct_ejecucion >= 80 ? '#059669' : d.pct_ejecucion >= 50 ? '#d97706' : '#dc2626'};transition:width 0.3s"></div>
          </div>
        </div>
      `}

      <div style="margin-top:10px;font-size:10px;color:var(--text4);text-align:right">click para ver agenda →</div>
    </div>`;
}

function renderMiniStat(ic, label, valor, color) {
  return `
    <div style="background:rgba(255,255,255,0.6);border-radius:6px;padding:6px 8px;display:flex;align-items:center;gap:6px">
      <span style="font-size:14px">${ic}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.04em">${label}</div>
        <div style="font-size:14px;font-weight:800;color:${color}">${valor}</div>
      </div>
    </div>`;
}

// ============================================================
//  RENDER — Card 3: Salud del negocio
// ============================================================
function renderCardSalud(d) {
  return `
    <div data-card-action="salud" data-card-mod="bi" style="background:linear-gradient(135deg,rgba(124,58,237,0.06),rgba(5,150,105,0.04));border:1px solid rgba(124,58,237,0.25);border-radius:12px;padding:14px;cursor:pointer;transition:transform 0.15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text);display:flex;align-items:center;gap:6px">
            👥 Salud del negocio
          </div>
          <div style="font-size:10px;color:var(--text4)">Pulso mes a mes</div>
        </div>
      </div>

      <!-- Pacientes -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.6);border-radius:6px;margin-bottom:6px">
        <div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px">Pacientes activos</div>
          <div style="font-size:18px;font-weight:800;color:var(--violet)">${d.pacientes_activos}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase">de ${d.pacientes_total}</div>
          ${d.pacientes_sin_actividad > 0 ? `<div style="font-size:10px;color:var(--amber);font-weight:600">${d.pacientes_sin_actividad} sin actividad</div>` : ''}
        </div>
      </div>

      <!-- Profesionales y turnos -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div style="background:rgba(255,255,255,0.6);border-radius:6px;padding:8px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:2px">Profesionales</div>
          <div style="font-size:16px;font-weight:800;color:var(--sky)">${d.profesionales_activos}</div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:6px;padding:8px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:2px">Turnos último mes</div>
          <div style="font-size:16px;font-weight:800;color:var(--emerald)">${d.turnos_mes}</div>
        </div>
      </div>

      <!-- Ocupación -->
      <div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text4);margin-bottom:4px">
          <span>Ocupación promedio (30d)</span>
          <span style="font-weight:700;color:${d.ocupacion_promedio >= 70 ? '#059669' : d.ocupacion_promedio >= 40 ? '#d97706' : '#dc2626'}">${d.ocupacion_promedio}%</span>
        </div>
        <div style="background:rgba(255,255,255,0.5);border-radius:99px;height:6px;overflow:hidden">
          <div style="height:100%;width:${d.ocupacion_promedio}%;background:${d.ocupacion_promedio >= 70 ? '#059669' : d.ocupacion_promedio >= 40 ? '#d97706' : '#dc2626'};transition:width 0.3s"></div>
        </div>
      </div>

      <div style="margin-top:10px;font-size:10px;color:var(--text4);text-align:right">click para ver reportes →</div>
    </div>`;
}

// ============================================================
//  EXPORT
// ============================================================
window.DashboardCardsMod = { instalarDashboardCards, render };
