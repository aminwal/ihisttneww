
// Follow Deno standards for Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@^1.34.0";

// Institutional Environment Bridge: Maps Deno secrets to process.env for GenAI SDK compliance
// COMMENT: Fix 'Cannot find name Deno' by accessing it via globalThis to ensure runtime compatibility in Edge Functions
const process = { 
  env: (globalThis as any).Deno.env.toObject() 
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS Pre-flight protocols
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json();
    const { prompt, contents, ping } = payload;

    // 1. Connectivity Check (Matrix Pulse)
    if (ping) {
      return new Response(JSON.stringify({ status: 'Matrix Online', institutionalCode: 'IHIS-2026-PRO' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      })
    }

    // 2. Initialize Gemini API (Rule: Exclusively from environment process.env.API_KEY)
    // The API key MUST be obtained exclusively from the environment variable process.env.API_KEY.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // 3. Construct Multi-modal Payload
    let generationPayload;
    if (contents && contents.length > 0) {
      generationPayload = {
        parts: [
          ...contents,
          { text: prompt }
        ]
      };
    } else {
      generationPayload = prompt;
    }

    // 4. Generate Content (Model: gemini-3-pro-preview for Institutional Rigor)
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: generationPayload,
      config: {
        systemInstruction: "You are the Lead Pedagogical Architect at Ibn Al Hytham Islamic School. Your output must be formal, structured, and aligned with the 2026-2027 academic standards. Ensure all lesson plans include differentiation for SEN (Special Educational Needs) and GT (Gifted and Talented) students. All plans must be formatted for Bahraini educational standards.",
        temperature: 0.7,
        responseMimeType: "application/json",
        // Enforce the School's Lesson Plan Structure
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "The professional title of the lesson plan."
            },
            objectives: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Core learning objectives for the session."
            },
            procedure: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  step: { type: Type.STRING, description: "Phase name (e.g. Introduction, Core Task)." },
                  description: { type: Type.STRING, description: "Detailed instructional activity." },
                  duration: { type: Type.STRING, description: "Duration in minutes (e.g. 10 mins)." }
                },
                required: ["step", "description", "duration"]
              },
              description: "Minute-by-minute instructional procedure."
            },
            assessment: { type: Type.STRING, description: "Formative assessment strategies." },
            homework: { type: Type.STRING, description: "Consolidation tasks." },
            differentiation: {
              type: Type.OBJECT,
              properties: {
                sen: { type: Type.STRING, description: "Support for Special Needs." },
                gt: { type: Type.STRING, description: "Extension for Gifted/Talented." }
              },
              required: ["sen", "gt"]
            }
          },
          required: ["title", "objectives", "procedure", "differentiation"]
        }
      }
    });

    // 5. Secure Data Transmission back to Portal
    return new Response(
      JSON.stringify({ text: response.text }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error("Architect Edge Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
