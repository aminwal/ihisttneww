
import { IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

export class MatrixService {
  static getAPIKey(): string {
    // 1. Check LocalStorage (User Manual Override)
    const stored = localStorage.getItem('IHIS_GEMINI_KEY') || localStorage.getItem('GEMINI_API_KEY') || localStorage.getItem('API_KEY');
    if (stored && stored.trim() !== '' && stored !== 'undefined') return stored.trim();

    // 2. Check for platform-injected API_KEY (highest priority for Gemini 3 models)
    // @ts-ignore
    const platformKey = typeof process !== 'undefined' && process.env ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : null;
    if (platformKey && platformKey !== 'undefined' && platformKey !== '') return platformKey;

    // 2b. Check for direct window injection (common in some preview environments)
    // @ts-ignore
    const windowKey = window.API_KEY || window.GEMINI_API_KEY;
    if (windowKey && windowKey !== 'undefined' && windowKey !== '') return windowKey;

    // 3. Check import.meta.env (Vite)
    // @ts-ignore
    const metaKey = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || import.meta.env.API_KEY) : null;
    if (metaKey && metaKey !== 'undefined' && metaKey !== '') return metaKey;

    return '';
  }

  static async hasKey(): Promise<boolean> {
    const key = this.getAPIKey();
    if (key) return true;

    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
      try {
        // @ts-ignore
        return await window.aistudio.hasSelectedApiKey();
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  static async ensureKey(): Promise<boolean> {
    if (await this.hasKey()) return true;

    // If no key, try to use the platform's key selection dialog if available
    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      try {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        // After opening the dialog, we assume success as per guidelines to avoid race conditions
        return true;
      } catch (e) {
        console.error("Failed to open key selection dialog:", e);
      }
    }
    return false;
  }

  static async establishLink(): Promise<void> {
    // Retained for interface compatibility, but execution is now local.
    return Promise.resolve();
  }

  static async architectRequest(prompt: string, contents: any[] = [], configOverride: any = null) {
    const apiKey = this.getAPIKey();
    if (!apiKey) {
      throw new Error("GATING_ERROR: Gemini API Key missing. Please configure it in the Infrastructure Hub.");
    }

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Constructing the payload based on the Gemini 2.5 SDK structure
      let generationPayload: any;
      if (contents && contents.length > 0) {
        generationPayload = { parts: [...contents, { text: prompt }] };
      } else {
        generationPayload = prompt;
      }

      // Default system instruction if no specific config is passed
      const config = {
        systemInstruction: "You are an AI Analyst for Ibn Al Hytham Islamic School. Maintain a formal, analytical tone.",
        ...configOverride
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', // Switched to Flash to bypass Pro free-tier quota limits
        contents: generationPayload,
        config: config
      });

      return { text: response.text || "" };
    } catch (err: any) {
      console.error("Matrix AI Execution Failure:", err);
      throw new Error(`AI_ERROR: ${err.message}`);
    }
  }

  static async isReady(): Promise<boolean> {
    return !!this.getAPIKey();
  }

  static async isReadyExtended(): Promise<{ online: boolean, error?: string, raw?: string }> {
     const key = this.getAPIKey();
     if (!key) return { online: false, error: 'MISSING_API_KEY', raw: 'API Key not found in local browser storage.' };
     return { online: true };
  }
}
