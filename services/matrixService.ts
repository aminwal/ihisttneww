
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

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
        console.warn("Matrix Protocol Handshake Interrupted.");
      }
    }
  }

  static async architectRequest(prompt: string, contents: any[] = []) {
    if (!IS_CLOUD_ENABLED) {
      throw new Error("GATING_ERROR: This website is not linked to your Supabase project. Go to the Database (Infrastructure Hub) tab and fill in your Supabase URL and Key.");
    }

    try {
      await this.establishLink();

      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        const msg = error.message?.toLowerCase() || "";
        if (msg.includes("failed to send") || msg.includes("fetch")) {
          throw new Error("GATING_ERROR: Connection Blocked. The Cloud Logic is not active. Run 'npx supabase functions deploy lesson-architect' in your GitHub Terminal.");
        }
        if (msg.includes("500") || msg.includes("api_key")) {
          throw new Error("GATING_ERROR: Cloud Key Missing. Run 'npx supabase secrets set API_KEY=...' in your GitHub Terminal.");
        }
        throw new Error(`CLOUD_ERROR: ${error.message}`);
      }

      if (data && data.error) {
        if (data.error === 'MISSING_API_KEY') {
          throw new Error("GATING_ERROR: Missing Gemini Key on server. Check your Cloud Secrets.");
        }
        throw new Error(`LOGIC_ERROR: ${data.error}`);
      }

      return data;
    } catch (err: any) {
      console.error("Matrix Network Failure:", err);
      throw err;
    }
  }

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

  static async isReadyExtended(): Promise<{ online: boolean, error?: string }> {
     if (!IS_CLOUD_ENABLED) return { online: false, error: 'NO_LINK' };
     try {
       const { data, error } = await supabase.functions.invoke('lesson-architect', {
         body: { ping: true }
       });
       if (error) return { online: false, error: 'DEPLOYMENT_REQUIRED' };
       if (data && data.status === 'Matrix Online') return { online: true };
       return { online: false, error: 'LOGIC_FAILURE' };
     } catch (e: any) {
        if (e.message?.includes("500")) return { online: false, error: 'MISSING_API_KEY' };
        return { online: false, error: 'NETWORK_BLOCKED' };
     }
  }
}
