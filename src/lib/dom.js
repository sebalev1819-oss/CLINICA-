// ============================================================
//  Helpers de DOM — escapado HTML y toast
// ============================================================

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para insertar entre etiquetas (innerHTML body) */
export function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => HTML_ESCAPE[c]);
}

/** Escapa para usar dentro de atributos (con quotes dobles) */
export function escapeAttr(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => HTML_ESCAPE[c]);
}

/** Toast compatible con el que define el HTML, con fallback */
export function showToast(msg) {
  if (typeof window.showToast === 'function' && window.showToast !== showToast) {
    window.showToast(msg);
    return;
  }
  // Fallback mínimo si el HTML no define el toast
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-family:Outfit,sans-serif;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,0.2)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
