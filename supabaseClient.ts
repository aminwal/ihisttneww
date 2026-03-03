
import { createClient } from '@supabase/supabase-js';

/**
 * Robust environment variable resolution for Supabase.
 * Checks LocalStorage, import.meta.env (Vite), process.env (Node), and window.
 */
const getSupabaseConfig = () => {
  // 1. Check LocalStorage (User Manual Override) - HIGHEST PRIORITY
  const localUrl = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL');
  const localKey = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');

  if (localUrl && localKey && localUrl.trim() !== '' && localKey.trim() !== '') {
    return { url: localUrl.trim(), key: localKey.trim() };
  }

  // 2. Check process.env (Injected by Vite define block in vite.config.ts)
  // This is the most robust method as it catches variables even if the VITE_ prefix was forgotten in Vercel.
  // @ts-ignore
  const procUrl = process.env.VITE_SUPABASE_URL;
  // @ts-ignore
  const procKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (procUrl && procKey) {
    return { url: procUrl, key: procKey };
  }

  // 3. Fallback to import.meta.env
  // @ts-ignore
  const viteUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null;
  // @ts-ignore
  const viteKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null;

  return { url: viteUrl || '', key: viteKey || '' };
};

const { url: supabaseUrl, key: supabaseAnonKey } = getSupabaseConfig();

// Export connectivity state for UI components
export const IS_CLOUD_ENABLED = !!supabaseUrl && 
                               !!supabaseAnonKey && 
                               !supabaseUrl.includes('placeholder') && 
                               supabaseUrl.startsWith('http');

// Provide precise diagnostic advice for developers
if (!IS_CLOUD_ENABLED) {
  const missing = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  
  console.info(`IHIS Infrastructure: System initialized in LOCAL MODE. Cloud sync is disabled. Missing: ${missing.join(', ')}.`);
} else {
  console.info("IHIS Infrastructure: Cloud Link Established.");
}

// Initialize client with safe defaults to prevent runtime crashes
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);
