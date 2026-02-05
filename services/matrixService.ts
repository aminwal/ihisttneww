
import { supabase } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";

/**
 * MatrixService: Institutional Intelligence Factory (Phase 6 Hardened)
 * 
 * Manages the secure bridge between the staff portal and the AI Brain.
 */
export class MatrixService {
  /**
   * Returns a fresh instance of the GenAI client.
   * Note: We exclusively use process.env.API_KEY as per coding guidelines.
   */
  static getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  /**
   * Triggers the API Key selection protocol via AI Studio interface.
   */
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

  /**
   * Sends a request to the 'lesson-architect' edge function.
   * This is our primary secure bridge to the AI Brain.
   */
  static async architectRequest(prompt: string, contents: any[] = []) {
    try {
      // Ensure we have a valid key selected in the environment before calling the function
      await this.establishLink();

      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { prompt, contents }
      });

      if (error) {
        // If error suggests missing function or bad key, re-trigger key selection
        if (error.message?.includes("not found") || error.message?.includes("404")) {
          throw new Error("The AI Bridge 'lesson-architect' is not deployed in Supabase.");
        }
        throw error;
      }

      return data;
    } catch (err: any) {
      console.error("Matrix Connection Failure:", err);
      throw err;
    }
  }

  /**
   * Standardizes the Daily Briefing logic for the Dashboard.
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
   */
  static async isReady(): Promise<boolean> {
    try {
      // Priority: Check the Edge Function bridge directly
      const { data, error } = await supabase.functions.invoke('lesson-architect', {
        body: { ping: true }
      });
      
      if (!error && data) return true;
      return false;
    } catch {
      return false;
    }
  }
}
