// ============================================================
//  RehabMed ERP — Reportes
//  Reemplaza los KPIs hardcoded por cálculos sobre Supabase
// ============================================================
import { supabase } from './lib/supabase.js';
import { escapeHtml } from './lib/dom.js';

// ============================================================
//  CALCULAR KPIs DEL DASHBOARD
// ============================================================
export async function calcularKPIs() {
  const hoy = new Date().toISOString().slice(0, 10);

  // Inicio y fin del mes actual
  const now = new Date();
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  // Turnos de hoy, esta semana y del mes
  const inicioSemana = new Date(now);
  inicioSemana.setDate(now.getDate() - now.getDay());
  const finSemana = new Date(inicioSemana);
  finSemana.setDate(inicioSemana.getDate() + 6);

  const [turnosHoy, turnosMes, pacientesActivos, sesionesMes, consultorios] = await Promise.all([
    // Turnos del día
    supabase.from('turnos')
      .select('id, estado', { count: 'exact' })
      .eq('fecha', hoy),

    // Turnos del mes (para facturación aproximada)
    supabase.from('turnos')
      .select('id, estado, especialidad')
      .gte('fecha', primerDiaMes)
      .lte('fecha', hoy),

    // Pacientes activos / nuevos
    supabase.from('pacientes')
      .select('id, estado', { count: 'exact' })
      .in('estado', ['Activo', 'Nuevo']),

    // Sesiones finalizadas del mes
    supabase.from('turnos')
      .select('id, especialidad', { count: 'exact' })
      .gte('fecha', primerDiaMes)
      .lte('fecha', hoy)
      .eq('estado', 'Finalizado'),

    // Consultorios activos (para calcular capacidad)
    supabase.from('consultorios').select('id', { count: 'exact' }),
  ]);

  const totalHoy   = turnosHoy.count || 0;
  const finalizadosMes = sesionesMes.count || 0;
  const totalConsultorios = consultorios.count || 12;
  // Capacidad aproximada: consultorios * 10 turnos/día (45 min c/u, 8 hs)
  const capacidadDiaria = totalConsultorios * 10;

  const porEstado = {};
  (turnosHoy.data || []).forEach(t => {
    porEstado[t.estado] = (porEstado[t.estado] || 0) + 1;
  });

  const noShowsHoy = porEstado['No Show'] || 0;
  const confirmadosHoy = (porEstado['Confirmado'] || 0) + (porEstado['En curso'] || 0);
  const noShowRate = totalHoy > 0 ? ((noShowsHoy / totalHoy) * 100).toFixed(1) : '0';

  // Tarifa por defecto por especialidad (aproximado, hasta que haya tabla tarifas)
  const TARIFA_DEFAULT = 8000;
  const TARIFAS_ESP = {
    'Kinesiología':  7500,
    'Fisioterapia':  8000,
    'Psicología':    12000,
    'Traumatología': 15000,
    'Neurología':    14000,
    'Pediatría':     9000,
    'Deportología':  11000,
  };

  const facturacionMes = (sesionesMes.data || []).reduce((sum, t) => {
    return sum + (TARIFAS_ESP[t.especialidad] || TARIFA_DEFAULT);
  }, 0);

  return {
    totalHoy,
    capacidadDiaria,
    ocupacionPct: capacidadDiaria > 0 ? Math.round((totalHoy / capacidadDiaria) * 100) : 0,
    confirmadosHoy,
    noShowsHoy,
    noShowRate,
    pacientesActivos: pacientesActivos.count || 0,
    finalizadosMes,
    facturacionMes,
    porEstadoHoy: porEstado,
  };
}

// ============================================================
//  RENDER KPIs EN EL DASHBOARD
// ============================================================
export async function updateDashboardKPIsReal() {
  let kpis;
  try {
    kpis = await calcularKPIs();
  } catch (e) {
    console.error('[Reports] error calculando KPIs:', e);
    return;
  }

  const cards = document.querySelectorAll('#mod-dashboard .stat-card .stat-value');

  // Card 1: Turnos del día con capacidad real
  if (cards[0]) {
    cards[0].innerHTML =
      `${kpis.totalHoy}<span style="font-size:16px;color:var(--text3);font-weight:500">/${kpis.capacidadDiaria}</span>`;
  }

  // Card 2: Facturación del mes (calculada aprox)
  if (cards[1]) {
    const fm = kpis.facturacionMes;
    cards[1].textContent = fm >= 1_000_000
      ? '$' + (fm / 1_000_000).toFixed(2) + 'M'
      : '$' + (fm / 1000).toFixed(1) + 'K';
  }

  // Card 3: No-show rate
  if (cards[2]) {
    cards[2].textContent = kpis.noShowRate + '%';
  }

  // Card 4: Pacientes activos/nuevos
  if (cards[3]) {
    cards[3].textContent = kpis.pacientesActivos;
  }

  // Actualizar sublabels con info útil
  const footers = document.querySelectorAll('#mod-dashboard > .grid-4 > .stat-card .stat-footer .stat-desc');
  if (footers[0]) footers[0].textContent = `${kpis.confirmadosHoy} confirmados · ocupación ${kpis.ocupacionPct}%`;
  if (footers[1]) footers[1].textContent = `${kpis.finalizadosMes} sesiones finalizadas`;
  if (footers[2]) footers[2].textContent = `${kpis.noShowsHoy} no-shows hoy`;
  if (footers[3]) footers[3].textContent = `activos + nuevos`;

  console.log('[Reports] KPIs actualizados:', kpis);
}

// ============================================================
//  GRÁFICO: Turnos últimos 7 días (si existe el canvas)
// ============================================================
export async function actualizarChartSemanal() {
  const canvas = document.getElementById('chartAgendaEvol');
  if (!canvas || typeof window.Chart === 'undefined') return;

  // 7 días hacia atrás
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dias.push(d.toISOString().slice(0, 10));
  }

  const { data, error } = await supabase
    .from('turnos')
    .select('fecha, estado')
    .gte('fecha', dias[0])
    .lte('fecha', dias[6]);

  if (error) return;

  const conteo = { total: {}, finalizados: {}, noShow: {} };
  dias.forEach(d => {
    conteo.total[d] = 0;
    conteo.finalizados[d] = 0;
    conteo.noShow[d] = 0;
  });

  (data || []).forEach(t => {
    if (conteo.total[t.fecha] !== undefined) {
      conteo.total[t.fecha]++;
      if (t.estado === 'Finalizado') conteo.finalizados[t.fecha]++;
      else if (t.estado === 'No Show') conteo.noShow[t.fecha]++;
    }
  });

  const labels = dias.map(d => new Date(d + 'T00:00').toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit' }));

  // Destruir chart previo si existe
  if (canvas.__chart) canvas.__chart.destroy();

  canvas.__chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total', data: dias.map(d => conteo.total[d]), borderColor: '#0369a1', backgroundColor: 'rgba(3,105,161,0.1)', tension: 0.3, fill: true },
        { label: 'Finalizados', data: dias.map(d => conteo.finalizados[d]), borderColor: '#059669', backgroundColor: 'transparent', tension: 0.3 },
        { label: 'No-Show', data: dias.map(d => conteo.noShow[d]), borderColor: '#e11d48', backgroundColor: 'transparent', tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// ============================================================
//  INSTALAR: sobrescribe window.updateDashboardKPIs
// ============================================================
export function instalarReports() {
  // Pisamos el updateDashboardKPIs legacy para que use datos reales
  window.updateDashboardKPIs = async () => {
    await updateDashboardKPIsReal();
    await actualizarChartSemanal();
  };

  // También lo exponemos con otro nombre
  window.Reports = {
    calcularKPIs,
    updateDashboardKPIsReal,
    actualizarChartSemanal,
  };

  console.log('[Reports] ✅ Dashboard conectado a Supabase con cálculos reales');
}
