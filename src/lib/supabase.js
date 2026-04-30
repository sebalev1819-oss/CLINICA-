// ============================================================
//  RehabMed ERP — Cliente Supabase
//  Las credenciales vienen de variables de entorno (Vite)
//  Definir en Netlify > Site settings > Environment variables:
//    VITE_SUPABASE_URL
//    VITE_SUPABASE_ANON_KEY
// ============================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error(
    '[Supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.\n' +
    'Creá un .env local (ver .env.example) o configuralas en Netlify.'
  );
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON || '', {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});

export const auth = supabase.auth;
export const db   = supabase.from.bind(supabase);
export const rt   = supabase.channel.bind(supabase);
