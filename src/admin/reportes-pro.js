// ============================================================
//  RehabMed ERP — Módulo Reportería (BI)
//
//  Reemplaza el módulo "BI" legacy del sidebar. Provee:
//    • 6 reportes core (turnos, autorizaciones, facturación,
//      ocupación, no-show, pacientes)
//    • Filtros globales (rango de fechas)
//    • Charts con Chart.js
//    • Export a Excel (SheetJS)
//    • Modal de "Conectar Power BI" con instrucciones
//
//  Las vistas SQL viven en migration 014_vistas_reportes.sql
//  y son consumidas tanto por este módulo como por
//  herramientas externas (Power BI, Excel, Looker Studio).
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { formatSupabaseError } from '../lib/errors.js';

// Colores para charts (consistentes con el resto del ERP)
const PALETA = ['#0369a1', '#10b981', '#f59e0b', '#7c3aed', '#e11d48', '#0ea5e9', '#f97316'];

// Definición de los reportes disponibles
const REPORTES = {
  turnos: {
    titulo: '📅 Turnos por período',
    descripcion: 'Listado completo de turnos cruzado con paciente, profesional, especialidad y cobertura.',
    vista: 'v_rep_turnos',
    columnas: [
      { campo: 'fecha',                 label: 'Fecha' },
      { campo: 'hora',                  label: 'Hora',                 format: v => String(v).slice(0,5) },
      { campo: 'paciente_nombre',       label: 'Paciente' },
      { campo: 'profesional_nombre',    label: 'Profesional' },
      { campo: 'profesional_especialidad', label: 'Especialidad' },
      { campo: 'cobertura_turno',       label: 'Cobertura' },
      { campo: 'estado',                label: 'Estado' },
      { campo: 'duracion_min',          label: 'Duración (min)' },
    ],
    filtroFecha: 'fecha',
    chart: { tipo: 'bar', x: 'estado', label: 'Turnos por estado' },
  },

  autorizaciones_os: {
    titulo: '📋 Autorizaciones por OS',
    descripcion: 'Ranking de obras sociales por cantidad de autorizaciones, sesiones y vencimientos.',
    vista: 'v_rep_autorizaciones_os',
    columnas: [
      { campo: 'obra_social',                    label: 'Obra social' },
      { campo: 'cantidad_autorizaciones',        label: 'Cant. autorizaciones' },
      { campo: 'pacientes_distintos',            label: 'Pacientes' },
      { campo: 'sesiones_totales_autorizadas',   label: 'Sesiones aut.' },
      { campo: 'sesiones_totales_usadas',        label: 'Sesiones usadas' },
      { campo: 'sesiones_disponibles',           label: 'Disponibles' },
      { campo: 'pct_uso',                        label: '% uso',         format: v => v + '%' },
      { campo: 'aprobadas',                      label: 'Aprobadas' },
      { campo: 'pendientes',                     label: 'Pendientes' },
      { campo: 'por_vencer_10_dias',             label: '⚠️ Por vencer (10d)' },
      { campo: 'vencidas',                       label: '🚫 Vencidas' },
    ],
    chart: { tipo: 'bar', x: 'obra_social', y: 'cantidad_autorizaciones', label: 'Autorizaciones por OS' },
  },

  facturacion: {
    titulo: '💰 Facturación mensual por OS',
    descripcion: 'Total facturado, cobrado y pendiente por obra social y mes.',
    vista: 'v_rep_facturacion_mensual',
    columnas: [
      { campo: 'anio_mes',          label: 'Período' },
      { campo: 'cobertura',         label: 'Cobertura' },
      { campo: 'tipo',              label: 'Tipo' },
      { campo: 'cantidad_facturas', label: 'Cant. facturas' },
      { campo: 'total_facturado',   label: 'Total facturado',  format: fmtMoney },
      { campo: 'total_cobrado',     label: 'Total cobrado',    format: fmtMoney },
      { campo: 'saldo_pendiente',   label: 'Saldo pendiente',  format: fmtMoney },
      { campo: 'pct_cobrado',       label: '% cobrado',        format: v => v + '%' },
    ],
    chart: { tipo: 'bar', x: 'cobertura', y: 'total_facturado', label: 'Facturación por OS' },
    notaSiVacio: 'Si no ves datos, ejecutá la migración 006_erp_administracion.sql que crea la tabla de facturas.',
  },

  ocupacion: {
    titulo: '👨‍⚕️ Ocupación de profesionales',
    descripcion: 'Turnos por profesional en los últimos 30 días.',
    vista: 'v_rep_ocupacion_profesional',
    columnas: [
      { campo: 'profesional_nombre',  label: 'Profesional' },
      { campo: 'especialidad',        label: 'Especialidad' },
      { campo: 'tipo',                label: 'Relación' },
      { campo: 'turnos_total',        label: 'Total turnos' },
      { campo: 'turnos_finalizados',  label: 'Finalizados' },
      { campo: 'turnos_noshow',       label: 'No-Show' },
      { campo: 'turnos_cancelados',   label: 'Cancelados' },
      { campo: 'turnos_activos',      label: 'Activos' },
      { campo: 'pct_noshow',          label: '% No-Show', format: v => (v || 0) + '%' },
    ],
    chart: { tipo: 'bar', x: 'profesional_nombre', y: 'turnos_total', label: 'Turnos por profesional' },
  },

  noshow: {
    titulo: '❌ Ranking de No-Show (pacientes)',
    descripcion: 'Pacientes con mayor cantidad de inasistencias.',
    vista: 'v_rep_noshow_pacientes',
    columnas: [
      { campo: 'paciente_nombre', label: 'Paciente' },
      { campo: 'dni',             label: 'DNI' },
      { campo: 'cobertura',       label: 'Cobertura' },
      { campo: 'noshow_count',    label: 'No-Show' },
      { campo: 'turnos_total',    label: 'Total turnos' },
      { campo: 'pct_noshow',      label: '%', format: v => (v || 0) + '%' },
      { campo: 'score_noshow',    label: 'Score' },
    ],
    chart: { tipo: 'bar', x: 'paciente_nombre', y: 'noshow_count', label: 'No-show por paciente' },
  },

  pacientes: {
    titulo: '👥 Pacientes — situación actual',
    descripcion: 'Estado de cada paciente: activo, sin actividad, último turno.',
    vista: 'v_rep_pacientes_estado',
    columnas: [
      { campo: 'paciente_nombre',     label: 'Paciente' },
      { campo: 'dni',                 label: 'DNI' },
      { campo: 'cobertura',           label: 'Cobertura' },
      { campo: 'situacion',           label: 'Situación' },
      { campo: 'sesiones_realizadas', label: 'Sesiones' },
      { campo: 'turnos_futuros',      label: 'Próximos' },
      { campo: 'ultimo_turno',        label: 'Último turno' },
      { campo: 'deuda',               label: 'Deuda',     format: fmtMoney },
      { campo: 'fecha_alta',          label: 'Alta',      format: v => v ? new Date(v).toLocaleDateString('es-AR') : '—' },
    ],
    chart: { tipo: 'doughnut', x: 'situacion', label: 'Pacientes por situación' },
  },
};

// Estado del módulo
let _reporteActivo = 'turnos';
let _filtroDesde = null;
let _filtroHasta = null;
let _datosActuales = [];
let _chartActual = null;

// ============================================================
//  ENTRADA — render del módulo dentro de mod-bi
// ============================================================
export async function abrirModuloReportes() {
  const modBI = document.getElementById('mod-bi');
  if (!modBI) { showToast('⚠️ Módulo BI no encontrado'); return; }

  // Defaults: último mes
  const hoy = new Date();
  const haceMes = new Date();
  haceMes.setMonth(hoy.getMonth() - 1);
  _filtroDesde = haceMes.toISOString().slice(0, 10);
  _filtroHasta = hoy.toISOString().slice(0, 10);

  modBI.innerHTML = renderEsqueleto();

  // Listeners
  modBI.querySelectorAll('[data-rep-tab]').forEach(btn => {
    btn.addEventListener('click', () => seleccionarReporte(btn.getAttribute('data-rep-tab')));
  });
  modBI.querySelector('#repFiltroDesde').addEventListener('change', (ev) => {
    _filtroDesde = ev.target.value;
    cargarYRenderizarReporte();
  });
  modBI.querySelector('#repFiltroHasta').addEventListener('change', (ev) => {
    _filtroHasta = ev.target.value;
    cargarYRenderizarReporte();
  });
  modBI.querySelector('#btnExcelDescargar').addEventListener('click', exportarExcel);
  modBI.querySelector('#btnPowerBIInstrucciones').addEventListener('click', mostrarInstruccionesPBI);

  await cargarYRenderizarReporte();
}

function renderEsqueleto() {
  const tabs = Object.entries(REPORTES).map(([id, r]) => `
    <button data-rep-tab="${id}" style="
      background:${id === _reporteActivo ? 'var(--bg3)' : 'transparent'};
      color:${id === _reporteActivo ? 'var(--sky)' : 'var(--text3)'};
      font-weight:${id === _reporteActivo ? '700' : '500'};
      padding:10px 14px;border:none;border-radius:8px;cursor:pointer;
      font-size:13px;font-family:inherit;white-space:nowrap;
      transition:all 0.15s;
    ">${escapeHtml(r.titulo)}</button>
  `).join('');

  return `
    <!-- HEADER -->
    <div class="page-header-row">
      <div>
        <div class="page-title">📊 Reportería (BI)</div>
        <div class="page-sub">Reportes operativos · Exportá a Excel · Conectá Power BI</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-emerald" id="btnExcelDescargar">📥 Descargar Excel</button>
        <button class="btn btn-violet" id="btnPowerBIInstrucciones">📊 Conectar Power BI</button>
      </div>
    </div>

    <!-- FILTROS GLOBALES -->
    <div class="card card-pad" style="margin-bottom:14px">
      <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:0 0 180px;margin:0">
          <label class="form-label">Desde</label>
          <input class="form-input" type="date" id="repFiltroDesde" value="${escapeAttr(_filtroDesde)}">
        </div>
        <div class="form-group" style="flex:0 0 180px;margin:0">
          <label class="form-label">Hasta</label>
          <input class="form-input" type="date" id="repFiltroHasta" value="${escapeAttr(_filtroHasta)}">
        </div>
        <div style="flex:0 0 auto;display:flex;gap:6px">
          ${rangoBtn('hoy', 'Hoy')}
          ${rangoBtn('semana', 'Esta semana')}
          ${rangoBtn('mes', 'Este mes')}
          ${rangoBtn('trim', 'Trimestre')}
          ${rangoBtn('anio', 'Año')}
        </div>
      </div>
    </div>

    <!-- TABS DE REPORTES -->
    <div style="display:flex;gap:4px;margin-bottom:14px;background:var(--bg);padding:6px;border-radius:10px;overflow-x:auto">
      ${tabs}
    </div>

    <!-- CONTENIDO DEL REPORTE ACTIVO -->
    <div id="repContent">
      <div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando reporte...</div>
    </div>
  `;
}

function rangoBtn(rango, label) {
  return `<button class="btn btn-ghost btn-sm" data-rango="${rango}" onclick="window.ReportesMod.aplicarRango('${rango}')">${label}</button>`;
}

// ============================================================
//  Atajos de rangos rápidos (expuestos en window)
// ============================================================
function aplicarRango(rango) {
  const hoy = new Date();
  const desde = new Date();
  if (rango === 'hoy') {
    // mismo día
  } else if (rango === 'semana') {
    desde.setDate(hoy.getDate() - 7);
  } else if (rango === 'mes') {
    desde.setMonth(hoy.getMonth() - 1);
  } else if (rango === 'trim') {
    desde.setMonth(hoy.getMonth() - 3);
  } else if (rango === 'anio') {
    desde.setFullYear(hoy.getFullYear() - 1);
  }
  _filtroDesde = desde.toISOString().slice(0, 10);
  _filtroHasta = hoy.toISOString().slice(0, 10);

  document.getElementById('repFiltroDesde').value = _filtroDesde;
  document.getElementById('repFiltroHasta').value = _filtroHasta;
  cargarYRenderizarReporte();
}

// ============================================================
//  SELECCIONAR REPORTE
// ============================================================
function seleccionarReporte(id) {
  if (!REPORTES[id]) return;
  _reporteActivo = id;

  // Actualizar estilos de tabs
  document.querySelectorAll('[data-rep-tab]').forEach(b => {
    if (b.getAttribute('data-rep-tab') === id) {
      b.style.background = 'var(--bg3)'; b.style.color = 'var(--sky)'; b.style.fontWeight = '700';
    } else {
      b.style.background = 'transparent'; b.style.color = 'var(--text3)'; b.style.fontWeight = '500';
    }
  });

  cargarYRenderizarReporte();
}

// ============================================================
//  CARGAR + RENDER
// ============================================================
async function cargarYRenderizarReporte() {
  const cfg = REPORTES[_reporteActivo];
  const cont = document.getElementById('repContent');
  if (!cont) return;

  cont.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text4)">⏳ Cargando ${escapeHtml(cfg.titulo)}...</div>`;

  // Construir query
  let query = supabase.from(cfg.vista).select('*');
  if (cfg.filtroFecha && _filtroDesde && _filtroHasta) {
    query = query.gte(cfg.filtroFecha, _filtroDesde).lte(cfg.filtroFecha, _filtroHasta);
  }
  query = query.limit(5000);

  const { data, error } = await query;
  if (error) {
    console.error('[Reportes]', error);
    cont.innerHTML = `
      <div style="background:rgba(225,29,72,0.05);border:1px solid var(--rose);border-radius:10px;padding:20px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:var(--rose);margin-bottom:6px">❌ ${escapeHtml(formatSupabaseError(error, 'reporte'))}</div>
        ${cfg.notaSiVacio ? `<div style="font-size:12px;color:var(--text3);margin-top:6px">ℹ️ ${escapeHtml(cfg.notaSiVacio)}</div>` : ''}
      </div>`;
    return;
  }

  _datosActuales = data || [];

  if (_datosActuales.length === 0) {
    cont.innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--text4);background:var(--bg3);border-radius:10px">
        <div style="font-size:36px;margin-bottom:10px">📭</div>
        <div style="font-size:14px;font-weight:700;color:var(--text3)">Sin datos en el período</div>
        <div style="font-size:12px;margin-top:4px">Probá con otro rango de fechas o cargá actividad operativa primero.</div>
        ${cfg.notaSiVacio ? `<div style="font-size:11px;color:var(--text4);margin-top:14px;padding:10px;background:var(--bg);border-radius:6px;max-width:500px;margin-left:auto;margin-right:auto">ℹ️ ${escapeHtml(cfg.notaSiVacio)}</div>` : ''}
      </div>`;
    return;
  }

  cont.innerHTML = `
    <!-- DESCRIPCIÓN -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--sky);padding:10px 14px;border-radius:8px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--text3)">${escapeHtml(cfg.descripcion)}</div>
      <div style="font-size:11px;color:var(--text4);margin-top:4px">${_datosActuales.length} fila${_datosActuales.length !== 1 ? 's' : ''} · vista <code>${escapeHtml(cfg.vista)}</code></div>
    </div>

    <!-- CHART (si aplica) -->
    ${cfg.chart ? `
      <div class="card card-pad" style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px">${escapeHtml(cfg.chart.label)}</div>
        <div style="height:280px;position:relative">
          <canvas id="repChart"></canvas>
        </div>
      </div>
    ` : ''}

    <!-- TABLA -->
    <div class="card card-pad">
      <div style="overflow-x:auto;max-height:600px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="position:sticky;top:0;background:var(--bg3);z-index:1">
            <tr>${cfg.columnas.map(c => `
              <th style="text-align:left;padding:10px;border-bottom:2px solid var(--border);font-weight:700;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(c.label)}</th>
            `).join('')}</tr>
          </thead>
          <tbody>${_datosActuales.map((row, i) => `
            <tr style="background:${i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)'}">
              ${cfg.columnas.map(c => {
                let val = row[c.campo];
                if (val == null) val = '';
                if (c.format) val = c.format(val);
                return `<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text2)">${escapeHtml(String(val))}</td>`;
              }).join('')}
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  `;

  // Renderizar chart si aplica
  if (cfg.chart) renderChart(cfg);
}

// ============================================================
//  CHART
// ============================================================
function renderChart(cfg) {
  const canvas = document.getElementById('repChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_chartActual) _chartActual.destroy();

  // Agrupar datos
  const grupos = {};
  _datosActuales.forEach(row => {
    const key = row[cfg.chart.x] || '—';
    if (cfg.chart.y) {
      grupos[key] = (grupos[key] || 0) + (Number(row[cfg.chart.y]) || 0);
    } else {
      grupos[key] = (grupos[key] || 0) + 1;
    }
  });

  const labels = Object.keys(grupos);
  const data = Object.values(grupos);

  const tipo = cfg.chart.tipo || 'bar';
  const dataset = {
    label: cfg.chart.label,
    data,
    backgroundColor: tipo === 'doughnut' || tipo === 'pie'
      ? labels.map((_, i) => PALETA[i % PALETA.length])
      : '#0369a1',
    borderRadius: 4,
  };

  _chartActual = new Chart(canvas, {
    type: tipo,
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: tipo === 'doughnut' || tipo === 'pie' ? true : false, position: 'right' },
      },
      scales: tipo === 'bar' ? {
        x: { ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
      } : undefined,
    },
  });
}

// ============================================================
//  EXPORT EXCEL — usa SheetJS
// ============================================================
function exportarExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('❌ La librería de Excel no se cargó. Recargá la página.');
    return;
  }
  if (_datosActuales.length === 0) {
    showToast('⚠️ No hay datos para exportar');
    return;
  }

  const cfg = REPORTES[_reporteActivo];

  // Construir array de objetos con labels legibles
  const filas = _datosActuales.map(row => {
    const obj = {};
    cfg.columnas.forEach(c => {
      let val = row[c.campo];
      if (c.format && val != null) val = c.format(val);
      obj[c.label] = val ?? '';
    });
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(filas);

  // Auto-ajustar ancho de columnas
  const widths = cfg.columnas.map(c => {
    const maxLen = Math.max(
      c.label.length,
      ...filas.map(r => String(r[c.label] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = widths;

  const wb = XLSX.utils.book_new();
  const sheetName = cfg.titulo.slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, ' ');
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Nombre del archivo: rep_<id>_<periodo>.xlsx
  const fname = `rep_${_reporteActivo}_${_filtroDesde || 'all'}_${_filtroHasta || 'all'}.xlsx`;
  XLSX.writeFile(wb, fname);

  showToast(`📥 Descargado ${fname}`);
}

// ============================================================
//  MODAL POWER BI — instrucciones de conexión
// ============================================================
function mostrarInstruccionesPBI() {
  const html = `
    <div class="modal-overlay" id="modalPBI" onclick="if(event.target===this) document.getElementById('modalPBI').remove()">
      <div class="modal" style="width:680px;max-width:96vw;max-height:92vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
          <div>
            <div class="modal-title" style="margin-bottom:2px">📊 Conectar a Power BI</div>
            <div style="font-size:11px;color:var(--text3)">Power BI Desktop puede conectarse directo a tu base Postgres y hacer reportes propios.</div>
          </div>
          <button class="modal-close" onclick="document.getElementById('modalPBI').remove()">×</button>
        </div>

        <div style="background:rgba(124,58,237,0.05);border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--violet);margin-bottom:6px">⚡ Recomendado: Power BI Desktop (gratis)</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.5">
            Power BI se conecta a Postgres. Toma cualquier vista <code>v_rep_*</code> y armás dashboards visuales con drill-down,
            filtros cruzados, slicers y exportación a PDF. Se actualiza automático.
          </div>
        </div>

        <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px">📋 Pasos para conectar</div>

        <ol style="font-size:13px;color:var(--text2);line-height:1.7;padding-left:20px;margin-bottom:14px">
          <li><strong>Descargar Power BI Desktop</strong> (gratis):<br>
            <a href="https://www.microsoft.com/es-ar/power-platform/products/power-bi/desktop" target="_blank" style="color:var(--sky);text-decoration:underline;font-size:12px">https://www.microsoft.com/es-ar/power-platform/products/power-bi/desktop</a>
          </li>
          <li>Abrir PBI Desktop → <strong>"Obtener datos"</strong> → <strong>"Base de datos PostgreSQL"</strong></li>
          <li>Pedile a tu admin Supabase los datos de conexión:
            <div style="background:var(--bg);padding:10px;border-radius:6px;font-family:var(--mono);font-size:11px;margin:8px 0">
              <div><strong>Servidor:</strong> <span style="color:var(--text3)">db.&lt;tu_proyecto&gt;.supabase.co</span></div>
              <div><strong>Puerto:</strong> 5432 (default 6543 con pooler)</div>
              <div><strong>Base:</strong> postgres</div>
              <div><strong>Usuario:</strong> postgres</div>
              <div><strong>Pass:</strong> <span style="color:var(--rose)">[el database password de Supabase]</span></div>
              <div><strong>SSL:</strong> Required</div>
            </div>
            <div style="font-size:11px;color:var(--text4)">El host completo está en Supabase → Settings → Database → Connection string</div>
          </li>
          <li>Una vez conectado, vas a ver todas las tablas y vistas. <strong>Usá las que empiezan con <code>v_rep_</code></strong> que son las preparadas para reportes:
            <ul style="font-size:11px;color:var(--text3);margin-top:4px">
              <li><code>v_rep_turnos</code> — todos los turnos cruzados</li>
              <li><code>v_rep_autorizaciones_os</code> — ranking de OS</li>
              <li><code>v_rep_facturacion_mensual</code> — facturación</li>
              <li><code>v_rep_ocupacion_profesional</code> — ocupación</li>
              <li><code>v_rep_noshow_pacientes</code> — no-show</li>
              <li><code>v_rep_pacientes_estado</code> — pacientes</li>
              <li><code>v_rep_kpi_diario</code> — KPIs del día</li>
            </ul>
          </li>
          <li>Importás → armás reportes con drag&drop</li>
        </ol>

        <div style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px;font-size:11px;color:var(--text2);line-height:1.5">
          <strong>⚠️ Seguridad:</strong> Nunca compartas el password del database. Si vas a tener varios analistas conectados,
          mejor crear un usuario read-only con permisos limitados. Pedile a un dev que te ayude con eso.
        </div>

        <div style="margin-top:14px;font-size:11px;color:var(--text4)">
          <strong>Alternativa más simple:</strong> usá el botón "Descargar Excel" de cada reporte. Excel tiene Power Query y tabla dinámica que cubren ~80% de los casos sin necesidad de Power BI.
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
          <button class="btn btn-ghost" onclick="document.getElementById('modalPBI').remove()">Cerrar</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
}

// ============================================================
//  HELPERS
// ============================================================
function fmtMoney(v) {
  if (v == null) return '$ 0';
  return '$ ' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================================
//  INSTALAR — hook al sidebar para reemplazar BI legacy
// ============================================================
export function instalarReportesPro() {
  // Hook al showModule para que cuando se abra "bi" se renderice nuestro módulo
  const originalShowModule = window.showModule;
  window.showModule = function (mod, el) {
    if (typeof originalShowModule === 'function') {
      try { originalShowModule(mod, el); } catch (e) { console.warn(e); }
    }
    if (mod === 'bi') {
      // Esperar a que el HTML legacy haya seteado active al módulo
      setTimeout(abrirModuloReportes, 50);
    }
  };

  console.log('[ReportesPro] ✅ Instalado — módulo BI reemplazado');
}

window.ReportesMod = {
  abrirModuloReportes,
  aplicarRango,
};
