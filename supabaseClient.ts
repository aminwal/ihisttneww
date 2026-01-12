
import { createClient } from '@supabase/supabase-js';

/**
 * Robust environment variable resolution for Supabase.
 * Prioritizes Manual Overrides (LocalStorage) then Environment Variables.
 */
const getSupabaseConfig = () => {
  const getVar = (name: string): string => {
    try {
      // 1. Check LocalStorage (User Manual Override from DeploymentView) - HIGHEST PRIORITY
      const stored = localStorage.getItem(`IHIS_CFG_${name}`);
      if (stored && stored.trim() !== '') return stored.trim();

      // 2. Check process.env (Node/AI Studio)
      if (typeof process !== 'undefined' && process.env && process.env[name]) {
        return process.env[name] as string;
      }
      // 3. Check import.meta.env (Vite)
      if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[name]) {
        return (import.meta as any).env[name];
      }
    } catch (e) {
      console.warn("IHIS: Error accessing config for " + name);
    }
    return '';
  };

  const url = getVar('VITE_SUPABASE_URL') || getVar('SUPABASE_URL');
  const key = getVar('VITE_SUPABASE_ANON_KEY') || getVar('SUPABASE_ANON_KEY');

  return { url, key };
};

const { url: supabaseUrl, key: supabaseAnonKey } = getSupabaseConfig();

// Fix: Export IS_CLOUD_ENABLED
export const IS_CLOUD_ENABLED = !!supabaseUrl && !!supabaseAnonKey && !supabaseUrl.includes('placeholder');

// Use an informative log instead of an error to prevent user alarm during local-first operation
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
  console.info("IHIS: Local Persistence Mode Active (Cloud Disconnected).");
} else {
  console.info("IHIS: Cloud Infrastructure Linked. Endpoint: " + supabaseUrl);
}

// Initialize client with placeholders if keys are missing to prevent application crash.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);
