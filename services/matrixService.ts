
import { GoogleGenAI } from "@google/genai";

/**
 * MatrixService: Institutional Intelligence Factory
 * 
 * This service manages the lifecycle of the Generative AI connection.
 * It strictly adheres to the 'Instantiate right before call' mandate.
 */
export class MatrixService {
  /**
   * Factory: Returns a fresh AI client instance.
   * MUST be called immediately before a generateContent request.
   */
  static getAI(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  /**
   * Performs a health check on the institutional bridge.
   */
  static async isReady(): Promise<boolean> {
    if (window.aistudio) {
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (hasKey) return true;
      } catch (e) {
        console.warn("Matrix: Bridge handshake interrupted.");
      }
    }
    const key = process.env.API_KEY;
    return !!key && key !== 'undefined' && key !== '';
  }

  /**
   * Pulse Test: Performs a tiny, fast AI call to verify the link.
   * Used to ensure the key is actually working before UI confirmation.
   */
  static async testPulse(): Promise<boolean> {
    try {
      const ai = this.getAI();
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: 'Pulse check: Reply with "OK".',
        config: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } }
      });
      return response.text?.trim().includes("OK") ?? false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Triggers the key selection dialog and verifies success via Pulse.
   */
  static async establishLink(): Promise<boolean> {
    if (!window.aistudio) return false;
    
    try {
      await window.aistudio.openSelectKey();
      // Wait a moment for environment variable injection
      await new Promise(r => setTimeout(r, 500));
      return await this.testPulse();
    } catch (e) {
      console.error("Matrix: Link establishment failed.");
      return false;
    }
  }
}
