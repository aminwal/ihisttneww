
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

/**
 * MatrixService: Institutional Intelligence Factory (Phase 8 Hardened)
 * Handlers for AI Architect and Cloud Handshakes.
 */
export class MatrixService {
  static getAI() {
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
    if (!IS_CLOUD_ENABLED) {
      throw new Error("OFFLINE_ERROR: The system is in Local Mode. Link Supabase in the Infrastructure Hub to use AI.");
    }

    try {
      await this.establishLink();

      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        const msg = error.message?.toLowerCase() || "";
        
        // Network or Existence failure
        if (msg.includes("failed to send") || msg.includes("fetch")) {
          throw new Error("GATING_ERROR: Failed to reach the AI Brain. Ensure you have run 'npx supabase functions deploy lesson-architect' and that your Reference ID is correct.");
        }
        
        if (msg.includes("404") || msg.includes("not found")) {
          throw new Error("DEPLOYMENT_ERROR: The AI Architect is missing from your project. Run 'npx supabase functions deploy lesson-architect' in your terminal.");
        }
        
        if (msg.includes("500") || msg.includes("internal server error") || msg.includes("api_key")) {
          throw new Error("SECURITY_ERROR: The Matrix Key is missing. Run 'npx supabase secrets set API_KEY=...' in your terminal.");
        }

        throw new Error(`CLOUD_ERROR: ${error.message}`);
      }

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
    if (!IS_CLOUD_ENABLED) return false;
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
