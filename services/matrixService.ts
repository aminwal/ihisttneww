
import { supabase } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

/**
 * MatrixService: Institutional Intelligence Factory (Phase 7 Hardened)
 * Handlers for AI Architect and Cloud Handshakes.
 */
export class MatrixService {
  static getAI() {
    // Note: process.env.API_KEY is for internal SDK usage within the Edge Function environment.
    return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  static async establishLink(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      try {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio.openSelectKey();
        }
      } catch (err) {
        console.warn("Matrix Link Protocol Interrupted.");
      }
    }
  }

  static async architectRequest(prompt: string, contents: any[] = []) {
    try {
      await this.establishLink();

      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        // Detailed Cloud Diagnostics for the user
        const msg = error.message?.toLowerCase() || "";
        
        if (msg.includes("404") || msg.includes("not found")) {
          throw new Error("DEPLOYMENT_ERROR: The AI Architect is not deployed. Run 'npx supabase functions deploy lesson-architect' in your terminal.");
        }
        
        if (msg.includes("500") || msg.includes("internal server error") || msg.includes("api_key")) {
          throw new Error("SECURITY_ERROR: The Matrix Key is missing. Run 'npx supabase secrets set API_KEY=...' to authorize your Gemini Key.");
        }

        throw new Error(`CLOUD_ERROR: ${error.message}`);
      }

      // Check if the response from the function itself contains an error
      if (data && data.error) {
        throw new Error(`MATRIX_LOGIC_ERROR: ${data.error}`);
      }

      return data;
    } catch (err: any) {
      console.error("Matrix Connection Failure:", err);
      throw err;
    }
  }

  /**
   * Pings the Edge Function to ensure the bridge is alive.
   */
  static async isReady(): Promise<boolean> {
    try {
      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { ping: true }
      });
      return !error && data && data.status === 'Matrix Online';
    } catch {
      return false;
    }
  }
}
