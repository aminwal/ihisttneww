
import { IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

export class MatrixService {
  static getAPIKey(): string {
    // 1. Check LocalStorage (User Manual Override)
    const stored = localStorage.getItem('IHIS_GEMINI_KEY') || localStorage.getItem('GEMINI_API_KEY') || localStorage.getItem('API_KEY');
    if (stored && stored.trim() !== '' && stored !== 'undefined' && !stored.includes('TODO')) return stored.trim();

    // 2. Check for platform-injected API_KEY (highest priority for Gemini 3 models)
    // @ts-ignore
    const platformKey = typeof process !== 'undefined' && process.env ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : null;
    if (platformKey && platformKey !== 'undefined' && platformKey !== '' && !platformKey.includes('TODO')) return platformKey;

    // 2b. Check for direct window injection (common in some preview environments)
    // @ts-ignore
    const windowKey = window.API_KEY || window.GEMINI_API_KEY;
    if (windowKey && windowKey !== 'undefined' && windowKey !== '' && !windowKey.includes('TODO')) return windowKey;

    // 3. Check import.meta.env (Vite)
    // @ts-ignore
    const metaKey = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || import.meta.env.API_KEY) : null;
    if (metaKey && metaKey !== 'undefined' && metaKey !== '' && !metaKey.includes('TODO')) return metaKey;

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
    try {
      // Constructing the payload
      let generationPayload: any;
      if (contents && contents.length > 0) {
        generationPayload = { parts: [...contents, { text: prompt }] };
      } else {
        generationPayload = [{ parts: [{ text: prompt }] }];
      }

      // Default system instruction if no specific config is passed
      const config = {
        systemInstruction: "You are an AI Analyst for Ibn Al Hytham Islamic School. Maintain a formal, analytical tone.",
        ...configOverride
      };

      // Try calling the backend proxy first
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: 'gemini-3-flash-preview',
            contents: generationPayload,
            config: config
          })
        });

        if (response.ok) {
          const data = await response.json();
          // The proxy returns the full GenerateContentResponse object
          // We need to handle it correctly. The proxy returns the object from ai.models.generateContent
          // which has a .text property (getter) in the SDK, but when serialized to JSON it might be different.
          // Actually, the SDK's response object when JSON.stringified usually has candidates[0].content.parts[0].text
          
          let text = "";
          if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            text = data.candidates[0].content.parts[0].text;
          } else if (data.text) {
            text = data.text;
          }
          
          return { text };
        }
        
        const errorData = await response.json();
        if (errorData.error?.includes("GATING_ERROR")) {
          // If server key is missing, we might want to fallback to local key if available
          console.warn("Server-side key missing, checking local fallback...");
        } else {
          throw new Error(errorData.error || "Backend AI request failed");
        }
      } catch (proxyErr) {
        console.warn("Backend AI proxy failed or not available, trying local fallback:", proxyErr);
      }

      // Fallback to local SDK if backend fails or key is missing
      const apiKey = this.getAPIKey();
      if (!apiKey) {
        throw new Error("GATING_ERROR: Gemini API Key missing. Please configure it in the Infrastructure Hub.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: generationPayload,
        config: config
      });

      return { text: response.text || "" };
    } catch (err: any) {
      console.error("Matrix AI Execution Failure:", err);
      throw new Error(`AI_ERROR: ${err.message}`);
    }
  }

  static async generateMatrix(
    timetable: any[], 
    config: any, 
    constraints: any
  ): Promise<any> {
    const prompt = `
      Analyze the current timetable data and generate a matrix view.
      Timetable: ${JSON.stringify(timetable).substring(0, 1000)}...
      Config: ${JSON.stringify(config).substring(0, 500)}...
      Constraints: ${JSON.stringify(constraints)}
      
      Return a JSON object with:
      - matrix: 2D array of [Day][Slot]
      - conflicts: array of conflict objects
      - optimizationScore: number 0-100
    `;
    
    // Use architectRequest which handles the API call
    try {
      const response = await this.architectRequest(prompt);
      // Clean up markdown code blocks if present
      const cleanJson = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to generate matrix", e);
      return { matrix: [], conflicts: [], optimizationScore: 0 };
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
