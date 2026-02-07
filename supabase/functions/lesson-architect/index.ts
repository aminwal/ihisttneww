
// Follow Deno standards for Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@^1.34.0";

// Institutional Environment Bridge: Maps Deno secrets to process.env for GenAI SDK compliance
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
    // SECURITY CHECK: Ensure API_KEY is present
    if (!process.env.API_KEY) {
       return new Response(
         JSON.stringify({ error: 'MISSING_API_KEY', message: 'Gemini API Key not set in Supabase Secrets.' }),
         { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
       )
    }

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
        responseSchema: {
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
            assessment: { type: Type.STRING },
            homework: { type: Type.STRING },
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
        }
      }
    });

    return new Response(
      JSON.stringify({ text: response.text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
