
import { IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

export class MatrixService {
  static getAPIKey(): string {
    return localStorage.getItem('IHIS_GEMINI_KEY') || '';
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
      const config = configOverride || {
        systemInstruction: "You are an AI Analyst for Ibn Al Hytham Islamic School. Maintain a formal, analytical tone.",
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Institutional standard for high-complexity text/JSON
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
