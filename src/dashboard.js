// ============================================================
//  RehabMed ERP — Módulo Dashboard
//  Vistas SQL: v_dashboard_stats, v_turnos_por_dia,
//              v_distribucion_coberturas, v_noshow_por_dia,
//              v_ranking_profesionales, v_actividad_reciente
//
//  Charts: usa Chart.js (ya cargado por el HTML)
//  Sobreescribe: window.updateDashboardKPIs (legacy)
//  Provee: window.DashboardMod = { ... }
// ============================================================
import { supabase } from './lib/supabase.js';

// ── Estado ────────────────────────────────────────────────
let _stats         = null;       // última lectura de v_dashboard_stats
let _chartTurnos   = null;       // instancia Chart.js (line)
let _chartCober    = null;       // instancia Chart.js (doughnut)
let _chartNoshow   = null;       // instancia Chart.js (bar)
let _refreshTimer  = null;
let _realtimeChan  = null;

// Paleta consistente con el CSS del HTML
const COLORS = {
  sky:     '#0369a1',
  sky2:    '#0284c7',
  emerald: '#059669',
  amber:   '#d97706',
  rose:    '#e11d48',
  violet:  '#7c3aed',
  orange:  '#ea580c',
  text3:   '#64748b',
  text4:   '#94a3b8',
  border:  'rgba(0,0,0,0.08)',
};

// ============================================================
//  CARGA PRINCIPAL
// ============================================================
export async function cargarDashboard() {
  try {
    // Disparar todas las queries en paralelo
    const [stats, turnosPorDia, coberturas, noshow, consultorios, ranking] =
      await Promise.all([
        supabase.from('v_dashboard_stats').select('*').single(),
        supabase.from('v_turnos_por_dia').select('*'),
        supabase.from('v_distribucion_coberturas').select('*'),
        supabase.from('v_noshow_por_dia').select('*'),
        supabase.from('consultorios')
          .select('id, nombre, especialidad, estado, profesional_id, limpieza_hasta')
          .order('id'),
        supabase.from('v_ranking_profesionales').select('*').limit(8),
      ]);

    // Errors de cada query (sin abortar si una falla)
    if (stats.error)         console.warn('[Dashboard] stats:', stats.error.message);
    if (turnosPorDia.error)  console.warn('[Dashboard] turnos:', turnosPorDia.error.message);
    if (coberturas.error)    console.warn('[Dashboard] coberturas:', coberturas.error.message);
    if (noshow.error)        console.warn('[Dashboard] noshow:', noshow.error.message);
    if (consultorios.error)  console.warn('[Dashboard] consultorios:', consultorios.error.message);
    if (ranking.error)       console.warn('[Dashboard] ranking:', ranking.error.message);

    _stats = stats.data;

    renderKPIs(_stats);
    renderFechaHoy();
    renderChartTurnos(turnosPorDia.data || []);
    renderChartCoberturas(coberturas.data || []);
    renderChartNoshow(noshow.data || []);
    renderConsultoriosGrid(consultorios.data || []);
    renderAlertas(_stats);

    console.log('[Dashboard] ✅ Cargado');
  } catch (e) {
    console.error('[Dashboard] ❌ Error inesperado:', e);
    if (typeof showToast === 'function') showToast('❌ Error cargando dashboard');
  }
}

// ============================================================
//  RENDER — Fecha de hoy (subtítulo)
// ============================================================
function renderFechaHoy() {
  const el = document.getElementById('dash-date');
  if (!el) return;
  const fecha = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  el.textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
}

// ============================================================
//  RENDER — KPI cards
// ============================================================
function renderKPIs(stats) {
  if (!stats) return;
  const cards = document.querySelectorAll('#mod-dashboard > .grid-4 > .stat-card');
  if (cards.length < 4) return;

  // Card 1: Turnos hoy realizados / total
  setStatCard(cards[0], {
    value: `${stats.turnos_hoy_realizados}<span style="font-size:16px;color:var(--text3);font-weight:500">/${stats.turnos_hoy_total || 0}</span>`,
    descripcion: stats.turnos_hoy_total > 0
      ? `${Math.round((stats.turnos_hoy_realizados / stats.turnos_hoy_total) * 100)}% ejecución`
      : 'Sin turnos hoy',
    trend: '',
    trendColor: 'var(--text3)',
  });

  // Card 2: Sesiones del mes (reemplaza "Facturación" hasta tener tabla de pagos)
  setStatCardLabel(cards[1], 'Sesiones del Mes');
  setStatCard(cards[1], {
    value: stats.sesiones_mes_realizadas || 0,
    descripcion: `de ${stats.turnos_mes_total || 0} turnos del mes`,
    trend: '',
    trendColor: 'var(--text3)',
  });

  // Card 3: No-Show Rate del mes
  const noshowPct = parseFloat(stats.noshow_rate_mes_pct) || 0;
  setStatCard(cards[2], {
    value: noshowPct.toFixed(1) + '%',
    descripcion: noshowPct < 8 ? 'Objetivo <8% ✅' : 'Sobre objetivo ⚠️',
    trend: '',
    trendColor: noshowPct < 8 ? 'var(--emerald)' : 'var(--rose)',
  });

  // Card 4: Pacientes Activos
  const total = (stats.pacientes_activos || 0) + (stats.pacientes_nuevos || 0);
  setStatCard(cards[3], {
    value: total,
    descripcion: `+${stats.pacientes_alta_mes || 0} este mes`,
    trend: '',
    trendColor: 'var(--text3)',
  });
}

function setStatCard(card, { value, descripcion, trend, trendColor }) {
  const valueEl = card.querySelector('.stat-value');
  const descEl  = card.querySelector('.stat-desc');
  const trendEl = card.querySelector('.stat-trend');
  if (valueEl) valueEl.innerHTML = value;
  if (descEl)  descEl.textContent = descripcion;
  if (trendEl) {
    trendEl.textContent = trend;
    trendEl.style.color = trendColor;
  }
}

function setStatCardLabel(card, nuevoLabel) {
  const labelEl = card.querySelector('.stat-label');
  if (!labelEl) return;
  // Conservar el SVG del icono al final
  const svg = labelEl.querySelector('svg');
  labelEl.textContent = nuevoLabel + ' ';
  if (svg) labelEl.appendChild(svg);
}

// ============================================================
//  RENDER — Chart de Turnos por día (line chart)
// ============================================================
function renderChartTurnos(rows) {
  const canvas = document.getElementById('chartFact');
  if (!canvas || typeof Chart === 'undefined') return;

  // Cambiar el título de la card (era "Facturación vs Cobrado")
  const card = canvas.closest('.card');
  if (card) {
    const title = card.querySelector('.card-title');
    const sub   = card.querySelector('.card-sub');
    if (title) title.textContent = 'Turnos · Últimos 30 días';
    if (sub)   sub.textContent   = 'Finalizados vs No-Show vs Total';
  }

  // Cambiar las leyendas debajo del chart
  const legendsContainer = card?.querySelector('div[style*="display:flex;gap:20px"]');
  if (legendsContainer) {
    legendsContainer.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:50%;background:${COLORS.sky}"></div><span style="font-size:11px;color:var(--text3)">Total</span></div>
      <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:50%;background:${COLORS.emerald}"></div><span style="font-size:11px;color:var(--text3)">Finalizados</span></div>
      <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:50%;background:${COLORS.rose}"></div><span style="font-size:11px;color:var(--text3)">No-Show</span></div>
    `;
  }

  if (_chartTurnos) _chartTurnos.destroy();

  _chartTurnos = new Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map(r => r.fecha_label),
      datasets: [
        {
          label: 'Total',
          data: rows.map(r => r.total),
          borderColor: COLORS.sky,
          backgroundColor: COLORS.sky + '20',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2,
        },
        {
          label: 'Finalizados',
          data: rows.map(r => r.finalizados),
          borderColor: COLORS.emerald,
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2,
        },
        {
          label: 'No-Show',
          data: rows.map(r => r.noshow),
          borderColor: COLORS.rose,
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: chartBaseOptions(),
  });
}

// ============================================================
//  RENDER — Chart de coberturas (doughnut)
// ============================================================
function renderChartCoberturas(rows) {
  const canvas = document.getElementById('chartCober');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_chartCober) _chartCober.destroy();

  // Tomamos top 5 + agrupamos el resto en "Otros"
  let labels = rows.slice(0, 5).map(r => r.cobertura);
  let data   = rows.slice(0, 5).map(r => r.cantidad);
  if (rows.length > 5) {
    const otros = rows.slice(5).reduce((s, r) => s + r.cantidad, 0);
    labels.push('Otros');
    data.push(otros);
  }

  if (data.length === 0) {
    labels = ['Sin datos'];
    data   = [1];
  }

  const palette = [
    COLORS.sky2, COLORS.emerald, COLORS.amber, COLORS.violet, COLORS.orange, COLORS.text4,
  ];

  _chartCober = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: palette.slice(0, data.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { display: false } },
    },
  });

  // Actualizar la leyenda manual al lado del chart
  const card = canvas.closest('.card');
  const legendBox = card?.querySelector('div[style*="display:flex;flex-direction:column"]');
  if (legendBox && rows.length > 0) {
    const totalRows = rows.reduce((s, r) => s + r.cantidad, 0);
    legendBox.innerHTML = rows.slice(0, 5).map((r, i) => `
      <div style="display:flex;justify-content:space-between;font-size:11px;align-items:center">
        <span style="display:flex;align-items:center;gap:6px;color:${palette[i]};font-weight:600">
          <span style="width:8px;height:8px;border-radius:50%;background:${palette[i]}"></span>
          ${r.cobertura}
        </span>
        <span style="color:var(--text3);font-weight:700">${r.porcentaje}%</span>
      </div>`).join('');
    if (rows.length > 5) {
      const otros = rows.slice(5).reduce((s, r) => s + r.cantidad, 0);
      const otrosPct = totalRows > 0 ? Math.round((otros / totalRows) * 100 * 10) / 10 : 0;
      legendBox.innerHTML += `
        <div style="display:flex;justify-content:space-between;font-size:11px">
          <span style="color:var(--text3)">Otros</span>
          <span style="color:var(--text3);font-weight:700">${otrosPct}%</span>
        </div>`;
    }
  } else if (legendBox) {
    legendBox.innerHTML = '<div style="color:var(--text4);font-size:11px;text-align:center">Sin turnos este mes</div>';
  }
}

// ============================================================
//  RENDER — Chart de No-Show semanal (bar chart)
// ============================================================
function renderChartNoshow(rows) {
  const canvas = document.getElementById('chartNoshow');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_chartNoshow) _chartNoshow.destroy();

  _chartNoshow = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.fecha_label),
      datasets: [{
        label: 'No-Show',
        data: rows.map(r => r.noshow),
        backgroundColor: rows.map(r => r.porcentaje > 8 ? COLORS.rose : COLORS.amber),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const r = rows[ctx.dataIndex];
              return `${r.noshow} no-show (${r.porcentaje}% de ${r.total})`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { display: false, beginAtZero: true },
      },
    },
  });
}

// ============================================================
//  RENDER — Grid de consultorios
// ============================================================
function renderConsultoriosGrid(consultorios) {
  const grid = document.getElementById('consultoriosGrid');
  if (!grid) return;

  const colores = {
    libre:    { bg: 'rgba(5,150,105,0.08)',  text: COLORS.emerald, label: 'Libre',     dot: COLORS.emerald },
    ocupado:  { bg: 'rgba(3,105,161,0.08)',  text: COLORS.sky,     label: 'Ocupado',   dot: COLORS.sky },
    limpieza: { bg: 'rgba(217,119,6,0.08)',  text: COLORS.amber,   label: 'Limpieza',  dot: COLORS.amber },
    mantenimiento: { bg: 'rgba(225,29,72,0.08)', text: COLORS.rose, label: 'Mant.',    dot: COLORS.rose },
  };

  grid.innerHTML = consultorios.map(c => {
    const col = colores[c.estado] || colores.libre;
    let extra = '';
    if (c.estado === 'limpieza' && c.limpieza_hasta) {
      const segundosRestantes = Math.max(0, Math.floor((new Date(c.limpieza_hasta) - new Date()) / 1000));
      const min = Math.floor(segundosRestantes / 60);
      const seg = segundosRestantes % 60;
      extra = `<div style="font-size:9px;color:${col.text};margin-top:2px">⏱ ${min}:${String(seg).padStart(2,'0')}</div>`;
    }
    return `
      <div style="background:${col.bg};border:1px solid ${col.text}33;border-radius:8px;padding:10px;text-align:center">
        <div style="display:flex;align-items:center;justify-content:center;gap:5px;font-weight:700;color:var(--text);font-size:13px">
          <span style="width:6px;height:6px;border-radius:50%;background:${col.dot};box-shadow:0 0 6px ${col.dot}"></span>
          C${c.id}
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${c.especialidad || '—'}</div>
        <div style="font-size:10px;color:${col.text};font-weight:700;margin-top:4px">${col.label}</div>
        ${extra}
      </div>`;
  }).join('');
}

// ============================================================
//  RENDER — Alertas dinámicas (panel inferior)
// ============================================================
async function renderAlertas(stats) {
  if (!stats) return;
  // Buscar el contenedor de alertas existente
  const firstAlert = document.querySelector('#mod-dashboard .alert-item');
  const cont = firstAlert?.parentElement;
  if (!cont) return;

  const alertas = [];

  // 1. Autorizaciones críticas
  if (stats.autorizaciones_criticas > 0) {
    alertas.push({
      color: COLORS.rose,
      msg:   `${stats.autorizaciones_criticas} autorización(es) crítica(s): por vencer o sin sesiones`,
      time:  'Ahora',
      mod:   'pacientes',
    });
  }

  // 2. Stock crítico
  if (stats.insumos_criticos > 0) {
    alertas.push({
      color: COLORS.rose,
      msg:   `${stats.insumos_criticos} insumo(s) por debajo del mínimo`,
      time:  'Ahora',
      mod:   'stock',
    });
  }

  // 3. No-show del día
  if (stats.turnos_hoy_noshow > 0) {
    alertas.push({
      color: COLORS.amber,
      msg:   `${stats.turnos_hoy_noshow} no-show registrado(s) hoy`,
      time:  'Hoy',
      mod:   'noshow',
    });
  }

  // 4. No-show rate alto
  const noshowPct = parseFloat(stats.noshow_rate_mes_pct) || 0;
  if (noshowPct >= 10) {
    alertas.push({
      color: COLORS.rose,
      msg:   `No-Show rate del mes: ${noshowPct.toFixed(1)}% (objetivo <8%)`,
      time:  'Mes actual',
      mod:   'noshow',
    });
  }

  if (alertas.length === 0) {
    cont.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text4);font-size:12px">
        ✅ Sin alertas. Todo bajo control.
      </div>`;
    return;
  }

  cont.innerHTML = alertas.slice(0, 6).map(a => `
    <div class="alert-item" style="cursor:pointer" onclick="showModule('${a.mod}')">
      <div class="alert-dot" style="background:${a.color}"></div>
      <div>
        <div class="alert-msg">${a.msg}</div>
        <div class="alert-time">${a.time}</div>
      </div>
    </div>`).join('');
}

// ============================================================
//  CHART helpers
// ============================================================
function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { grid: { color: COLORS.border }, ticks: { font: { size: 10 } }, beginAtZero: true },
    },
  };
}

// ============================================================
//  REALTIME — refresca el dashboard cuando cambian turnos,
//  pacientes, autorizaciones o consultorios.
//  Throttled: máximo 1 refresh cada 3 segundos.
// ============================================================
let _refreshDebounce = null;
function refrescarDebounced() {
  if (_refreshDebounce) return;
  _refreshDebounce = setTimeout(async () => {
    _refreshDebounce = null;
    // Solo refrescar si el módulo dashboard está visible
    const dashEl = document.getElementById('mod-dashboard');
    if (dashEl && dashEl.classList.contains('active')) {
      await cargarDashboard();
    }
  }, 3000);
}

export function suscribirRealtimeDashboard() {
  if (_realtimeChan) supabase.removeChannel(_realtimeChan);

  _realtimeChan = supabase
    .channel('dashboard-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' },         refrescarDebounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pacientes' },      refrescarDebounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'autorizaciones' }, refrescarDebounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'consultorios' },   refrescarDebounced)
    .subscribe((status) => console.log('[Dashboard] Realtime:', status));
}

// Refresh periódico cada 60s (por si los timers de consultorios no se actualizan)
export function startAutoRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    const dashEl = document.getElementById('mod-dashboard');
    if (dashEl && dashEl.classList.contains('active')) {
      cargarDashboard();
    }
  }, 60_000);
}

// ============================================================
//  EXPORT GLOBAL
// ============================================================
window.DashboardMod = {
  cargarDashboard,
  suscribirRealtimeDashboard,
  startAutoRefresh,
  get stats() { return _stats; },
};

// Sobreescribir la función legacy del HTML
window.updateDashboardKPIs = cargarDashboard;
