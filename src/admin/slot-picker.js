// ============================================================
//  RehabMed ERP — Slot picker para modal Nuevo Turno
//
//  Cuando el user elige profesional + fecha, llama al RPC
//  `slots_disponibles` y muestra los horarios libres como pills
//  clickeables que pre-cargan el input de hora.
//
//  Beneficio: la recepción no tiene que tipear horarios al azar
//  ni recordar los horarios del profesional. Solo elige slots
//  que el sistema garantiza que están dentro de su disponibilidad
//  (y no chocan con otros turnos).
// ============================================================
import { supabase } from '../lib/supabase.js';
import { escapeHtml } from '../lib/dom.js';

// Cache de la última query para no spammear Supabase si los inputs
// cambian rápidamente (ej: typing).
let _lastQuery = { profId: null, fecha: null };
let _debounceTimer = null;

const COLOR_OCUPADO = '#ef4444';
const COLOR_LIBRE = '#10b981';

export function instalarSlotPicker() {
  const profInput  = document.getElementById('turnoProf');
  const fechaInput = document.getElementById('turnoFecha');
  const horaInput  = document.getElementById('turnoHora');
  const wrap       = document.getElementById('turnoSlotsWrap');
  const list       = document.getElementById('turnoSlotsList');

  if (!profInput || !fechaInput || !wrap || !list) {
    console.warn('[SlotPicker] Inputs del modal no encontrados — no instalo');
    return;
  }

  const onChange = () => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(actualizarSlots, 300);
  };

  profInput.addEventListener('change', onChange);
  profInput.addEventListener('blur', onChange);
  fechaInput.addEventListener('change', onChange);

  // Click en una pill libre → setea hora
  list.addEventListener('click', (ev) => {
    const pill = ev.target.closest('[data-slot-hora]');
    if (!pill) return;
    if (pill.getAttribute('data-slot-ocupado') === 'true') {
      // No bloqueamos pero avisamos
      const turno = pill.getAttribute('data-slot-paciente');
      if (!confirm(`Ese horario ya tiene turno con ${turno}. ¿Seguro querés agendar igual?`)) return;
    }
    horaInput.value = pill.getAttribute('data-slot-hora');
    horaInput.dispatchEvent(new Event('change'));
    // Resaltar el seleccionado
    list.querySelectorAll('[data-slot-hora]').forEach(p => p.classList.remove('slot-selected'));
    pill.classList.add('slot-selected');
  });

  console.log('[SlotPicker] ✅ Instalado en modal Nuevo Turno');
}

async function actualizarSlots() {
  const profInput  = document.getElementById('turnoProf');
  const fechaInput = document.getElementById('turnoFecha');
  const wrap       = document.getElementById('turnoSlotsWrap');
  const titulo     = document.getElementById('turnoSlotsTitulo');
  const resumen    = document.getElementById('turnoSlotsResumen');
  const list       = document.getElementById('turnoSlotsList');

  const profNombre = (profInput.value || '').trim();
  const fecha      = (fechaInput.value || '').trim();

  if (!profNombre || !fecha) {
    wrap.style.display = 'none';
    return;
  }

  // Resolver profesional por nombre
  const prof = (window.PROFESIONALES_DATA || []).find(p =>
    p.nombre === profNombre || p.nombre?.toLowerCase() === profNombre.toLowerCase()
  );
  if (!prof) {
    wrap.style.display = 'block';
    titulo.textContent = '⚠️ Profesional no encontrado';
    resumen.textContent = '';
    list.innerHTML = `<div style="font-size:12px;color:var(--text4);padding:8px">Verificá el nombre del profesional. Tiene que coincidir con uno cargado en el sistema.</div>`;
    return;
  }

  // Evitar query duplicada
  if (_lastQuery.profId === prof.id && _lastQuery.fecha === fecha) return;
  _lastQuery = { profId: prof.id, fecha };

  wrap.style.display = 'block';
  titulo.textContent = `🔍 Buscando slots de ${prof.nombre}...`;
  resumen.textContent = '';
  list.innerHTML = '';

  try {
    // Llamar al RPC slots_disponibles
    const { data: slots, error } = await supabase.rpc('slots_disponibles', {
      p_profesional_id: prof.id,
      p_fecha: fecha,
    });

    if (error) throw error;

    if (!slots || slots.length === 0) {
      titulo.textContent = `🚫 ${prof.nombre} no atiende ese día`;
      resumen.textContent = '';
      list.innerHTML = `
        <div style="font-size:12px;color:var(--text3);padding:10px;text-align:center;width:100%">
          No hay franjas configuradas para ${formatearDia(fecha)}.<br>
          <span style="font-size:11px;color:var(--text4)">Configurá horarios desde la ficha del profesional o cargá una excepción de "día extra".</span>
        </div>`;
      return;
    }

    // Cargar info de pacientes para los ocupados (en batch)
    const turnoIds = slots.filter(s => s.ocupado && s.turno_id).map(s => s.turno_id);
    let pacMap = {};
    if (turnoIds.length > 0) {
      const { data: turnos } = await supabase
        .from('v_turnos_dia')
        .select('id, pac_nombre, estado')
        .in('id', turnoIds);
      (turnos || []).forEach(t => { pacMap[t.id] = t; });
    }

    const libres = slots.filter(s => !s.ocupado).length;
    const ocupados = slots.length - libres;

    titulo.textContent = `📅 Slots de ${prof.nombre} — ${formatearDia(fecha)}`;
    resumen.innerHTML = `
      <strong style="color:var(--emerald)">${libres}</strong> libres ·
      <strong style="color:var(--rose)">${ocupados}</strong> ocupados
    `;

    list.innerHTML = slots.map(s => {
      const hora = String(s.hora_inicio).slice(0, 5);
      const turno = pacMap[s.turno_id];
      if (s.ocupado) {
        const pac = turno?.pac_nombre || 'Reservado';
        return `
          <button type="button"
                  data-slot-hora="${hora}"
                  data-slot-ocupado="true"
                  data-slot-paciente="${escapeHtml(pac)}"
                  title="Ocupado: ${escapeHtml(pac)} — ${escapeHtml(turno?.estado || '')}"
                  style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:#dc2626;padding:6px 10px;border-radius:6px;font-family:var(--mono);font-weight:700;font-size:12px;cursor:pointer;opacity:0.6">
            ${hora} 🔒
          </button>`;
      }
      return `
        <button type="button"
                data-slot-hora="${hora}"
                data-slot-ocupado="false"
                title="Libre — click para usar"
                style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.4);color:#059669;padding:6px 10px;border-radius:6px;font-family:var(--mono);font-weight:700;font-size:12px;cursor:pointer;transition:all 0.15s"
                onmouseover="this.style.background='rgba(16,185,129,0.25)'"
                onmouseout="this.style.background='rgba(16,185,129,0.1)'">
          ${hora}
        </button>`;
    }).join('');

    // Inyectar estilo de slot-selected si no existe
    if (!document.getElementById('slotPickerStyles')) {
      const st = document.createElement('style');
      st.id = 'slotPickerStyles';
      st.textContent = `
        [data-slot-hora].slot-selected {
          background: rgba(3,105,161,0.2) !important;
          border-color: var(--sky) !important;
          color: var(--sky) !important;
          box-shadow: 0 0 0 2px rgba(3,105,161,0.3);
        }
      `;
      document.head.appendChild(st);
    }
  } catch (err) {
    console.warn('[SlotPicker]', err);
    titulo.textContent = '⚠️ No se pudieron cargar los slots';
    list.innerHTML = `<div style="font-size:11px;color:var(--text4);padding:8px">Podés cargar la hora manualmente. (Error: ${escapeHtml(err.message || err.code || '?')})</div>`;
  }
}

function formatearDia(iso) {
  const d = new Date(iso + 'T12:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

// Auto-instalar cuando se importe
window.SlotPickerMod = { instalarSlotPicker, actualizarSlots };
