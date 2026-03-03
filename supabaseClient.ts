
import { createClient } from '@supabase/supabase-js';

/**
 * Aggressive environment variable resolution for Supabase.
 * This version is designed to catch variables even if Vercel/Vite injection is being stubborn.
 */
const getSupabaseConfig = () => {
  const check = (val: any) => (val && typeof val === 'string' && val.length > 10 && !val.includes('placeholder')) ? val : null;

  // 1. LocalStorage (Manual Override)
  const localUrl = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL');
  const localKey = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');
  if (check(localUrl) && check(localKey)) return { url: localUrl!.trim(), key: localKey!.trim(), source: 'Manual Override' };

  // 2. Standard Vite (import.meta.env)
  // @ts-ignore
  const vUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null;
  // @ts-ignore
  const vKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null;
  if (check(vUrl) && check(vKey)) return { url: vUrl, key: vKey, source: 'Vite Standard' };

  // 3. Process Env (Vite Define / Node Fallback)
  // @ts-ignore
  const pUrl = typeof process !== 'undefined' && process.env ? (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) : null;
  // @ts-ignore
  const pKey = typeof process !== 'undefined' && process.env ? (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY) : null;
  if (check(pUrl) && check(pKey)) return { url: pUrl, key: pKey, source: 'Build Injection' };

  // 4. Global Window (Manual Script Injection)
  // @ts-ignore
  const wUrl = (window as any).VITE_SUPABASE_URL || (window as any).SUPABASE_URL;
  // @ts-ignore
  const wKey = (window as any).VITE_SUPABASE_ANON_KEY || (window as any).SUPABASE_ANON_KEY;
  if (check(wUrl) && check(wKey)) return { url: wUrl, key: wKey, source: 'Window Global' };

  return { url: '', key: '', source: 'None Found' };
};

const config = getSupabaseConfig();
export const IS_CLOUD_ENABLED = !!config.url && !!config.key;
export const CONFIG_SOURCE = config.source;

// Masked values for diagnostics
export const getMaskedConfig = () => ({
  source: config.source,
  url: config.url ? `${config.url.substring(0, 12)}...` : 'MISSING',
  key: config.key ? `...${config.key.substring(config.key.length - 8)}` : 'MISSING'
});

if (!IS_CLOUD_ENABLED) {
  console.warn(`[IHIS] Database Link: OFFLINE. Source: ${config.source}`);
} else {
  console.info(`[IHIS] Database Link: ONLINE. Source: ${config.source}`);
}

// Startup Diagnostic Table
console.table({
  "System": "IHIS Matrix",
  "Cloud Status": IS_CLOUD_ENABLED ? "CONNECTED" : "DISCONNECTED",
  "Config Source": config.source,
  "URL Mask": getMaskedConfig().url,
  "Key Mask": getMaskedConfig().key
});

export const supabase = createClient(
  config.url || 'https://placeholder-project.supabase.co', 
  config.key || 'placeholder-key'
);
