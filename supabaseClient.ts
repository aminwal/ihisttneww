
import { createClient } from '@supabase/supabase-js';

/**
 * Robust environment variable resolution for Supabase.
 * Checks LocalStorage, import.meta.env (Vite), process.env (Node), and window.
 */
const getSupabaseConfig = () => {
  const getVar = (name: string): string => {
    try {
      // 1. Check LocalStorage (User Manual Override) - HIGHEST PRIORITY
      const stored = localStorage.getItem(`IHIS_CFG_${name}`);
      if (stored && stored.trim() !== '') return stored.trim();

      // 2. Check for Vite-specific env (import.meta.env)
      // @ts-ignore
      const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env[name] : null;
      if (metaEnv) return metaEnv;

      // 3. Check for process.env (Standard Node/Legacy)
      // @ts-ignore
      const procEnv = typeof process !== 'undefined' && process.env ? process.env[name] : null;
      if (procEnv) return procEnv;

      // 4. Check global objects (window/globalThis)
      // @ts-ignore
      const globalEnv = (globalThis as any)[name] || (window as any)[name];
      if (globalEnv) return globalEnv;

    } catch (e) {
      console.warn("IHIS Configuration: Error accessing " + name);
    }
    return '';
  };

  // Try VITE_ prefixed versions first (Vite standard), then fallback to raw names
  const url = getVar('VITE_SUPABASE_URL') || getVar('SUPABASE_URL');
  const key = getVar('VITE_SUPABASE_ANON_KEY') || getVar('SUPABASE_ANON_KEY');

  return { url, key };
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
