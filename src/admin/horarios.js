// ============================================================
//  RehabMed ERP — Configurador de horarios por profesional
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml, escapeAttr, showToast } from '../lib/dom.js';
import { crearModal, cerrarModal } from './config.js';

const DIAS = [
  { num: 1, label: 'Lunes',     corto: 'Lun' },
  { num: 2, label: 'Martes',    corto: 'Mar' },
  { num: 3, label: 'Miércoles', corto: 'Mié' },
  { num: 4, label: 'Jueves',    corto: 'Jue' },
  { num: 5, label: 'Viernes',   corto: 'Vie' },
  { num: 6, label: 'Sábado',    corto: 'Sáb' },
  { num: 0, label: 'Domingo',   corto: 'Dom' },
];

// ============================================================
//  MODAL: CONFIGURAR HORARIOS
// ============================================================
export async function abrirConfigHorarios(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  if (!prof) { showToast('⚠️ Profesional no encontrado'); return; }

  // Cargar horarios actuales + duración consulta
  const [horR, profR] = await Promise.all([
    supabase.from('profesionales_horarios')
      .select('*').eq('profesional_id', profId).eq('activo', true)
      .order('dia_semana').order('hora_inicio'),
    supabase.from('profesionales')
      .select('duracion_consulta, min_anticipacion_hs')
      .eq('id', profId).single(),
  ]);

  const horarios = horR.data || [];
  const duracion = profR.data?.duracion_consulta || 45;
  const anticipacion = profR.data?.min_anticipacion_hs || 2;

  // Agrupar por día
  const horariosPorDia = {};
  DIAS.forEach(d => { horariosPorDia[d.num] = []; });
  horarios.forEach(h => { horariosPorDia[h.dia_semana].push(h); });

  const modal = crearModal('modalHorarios', `
    <div class="modal-title">🕐 Horarios de atención — ${escapeHtml(prof.nombre)}</div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Duración por consulta (min)</label>
        <select class="form-select" id="horDuracion">
          ${[15,20,30,45,60,90,120].map(m => `<option value="${m}" ${duracion === m ? 'selected' : ''}>${m} min</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Anticipación mínima (hs)</label>
        <input class="form-input" id="horAntic" type="number" min="0" max="72" value="${anticipacion}">
        <div style="font-size:10px;color:var(--text4);margin-top:2px">Cuántas horas antes del turno se puede agendar</div>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin:16px 0 8px">Días y franjas horarias</div>
    <div style="font-size:11px;color:var(--text4);margin-bottom:10px">
      Podés agregar múltiples franjas por día (ej: 09:00-13:00 mañana + 14:00-19:00 tarde).
    </div>

    <div id="horariosDias" style="display:flex;flex-direction:column;gap:8px;max-height:380px;overflow-y:auto">
      ${DIAS.map(d => renderDia(d, horariosPorDia[d.num])).join('')}
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" data-cerrar>Cancelar</button>
      <button class="btn btn-sky" id="btnGuardarHorarios">💾 Guardar horarios</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '640px';

  // Event delegation para + Franja y X eliminar
  modal.querySelector('#horariosDias').addEventListener('click', (ev) => {
    const addBtn = ev.target.closest('[data-add-franja]');
    if (addBtn) {
      const dia = addBtn.getAttribute('data-add-franja');
      const cont = modal.querySelector(`[data-dia-franjas="${dia}"]`);
      cont.insertAdjacentHTML('beforeend', renderFranja('09:00', '13:00'));
      return;
    }
    const delBtn = ev.target.closest('[data-del-franja]');
    if (delBtn) {
      delBtn.closest('[data-franja]').remove();
    }
  });

  modal.querySelector('#btnGuardarHorarios').onclick = async () => {
    // Recolectar todas las franjas
    const nuevos = [];
    DIAS.forEach(d => {
      modal.querySelectorAll(`[data-dia-franjas="${d.num}"] [data-franja]`).forEach(fr => {
        const activo = fr.querySelector('[data-activo]').checked;
        if (!activo) return;
        const ini = fr.querySelector('[data-hora-ini]').value;
        const fin = fr.querySelector('[data-hora-fin]').value;
        if (!ini || !fin) return;
        if (fin <= ini) { showToast(`⚠️ ${d.label}: la hora fin debe ser mayor a la inicio`); return; }
        nuevos.push({
          profesional_id: profId,
          dia_semana:     d.num,
          hora_inicio:    ini,
          hora_fin:       fin,
          consultorio_id: prof.c || null,
          activo:         true,
        });
      });
    });

    // Actualizar duración + anticipación del profesional
    const { error: errProf } = await supabase.from('profesionales').update({
      duracion_consulta: parseInt(modal.querySelector('#horDuracion').value) || 45,
      min_anticipacion_hs: parseInt(modal.querySelector('#horAntic').value) || 0,
    }).eq('id', profId);

    if (errProf) { showToast(`❌ ${errProf.message}`); return; }

    // Reemplazar horarios: borrar anteriores e insertar nuevos
    // (estrategia simple, no óptima pero entendible)
    await supabase.from('profesionales_horarios')
      .delete().eq('profesional_id', profId);

    if (nuevos.length > 0) {
      const { error } = await supabase.from('profesionales_horarios').insert(nuevos);
      if (error) { showToast(`❌ ${error.message}`); return; }
    }

    showToast(`✅ Horarios guardados — ${nuevos.length} franjas activas`);
    cerrarModal('modalHorarios');
  };
}

function renderDia(dia, franjas) {
  const tieneHorarios = franjas.length > 0;
  return `
    <div style="background:${tieneHorarios ? 'rgba(3,105,161,0.04)' : 'rgba(0,0,0,0.02)'};border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${tieneHorarios ? '10px' : '0'}">
        <strong style="font-size:13px;color:var(--text)">${escapeHtml(dia.label)}</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-add-franja="${dia.num}" style="font-size:11px">+ Franja</button>
      </div>
      <div data-dia-franjas="${dia.num}" style="display:flex;flex-direction:column;gap:6px">
        ${franjas.map(f => renderFranja(String(f.hora_inicio).slice(0,5), String(f.hora_fin).slice(0,5))).join('')}
      </div>
    </div>`;
}

function renderFranja(horaIni, horaFin) {
  return `
    <div data-franja style="display:grid;grid-template-columns:30px 1fr 1fr 30px;gap:8px;align-items:center">
      <input type="checkbox" data-activo checked style="width:16px;height:16px;accent-color:var(--emerald)">
      <input type="time" data-hora-ini class="form-input" value="${escapeAttr(horaIni)}" style="font-size:13px">
      <input type="time" data-hora-fin class="form-input" value="${escapeAttr(horaFin)}" style="font-size:13px">
      <button type="button" data-del-franja class="btn btn-ghost btn-sm" style="padding:4px 8px;color:var(--rose)" title="Eliminar franja">×</button>
    </div>`;
}

// ============================================================
//  MODAL: EXCEPCIONES (feriados, ausencias, días extra)
// ============================================================
export async function abrirExcepciones(profId) {
  const prof = (window.PROFESIONALES_DATA || []).find(p => String(p.id) === String(profId));
  if (!prof) return;

  const { data: excs } = await supabase.from('profesionales_excepciones')
    .select('*').eq('profesional_id', profId)
    .order('fecha', { ascending: false }).limit(50);

  const modal = crearModal('modalExcepciones', `
    <div class="modal-title">📆 Excepciones de horario — ${escapeHtml(prof.nombre)}</div>
    <div style="font-size:11px;color:var(--text4);margin-bottom:14px">
      Feriados, ausencias, licencias o días extra de atención.
    </div>

    <div style="background:rgba(3,105,161,0.05);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px">➕ Agregar excepción</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tipo</label>
          <select class="form-select" id="excTipo">
            <option value="ausencia">Ausencia</option>
            <option value="feriado">Feriado</option>
            <option value="vacaciones">Vacaciones</option>
            <option value="licencia_medica">Licencia médica</option>
            <option value="dia_extra">Día extra de atención</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Desde *</label>
          <input class="form-input" id="excDesde" type="date" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Hasta (opc.)</label>
          <input class="form-input" id="excHasta" type="date">
        </div>
        <div class="form-group" id="excFranja" style="display:none"><label class="form-label">Hora (día extra)</label>
          <div style="display:flex;gap:4px">
            <input class="form-input" id="excHoraIni" type="time" value="09:00">
            <input class="form-input" id="excHoraFin" type="time" value="13:00">
          </div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Motivo</label>
        <input class="form-input" id="excMotivo" placeholder="Ej: Congreso, vacaciones, reemplazo...">
      </div>
      <div style="text-align:right">
        <button class="btn btn-sky btn-sm" id="btnAddExc">Agregar</button>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Excepciones registradas</div>
    <div id="excList" style="max-height:280px;overflow-y:auto">
      ${(excs || []).length === 0
        ? `<div style="text-align:center;padding:30px;color:var(--text4)">Sin excepciones registradas</div>`
        : (excs || []).map(e => renderExcepcion(e)).join('')}
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-ghost" data-cerrar>Cerrar</button>
    </div>
  `);
  modal.querySelector('.modal').style.width = '640px';

  // Mostrar/ocultar franja si tipo = dia_extra
  modal.querySelector('#excTipo').addEventListener('change', (ev) => {
    modal.querySelector('#excFranja').style.display = ev.target.value === 'dia_extra' ? 'block' : 'none';
  });

  modal.querySelector('#btnAddExc').onclick = async () => {
    const tipo = modal.querySelector('#excTipo').value;
    const desde = modal.querySelector('#excDesde').value;
    const hasta = modal.querySelector('#excHasta').value || null;
    const motivo = modal.querySelector('#excMotivo').value.trim() || null;

    if (!desde) { showToast('⚠️ Elegí fecha desde'); return; }

    const payload = {
      profesional_id: profId,
      fecha: desde,
      fecha_hasta: hasta,
      tipo, motivo,
    };
    if (tipo === 'dia_extra') {
      payload.hora_inicio = modal.querySelector('#excHoraIni').value;
      payload.hora_fin    = modal.querySelector('#excHoraFin').value;
      if (!payload.hora_inicio || !payload.hora_fin) { showToast('⚠️ Hora inicio y fin obligatorias para día extra'); return; }
    }

    const { data: { user } } = await supabase.auth.getUser();
    payload.created_by = user?.id;

    const { error } = await supabase.from('profesionales_excepciones').insert([payload]);
    if (error) { showToast(`❌ ${error.message}`); return; }

    showToast('✅ Excepción registrada');
    cerrarModal('modalExcepciones');
    setTimeout(() => abrirExcepciones(profId), 100);
  };

  // Delete handler
  modal.querySelector('#excList').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del-exc]');
    if (!btn) return;
    if (!confirm('¿Eliminar esta excepción?')) return;
    const id = btn.getAttribute('data-del-exc');
    const { error } = await supabase.from('profesionales_excepciones').delete().eq('id', id);
    if (error) { showToast(`❌ ${error.message}`); return; }
    btn.closest('[data-exc-row]').remove();
    showToast('✅ Excepción eliminada');
  });
}

function renderExcepcion(e) {
  const tipoColor = {
    ausencia: 'rose', feriado: 'amber', vacaciones: 'violet',
    licencia_medica: 'rose', dia_extra: 'emerald', otro: 'slate',
  };
  const tipoLabel = {
    ausencia: 'Ausencia', feriado: 'Feriado', vacaciones: 'Vacaciones',
    licencia_medica: 'Licencia médica', dia_extra: 'Día extra', otro: 'Otro',
  };
  const rango = e.fecha_hasta && e.fecha_hasta !== e.fecha
    ? `${e.fecha} → ${e.fecha_hasta}`
    : e.fecha;
  const hora = (e.hora_inicio && e.hora_fin)
    ? ` ${String(e.hora_inicio).slice(0,5)}-${String(e.hora_fin).slice(0,5)}`
    : '';
  return `
    <div data-exc-row style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border)">
      <span class="badge badge-${tipoColor[e.tipo] || 'slate'}" style="font-size:10px">${tipoLabel[e.tipo] || e.tipo}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(rango)}${escapeHtml(hora)}</div>
        ${e.motivo ? `<div style="font-size:11px;color:var(--text4)">${escapeHtml(e.motivo)}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" data-del-exc="${escapeAttr(e.id)}" style="padding:4px 8px;color:var(--rose)">×</button>
    </div>`;
}
