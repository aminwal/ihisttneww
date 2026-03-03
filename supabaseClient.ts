
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

  // 2. Check for Vite-specific env (import.meta.env) - MUST BE STATICALLY ACCESSED
  // @ts-ignore
  const viteUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null;
  // @ts-ignore
  const viteKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null;

  if (viteUrl && viteKey) {
    return { url: viteUrl, key: viteKey };
  }

  // 3. Check for process.env (Standard Node/Legacy)
  // @ts-ignore
  const procUrl = typeof process !== 'undefined' && process.env ? (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) : null;
  // @ts-ignore
  const procKey = typeof process !== 'undefined' && process.env ? (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY) : null;

  if (procUrl && procKey) {
    return { url: procUrl, key: procKey };
  }

  // 4. Check global objects (window/globalThis)
  // @ts-ignore
  const globalUrl = (globalThis as any).VITE_SUPABASE_URL || (window as any).VITE_SUPABASE_URL;
  // @ts-ignore
  const globalKey = (globalThis as any).VITE_SUPABASE_ANON_KEY || (window as any).VITE_SUPABASE_ANON_KEY;

  return { url: globalUrl || '', key: globalKey || '' };
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
