// ============================================================
//  RehabMed ERP — Cliente Supabase
//  Reemplaza: arrays hardcodeados + localStorage
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Configuración ─────────────────────────────────────────
// IMPORTANTE: pegar acá los valores de Supabase > Settings > API
//   - SUPABASE_URL: "Project URL"
//   - SUPABASE_ANON: "anon public" key (es PÚBLICA por diseño,
//     la seguridad real está en las RLS policies del schema)
const SUPABASE_URL  = 'https://TU_PROYECTO.supabase.co';   // ← REEMPLAZAR
const SUPABASE_ANON = 'TU_ANON_PUBLIC_KEY';                // ← REEMPLAZAR

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:    true,
    persistSession:      true,      // guarda sesión en localStorage
    detectSessionInUrl:  false,
  },
});

// ── Re-exports de helpers frecuentes ─────────────────────
export const auth = supabase.auth;
export const db   = supabase.from.bind(supabase);
export const rt   = supabase.channel.bind(supabase);
