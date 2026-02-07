
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
        
        // Contextualized for GitHub Environment
        if (msg.includes("failed to send") || msg.includes("fetch")) {
          throw new Error("GATING_ERROR: The AI Bridge is not active in the cloud. Open your GitHub Terminal and run: 'npx supabase functions deploy lesson-architect'. Verify your Project Reference ID is correctly linked.");
        }
        
        if (msg.includes("404") || msg.includes("not found")) {
          throw new Error("DEPLOYMENT_ERROR: The AI Logic is missing from your cloud cluster. In your GitHub terminal, execute: 'npx supabase functions deploy lesson-architect'.");
        }
        
        if (msg.includes("500") || msg.includes("internal server error") || msg.includes("api_key")) {
          throw new Error("SECURITY_ERROR: The Matrix Key (API_KEY) is missing from the cloud. Run the Matrix Key Wizard in the Infrastructure Hub to authorize the server.");
        }

        throw new Error(`CLOUD_ERROR: ${error.message}`);
      }

      if (data && data.error) {
        if (data.error.includes("API_KEY")) {
           throw new Error("SECURITY_ERROR: Missing Gemini API Key on server. Run Matrix Key Wizard in Infrastructure Hub.");
        }
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

  /**
   * Detailed check for UI state feedback
   */
  static async isReadyExtended(): Promise<{ online: boolean, error?: string }> {
     if (!IS_CLOUD_ENABLED) return { online: false, error: 'NO_CLOUD' };
     try {
       const { data, error } = await supabase.functions.invoke('lesson-architect', {
         body: { ping: true }
       });
       if (error) return { online: false, error: 'NOT_DEPLOYED' };
       if (data && data.status === 'Matrix Online') return { online: true };
       return { online: false, error: 'UNKNOWN' };
     } catch (e: any) {
        if (e.message?.includes("500")) return { online: false, error: 'MISSING_API_KEY' };
        return { online: false, error: 'NOT_DEPLOYED' };
     }
  }
}
