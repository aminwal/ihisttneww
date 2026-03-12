import { GoogleGenAI, Type } from "@google/genai";
import { supabase, IS_CLOUD_ENABLED } from "../supabaseClient.ts";

/**
 * Ibn Al Hytham Islamic School - AI Service
 * Implements API Key Rotation and Supabase Edge Function support.
 */

const getAPIKeys = () => {
  const keys = [
    localStorage.getItem('GEMINI_API_KEY'),
    localStorage.getItem('API_KEY'),
    process.env.GEMINI_API_KEY,
    process.env.API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    // @ts-ignore
    window.API_KEY,
    // @ts-ignore
    window.GEMINI_API_KEY,
  ].filter(k => k && typeof k === 'string' && k.trim().length > 0 && k !== 'undefined' && !k.includes('TODO')) as string[];
  return Array.from(new Set(keys.map(k => k.trim()))); // Remove duplicates and trim
};

let currentKeyIndex = 0;

/**
 * Gets the next available API key in a round-robin fashion.
 */
const getRotatedKey = () => {
  const keys = getAPIKeys();
  if (keys.length === 0) {
    console.error("No Gemini API keys found in environment variables or window.");
    return null;
  }
  const key = keys[currentKeyIndex % keys.length];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return key;
};

export const AIService = {
  /**
   * Core execution method that handles backend proxying, key rotation and initialization.
   */
  async execute(operation: (ai: GoogleGenAI) => Promise<any>, prompt?: string, config?: any) {
    // 0. Try to get API Keys from database first
    if (IS_CLOUD_ENABLED) {
      try {
        const { data } = await supabase.from('school_config').select('config_data').eq('id', 'primary_config').single();
        if (data?.config_data?.geminiApiKeys && Array.isArray(data.config_data.geminiApiKeys)) {
          const apiKeys = data.config_data.geminiApiKeys;
          for (const apiKey of apiKeys) {
            try {
              const ai = new GoogleGenAI({ apiKey });
              return await operation(ai);
            } catch (error: any) {
              console.warn("API Key failed, trying next key...");
              continue;
            }
          }
        }
      } catch (dbError) {
        console.warn("Could not fetch API keys from database, falling back to local keys.");
      }
    }

    // 1. Try backend proxy first if it's a standard prompt
    if (prompt) {
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-3-flash-preview",
            contents: [{ parts: [{ text: prompt }] }],
            config: config
          })
        });

        if (response.ok) {
          const data = await response.json();
          let text = "";
          if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            text = data.candidates[0].content.parts[0].text;
          } else if (data.text) {
            text = data.text;
          }
          
          if (config?.responseMimeType === "application/json") {
             try { return JSON.parse(text); } catch (e) { return text; }
          }
          return text;
        }
      } catch (e) {
        console.warn("Backend proxy failed, falling back to local SDK:", e);
      }
    }

    // 2. Fallback to local SDK
    const apiKey = getRotatedKey();
    if (!apiKey) throw new Error("GATING_ERROR: Gemini API Key missing. Please configure it in the Infrastructure Hub.");

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
   * Suggests placements for a parked period using AI, including multi-step swap options.
   */
  async suggestParkedPeriodPlacements(parkedItem: any, timetable: any[], config: any) {
    const pedagogicalRules = config.pedagogicalRules || [];
    const activeRules = pedagogicalRules.filter((r: any) => r.isActive);
    const rulesContext = activeRules.length > 0 
      ? `\nPedagogical Rules to Enforce:\n${JSON.stringify(activeRules)}`
      : "";

    const prompt = `As the Lead Timetable Architect at Ibn Al Hytham Islamic School (2026-2027), 
      analyze the following parked period and the current timetable to suggest the best possible placement strategies.
      
      Parked Period: ${JSON.stringify(parkedItem)}
      ${rulesContext}
      
      Criteria:
      1. Avoid collisions (teacher, room, section).
      2. Respect teacher load policies.
      3. Respect preferred slots if available.
      4. STRICTLY ENFORCE the Pedagogical Rules provided above. If a rule has severity 'BLOCK', you MUST NOT suggest any placement that violates it. If it has severity 'WARN', you may suggest it but must include a warning in the description.
      5. If a direct placement is not possible, suggest multi-step swap strategies (moving existing periods to free up slots).
      
      Return a JSON array of objects, each containing:
      - description: A clear description of the strategy (e.g., "Move Period A to Slot X, then place Parked Period").
      - moves: An array of objects, each with { entryId: string, newDay: string, newSlot: number } representing the moves required.
      - placements: An array of objects, each with { parkedEntryId: string, day: string, slot: number } representing the new placements.
      - reason: A brief explanation of why this strategy is recommended, explicitly mentioning compliance with pedagogical rules if relevant.
      `;
    
    const configPrompt = {
      responseMimeType: "application/json",
      systemInstruction: "Lead Timetable Architect at Ibn Al Hytham Islamic School. Professional, logical, data-driven. Always return valid JSON."
    };

    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: configPrompt
      });
      return JSON.parse(response.text);
    }, prompt, configPrompt);
  },

  /**
   * Generates a Lesson Plan for the LessonArchitectView
   * Hardcoded Rule: Must include School Name and Academic Year 2026-2027.
   */
  async generateLessonPlan(subject: string, grade: string, topic: string) {
    const prompt = `As an expert educator at Ibn Al Hytham Islamic School for the Academic Year 2026-2027, 
            create a detailed lesson plan for Grade ${grade} ${subject} on the topic: "${topic}". 
            Include learning objectives, a 40-minute period breakdown, and assessment questions. 
            Format the output clearly for a professional teacher's handbook.`;
    
    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text;
    }, prompt);
  },

  /**
   * Analyzes Attendance Trends for AIAnalyticsView
   * Hardcoded Rule: Late threshold is 07:20 AM.
   */
  async analyzeAttendance(attendanceData: any[]) {
    const prompt = `Analyze the following attendance data for Ibn Al Hytham Islamic School (2026-2027). 
            The school's late threshold is strictly 07:20 AM. 
            Identify patterns of tardiness and suggest specific interventions for staff.
            Data: ${JSON.stringify(attendanceData)}`;

    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text;
    }, prompt);
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

    const config = {
      responseMimeType: "application/json",
      systemInstruction: "Lead Operations Architect at Ibn Al Hytham Islamic School. Professional, logical, data-driven."
    };

    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: config
      });
      return JSON.parse(response.text);
    }, prompt, config);
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
    const config = {
      responseMimeType: "application/json",
      responseSchema: schema,
      systemInstruction
    };

    if (!IS_CLOUD_ENABLED) {
      return this.execute(async (ai) => {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: config
        });
        return JSON.parse(response.text);
      }, prompt, config);
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
   * Generates a Pedagogical Rule configuration from natural language input.
   */
  async generatePedagogicalRule(prompt: string, configData: any) {
    const systemInstruction = `You are the Lead Timetable Architect at Ibn Al Hytham Islamic School. 
    Your job is to translate natural language requests into structured pedagogical rules.
    
    Available Subjects: ${JSON.stringify(configData.subjects.map((s: any) => ({ id: s.id, name: s.name })))}
    Available Wings: ${JSON.stringify(configData.wings.map((w: any) => ({ id: w.id, name: w.name })))}
    Available Templates: ADJACENCY_RESTRICTION, DAILY_LIMIT, CONSECUTIVE_LIMIT, SLOT_RESTRICTION, BACK_TO_BACK_DAYS_RESTRICTION
    Available Period Types: ALL_PERIODS, GROUP_PERIOD, LAB_PERIOD, EXTRA_CURRICULAR
    
    Map the user's request to the closest matching template, subjects, and period types.
    If the user mentions a specific subject (e.g., "Math"), find its ID from the Available Subjects list and include it in subjectIds.
    If the user mentions a wing (e.g., "Primary"), find its ID and include it in targetWingIds. If no wing is mentioned, include all wing IDs.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "A clear, concise name for the rule." },
        template: { type: Type.STRING, description: "One of the Available Templates." },
        targetWingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        severity: { type: Type.STRING, description: "BLOCK or WARN. Default to BLOCK unless specified." },
        config: {
          type: Type.OBJECT,
          properties: {
            primaryTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
            secondaryTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
            subjectIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            secondarySubjectIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            maxCount: { type: Type.INTEGER },
            allowedSlots: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            allowIfSame: { type: Type.BOOLEAN },
            forbiddenIfDifferent: { type: Type.BOOLEAN }
          }
        }
      },
      required: ["name", "template", "targetWingIds", "severity", "config"]
    };

    const aiConfig = {
      responseMimeType: "application/json",
      responseSchema: schema,
      systemInstruction
    };

    return this.execute(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: aiConfig
      });
      return JSON.parse(response.text);
    }, prompt, aiConfig);
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
      }, prompt, { systemInstruction });
    }

    const { data, error } = await supabase.functions.invoke('lesson-architect', {
      body: { prompt, systemInstruction }
    });

    if (error) throw error;
    return data.text;
  }
};
