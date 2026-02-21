import { GoogleGenAI } from "@google/genai";
import { supabase, IS_CLOUD_ENABLED } from "../supabaseClient.ts";

/**
 * Ibn Al Hytham Islamic School - AI Service
 * Implements API Key Rotation and Supabase Edge Function support.
 */

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

/**
 * Gets the next available API key in a round-robin fashion.
 */
const getRotatedKey = () => {
  if (API_KEYS.length === 0) {
    console.error("No Gemini API keys found in environment variables.");
    return null;
  }
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
};

export const AIService = {
  /**
   * Core execution method that handles key rotation and initialization.
   */
  async execute(operation: (ai: GoogleGenAI) => Promise<any>) {
    const apiKey = getRotatedKey();
    if (!apiKey) throw new Error("AI Service Configuration Error: Missing API Keys");

    const ai = new GoogleGenAI({ apiKey });
    
    try {
      return await operation(ai);
    } catch (error: any) {
      // If a key hits a rate limit (429), we could potentially retry with the next key immediately
      if (error?.status === 429 || error?.message?.includes('429')) {
        console.warn("Rate limit hit, rotating key and retrying...");
        const nextApiKey = getRotatedKey();
        if (nextApiKey) {
          const nextAi = new GoogleGenAI({ apiKey: nextApiKey });
          return await operation(nextAi);
        }
      }
      throw error;
    }
  },

  /**
   * Generates a Lesson Plan for the LessonArchitectView
   * Hardcoded Rule: Must include School Name and Academic Year 2026-2027.
   */
  async generateLessonPlan(subject: string, grade: string, topic: string) {
    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ 
          parts: [{ 
            text: `As an expert educator at Ibn Al Hytham Islamic School for the Academic Year 2026-2027, 
            create a detailed lesson plan for Grade ${grade} ${subject} on the topic: "${topic}". 
            Include learning objectives, a 40-minute period breakdown, and assessment questions. 
            Format the output clearly for a professional teacher's handbook.` 
          }] 
        }],
      });
      return response.text;
    });
  },

  /**
   * Analyzes Attendance Trends for AIAnalyticsView
   * Hardcoded Rule: Late threshold is 07:20 AM.
   */
  async analyzeAttendance(attendanceData: any[]) {
    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ 
          parts: [{ 
            text: `Analyze the following attendance data for Ibn Al Hytham Islamic School (2026-2027). 
            The school's late threshold is strictly 07:20 AM. 
            Identify patterns of tardiness and suggest specific interventions for staff.
            Data: ${JSON.stringify(attendanceData)}` 
          }] 
        }],
      });
      return response.text;
    });
  },

  /**
   * Secure Generation via Supabase Edge Function
   * This is the preferred method as it keeps keys server-side.
   */
  async generateLessonPlanEdge(subject: string, grade: string, topic: string) {
    if (!IS_CLOUD_ENABLED) {
      // Fallback to local rotation if cloud is not configured
      return this.generateLessonPlan(subject, grade, topic);
    }

    const { data, error } = await supabase.functions.invoke('lesson-architect', {
      body: { 
        prompt: `Create a detailed lesson plan for Grade ${grade} ${subject} on the topic: "${topic}". 
        Include learning objectives, a 40-minute period breakdown, and assessment questions.`
      }
    });

    if (error) throw error;
    
    // The edge function returns { text: "..." }
    try {
      const parsed = typeof data.text === 'string' ? JSON.parse(data.text) : data.text;
      return parsed;
    } catch (e) {
      return data.text;
    }
  },

  /**
   * Generic Edge Execution for arbitrary prompts
   */
  async executeEdge(prompt: string, systemInstruction?: string) {
    if (!IS_CLOUD_ENABLED) {
      return this.execute(async (ai) => {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: { systemInstruction }
        });
        return response.text;
      });
    }

    const { data, error } = await supabase.functions.invoke('lesson-architect', {
      body: { prompt, systemInstruction }
    });

    if (error) throw error;
    return data.text;
  }
};
