// ============================================================
//  Helpers de errores — convierte errores crudos de Supabase /
//  PostgREST / red en mensajes humanos para mostrar al usuario.
//
//  Nunca exponer al usuario:
//    • Stack traces
//    • Códigos PG crudos
//    • Mensajes técnicos tipo "schema cache" o "violates constraint"
//
//  Patrón de uso:
//    try { ... }
//    catch (e) {
//      console.error('[Pacientes] Error técnico:', e);   // detalle a consola
//      showToast(formatSupabaseError(e, 'paciente'));    // mensaje humano a UI
//    }
// ============================================================

/**
 * Convierte un error de Supabase/PostgREST en un mensaje humano.
 *
 * @param {Error|object} err            El error crudo (de createClient, .from().insert(), etc.)
 * @param {string}       [contexto]     Sustantivo: 'paciente', 'turno', 'evolución', 'autorización'.
 *                                      Se usa para personalizar el mensaje cuando el código no es específico.
 * @returns {string}                    Mensaje listo para mostrar.
 */
export function formatSupabaseError(err, contexto = 'registro') {
  // Caso 1: red caída
  if (err?.message === 'Failed to fetch' || err?.name === 'TypeError') {
    return '🌐 Sin conexión. Revisá tu internet y reintentá.';
  }

  // Caso 2: el SDK de Supabase devuelve { code, message, details, hint }
  const code    = err?.code || err?.error_code;
  const msg     = err?.message || '';
  const details = err?.details || '';

  // ── Códigos PostgreSQL conocidos ────────────────────────────
  switch (code) {
    case '23505':                        // unique_violation
      return mensajeDuplicado(msg, details, contexto);
    case '23503':                        // foreign_key_violation
      return `Ese ${contexto} hace referencia a algo que ya no existe (paciente, profesional o consultorio borrado).`;
    case '23514':                        // check_violation
      return mensajeCheck(msg, details);
    case '23P01':                        // exclusion_violation (anti-solapamiento)
      return '⚠️ Hay un turno solapado. Elegí otro horario o consultorio.';
    case '22023':                        // invalid_parameter_value (nuestros triggers)
      return msg.replace(/^.*?:\s*/, '') || 'Datos inválidos. Revisá los campos.';
    case '42P01':                        // undefined_table
      return 'El sistema necesita una actualización. Avisá a soporte (tabla faltante).';
    case '42703':                        // undefined_column
      return 'El sistema necesita una actualización. Avisá a soporte (columna faltante).';
    case 'PGRST204':                     // PostgREST: column not in schema cache
      return 'El sistema necesita actualizarse. Probá recargar la página o avisá a soporte.';
    case 'PGRST116':                     // PostgREST: no rows found en .single()
      return 'No encontramos lo que buscabas. Puede haber sido eliminado.';
    case '42501':                        // insufficient_privilege
      return '🔒 No tenés permisos para esta acción. Hablá con un admin.';
  }

  // ── Errores de Supabase Auth ────────────────────────────────
  if (msg.toLowerCase().includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos.';
  }
  if (msg.toLowerCase().includes('email not confirmed')) {
    return 'Tu email todavía no fue confirmado. Revisá tu casilla.';
  }
  if (msg.toLowerCase().includes('user not found')) {
    return 'No encontramos una cuenta con ese email.';
  }
  if (msg.toLowerCase().includes('rate limit')) {
    return 'Demasiados intentos. Esperá un minuto y volvé a probar.';
  }

  // ── Match por palabras clave en el mensaje (último recurso) ─
  if (msg.match(/schema cache|column .+ does not exist/i)) {
    return 'El sistema necesita actualizarse. Probá recargar la página o avisá a soporte.';
  }
  if (msg.match(/jwt expired|invalid jwt/i)) {
    return 'Tu sesión expiró. Volvé a ingresar.';
  }

  // Fallback: nunca exponer el mensaje crudo
  return `No se pudo guardar el ${contexto}. Reintentá en unos segundos.`;
}

// ── Helpers internos ────────────────────────────────────────

function mensajeDuplicado(msg, details, contexto) {
  // PostgreSQL trae el campo en details, ej:
  //   Key (dni)=(31.445.892) already exists.
  const match = (details || msg).match(/Key \(([^)]+)\)=\(([^)]+)\)/);
  if (match) {
    const campo = traducirCampo(match[1]);
    return `Ya existe un ${contexto} con ${campo} "${match[2]}".`;
  }
  return `Ya existe un ${contexto} con esos datos.`;
}

function mensajeCheck(msg, details) {
  // CHECK común: sesiones_validas (sesiones_usadas <= sesiones_auth)
  if (msg.includes('sesiones_validas')) {
    return 'No se pueden registrar más sesiones de las autorizadas.';
  }
  if (msg.includes('score_noshow')) {
    return 'El score de no-show debe estar entre 0 y 100.';
  }
  return 'Algunos datos no cumplen los requisitos. Revisá los campos.';
}

function traducirCampo(campo) {
  const traducciones = {
    'dni':    'DNI',
    'email':  'email',
    'ref':    'referencia',
    'numero': 'número',
    'matricula': 'matrícula',
  };
  return traducciones[campo] || campo;
}
