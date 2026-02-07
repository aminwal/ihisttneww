
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
      throw new Error("GATING_ERROR: Browser not linked to project. Enter URL/Key in Infrastructure Hub.");
    }

    try {
      await this.establishLink();

      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        const status = (error as any).status || 500;
        
        if (status === 500) {
          throw new Error("SERVER_500: Cloud Logic Crash. Check 'Matrix Key Wizard' and redeploy.");
        }
        if (status === 404) {
          throw new Error("SERVER_404: Logic endpoint not found. Ensure project ID in 'Identity Link' matches your terminal.");
        }
        
        throw new Error(`CLOUD_ERROR: ${error.message}`);
      }

      if (data && data.error) {
        throw new Error(`ARCHITECT_REJECTION: ${data.message || data.error}`);
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

  static async isReadyExtended(): Promise<{ online: boolean, error?: string, raw?: string }> {
     if (!IS_CLOUD_ENABLED) return { online: false, error: 'NO_LINK' };
     try {
       const { data, error } = await supabase.functions.invoke('lesson-architect', {
         body: { ping: true }
       });
       
       if (error) {
          const status = (error as any).status;
          if (status === 500) return { online: false, error: 'MISSING_API_KEY', raw: 'Status 500: Server exists but Secrets are missing.' };
          return { online: false, error: 'DEPLOYMENT_REQUIRED', raw: error.message || `Status ${status}: Logic not deployed.` };
       }
       
       if (data && data.status === 'Matrix Online') return { online: true };
       return { online: false, error: 'LOGIC_FAILURE', raw: 'Unexpected server response.' };
     } catch (e: any) {
        return { online: false, error: 'NETWORK_BLOCKED', raw: e.message };
     }
  }
}
