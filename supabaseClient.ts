
import { createClient } from '@supabase/supabase-js';

/**
 * Robust environment variable resolution for Supabase.
 * Checks multiple sources to ensure connectivity in various deployment environments.
 */
const getSupabaseConfig = () => {
  const check = (val: any) => (val && typeof val === 'string' && val.length > 10 && !val.includes('placeholder')) ? val : null;

  // 1. Check LocalStorage (User Manual Override) - HIGHEST PRIORITY
  const localUrl = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL');
  const localKey = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');
  if (check(localUrl) && check(localKey)) {
    return { url: localUrl!.trim(), key: localKey!.trim(), source: 'LocalStorage' };
  }

  // 2. Check process.env (Injected by Vite define block)
  // @ts-ignore
  const procUrl = typeof process !== 'undefined' && process.env ? process.env.VITE_SUPABASE_URL : null;
  // @ts-ignore
  const procKey = typeof process !== 'undefined' && process.env ? process.env.VITE_SUPABASE_ANON_KEY : null;
  if (check(procUrl) && check(procKey)) {
    return { url: procUrl, key: procKey, source: 'ProcessEnv' };
  }

  // 3. Check import.meta.env (Standard Vite)
  // @ts-ignore
  const viteUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null;
  // @ts-ignore
  const viteKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null;
  if (check(viteUrl) && check(viteKey)) {
    return { url: viteUrl, key: viteKey, source: 'ImportMeta' };
  }

  // 4. Check global window object (Last resort for manual injection)
  // @ts-ignore
  const winUrl = (window as any).VITE_SUPABASE_URL;
  // @ts-ignore
  const winKey = (window as any).VITE_SUPABASE_ANON_KEY;
  if (check(winUrl) && check(winKey)) {
    return { url: winUrl, key: winKey, source: 'Window' };
  }

  return { url: '', key: '', source: 'None' };
};

const { url: supabaseUrl, key: supabaseAnonKey, source: configSource } = getSupabaseConfig();

export const IS_CLOUD_ENABLED = !!supabaseUrl && !!supabaseAnonKey;

if (!IS_CLOUD_ENABLED) {
  console.warn(`[IHIS] Database Link: OFFLINE (Local Mode). Source: ${configSource}`);
} else {
  console.info(`[IHIS] Database Link: ONLINE (Cloud Mode). Source: ${configSource}`);
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);
