import { GoogleGenAI, Type } from "@google/genai";
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
  async generateLessonPlanEdge(subject: string, grade: string, topic: string, contents?: any[]) {
    const schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
        procedure: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              step: { type: Type.STRING },
              description: { type: Type.STRING },
              duration: { type: Type.STRING }
            },
            required: ["step", "description", "duration"]
          }
        },
        differentiation: {
          type: Type.OBJECT,
          properties: {
            sen: { type: Type.STRING },
            gt: { type: Type.STRING }
          },
          required: ["sen", "gt"]
        }
      },
      required: ["title", "objectives", "procedure", "differentiation"]
    };

    if (!IS_CLOUD_ENABLED) {
      // Fallback to local rotation if cloud is not configured
      return this.execute(async (ai) => {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: contents && contents.length > 0 
            ? { parts: [...contents, { text: `Create a lesson plan for Grade ${grade} ${subject} on topic: ${topic}` }] }
            : [{ parts: [{ text: `Create a lesson plan for Grade ${grade} ${subject} on topic: ${topic}` }] }],
          config: {
            systemInstruction: "Lead Pedagogical Architect at Ibn Al Hytham Islamic School. Formal, structured, 2026-27 standards.",
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });
        return JSON.parse(response.text);
      });
    }

    const { data, error } = await supabase.functions.invoke('lesson-architect', {
      body: { 
        prompt: `Create a detailed lesson plan for Grade ${grade} ${subject} on the topic: "${topic}". 
        Include learning objectives, a 40-minute period breakdown, and assessment questions.`,
        contents: contents, // Pass the uploaded files (images/PDFs) to the edge function
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    if (error) throw error;
    
    try {
      // The edge function returns { text: "..." }
      const parsed = typeof data.text === 'string' ? JSON.parse(data.text) : data.text;
      return parsed;
    } catch (e) {
      return data.text;
    }
  },

  /**
   * Smart Substitution Matchmaker
   * Analyzes gaps and available teachers to find the best fit based on expertise and load.
   */
  async matchSubstitutions(gaps: any[], availableTeachers: any[]) {
    return this.execute(async (ai) => {
      const prompt = `As the Lead Operations Architect at Ibn Al Hytham Islamic School (2026-2027), 
      analyze the following teaching gaps and available staff to find the best possible substitution matches.
      
      Gaps: ${JSON.stringify(gaps)}
      Available Staff (with their expertise/subjects): ${JSON.stringify(availableTeachers)}
      
      Criteria:
      1. Subject Expertise: Match teachers to subjects they are qualified for first.
      2. Workload Balance: Prefer teachers with lower current weekly proxy loads.
      3. Proximity: If applicable, prefer teachers in the same wing.
      
      Return a JSON array of objects, each containing:
      - gapId: The ID of the gap.
      - substituteTeacherId: The ID of the recommended teacher.
      - reasoning: A brief explanation of why this match was made (e.g., "Subject specialist").
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          systemInstruction: "Lead Operations Architect at Ibn Al Hytham Islamic School. Professional, logical, data-driven."
        }
      });
      return JSON.parse(response.text);
    });
  },

  /**
   * Automated Lesson Architect (One-Click)
   * Generates a full Lesson Plan, Worksheet, and Quiz in one go.
   */
  async automatedLessonArchitect(subject: string, grade: string, topic: string, additionalContext: string) {
    const prompt = `As the Lead Pedagogical Architect at Ibn Al Hytham Islamic School (2026-2027), 
    create a comprehensive instructional package for:
    Grade: ${grade}
    Subject: ${subject}
    Topic: ${topic}
    Context: ${additionalContext}
    
    The package must include:
    1. A detailed Lesson Plan (Objectives, Procedure, Differentiation).
    2. A Student Worksheet (Differentiated questions).
    3. A 5-question Quiz (Multiple choice).
    
    Return the response in a structured JSON format.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        lessonPlan: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
            procedure: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  step: { type: Type.STRING },
                  description: { type: Type.STRING },
                  duration: { type: Type.STRING }
                },
                required: ["step", "description", "duration"]
              }
            },
            differentiation: {
              type: Type.OBJECT,
              properties: {
                sen: { type: Type.STRING },
                gt: { type: Type.STRING }
              },
              required: ["sen", "gt"]
            }
          },
          required: ["title", "objectives", "procedure", "differentiation"]
        },
        worksheet: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  text: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  answer: { type: Type.STRING },
                  tier: { type: Type.STRING }
                },
                required: ["id", "type", "text", "answer", "tier"]
              }
            }
          },
          required: ["title", "questions"]
        },
        quiz: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  answer: { type: Type.STRING }
                },
                required: ["text", "options", "answer"]
              }
            }
          },
          required: ["title", "questions"]
        }
      },
      required: ["lessonPlan", "worksheet", "quiz"]
    };

    const systemInstruction = "Lead Pedagogical Architect at Ibn Al Hytham Islamic School. Formal, structured, 2026-27 standards.";

    if (!IS_CLOUD_ENABLED) {
      return this.execute(async (ai) => {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            systemInstruction
          }
        });
        return JSON.parse(response.text);
      });
    }

    const { data, error } = await supabase.functions.invoke('lesson-architect', {
      body: { prompt, systemInstruction, responseMimeType: "application/json", responseSchema: schema }
    });

    if (error) throw error;
    
    try {
      const text = typeof data.text === 'string' ? data.text : JSON.stringify(data.text);
      return JSON.parse(text);
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
