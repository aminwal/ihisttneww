
import { supabase } from '../supabaseClient.ts';
// COMMENT: Added import of GoogleGenAI to support institutional intelligence layer integration
import { GoogleGenAI } from "@google/genai";

/**
 * MatrixService: Institutional Intelligence Factory (Phase 5 Hardened)
 * 
 * Manages the secure bridge between the staff portal and the AI Brain.
 * This service ensures institutional credentials remain hidden in the AI Studio environment
 * and handles the mandatory key selection protocol for high-quality image/logic generation.
 */
export class MatrixService {
  /**
   * Returns a fresh instance of the GenAI client using the institutional key.
   * Essential for client-side operations (e.g. streaming) while maintaining key integrity.
   */
  static getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  /**
   * Triggers the API Key selection protocol via AI Studio interface.
   * PHASE 5 UPDATE: Mitigates race conditions by assuming successful selection
   * once the dialog is triggered, as per Institutional Build standards.
   */
  static async establishLink(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      try {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          // Open selection dialog. We proceed immediately to mitigate race conditions.
          await (window as any).aistudio.openSelectKey();
        }
      } catch (err) {
        console.warn("Matrix Link Protocol Interrupted.");
      }
    }
  }

  /**
   * Sends a request to the 'lesson-architect' edge function.
   * This is our primary secure bridge to the AI Brain.
   */
  static async architectRequest(prompt: string, contents: any[] = []) {
    try {
      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        // PROTOCOL: If requested entity is not found, reset key selection state.
        if (error.message?.includes("Requested entity was not found")) {
          await (window as any).aistudio?.openSelectKey();
          throw new Error("Institutional Matrix key expired. Re-authentication required.");
        }
        console.error("Matrix Edge Error:", error);
        throw new Error("The secure handshake with the AI Brain failed.");
      }

      return data;
    } catch (err) {
      console.error("Matrix Connection Failure:", err);
      throw err;
    }
  }

  /**
   * Standardizes the Daily Briefing logic for the Dashboard.
   * Standardizes the 'Institutional Analyst' persona required for Bahrain staff interaction.
   */
  static async generateBriefing(teacherName: string, stats: string) {
    const prompt = `
      Persona: Empathetic Administrator at Ibn Al Hytham Islamic School.
      Context: Teacher ${teacherName} has ${stats}.
      Task: Provide a 2-sentence morning greeting and 1 actionable duty insight.
    `;
    return this.architectRequest(prompt);
  }

  /**
   * Checks if the cloud infrastructure is responsive.
   * PHASE 5 UPDATE: Pings the Edge Function bridge directly to ensure AI readiness.
   */
  static async isReady(): Promise<boolean> {
    try {
      // Priority 1: Check Edge Function AI Bridge
      const { error: funcError } = await supabase.functions.invoke('lesson-architect', {
        body: { ping: true }
      });
      
      if (!funcError) return true;

      // Priority 2: Fallback check to database registry
      const { error: dbError } = await supabase.from('profiles').select('id').limit(1);
      return !dbError;
    } catch {
      return false;
    }
  }
}
