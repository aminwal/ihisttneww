

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// Institutional Module Mapping for Deno
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@^1.34.0";

// Rule Compatibility Shim: Injects process object to satisfy institutional environment standards
const getKeys = () => {
  return [
    Deno.env.get("GEMINI_API_KEY"),
    Deno.env.get("GEMINI_API_KEY_1"),
    Deno.env.get("GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_API_KEY_3"),
    Deno.env.get("GEMINI_API_KEY_4"),
    Deno.env.get("GEMINI_API_KEY_5"),
  ].filter(Boolean);
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle Matrix Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json();
    const { prompt, contents, ping, systemInstruction: instructionOverride } = payload;

    // Temporal Health Check
    if (ping) {
      return new Response(JSON.stringify({ status: 'Matrix Online' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      })
    }

    const keys = getKeys();
    if (keys.length === 0) {
       console.error("IHIS CRITICAL: No Gemini API keys found in server secrets.");
       return new Response(
         JSON.stringify({ error: 'MISSING_SECRET', message: 'No API keys found on server.' }),
         { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
       );
    }

    // Rotate Key: Random selection for serverless distribution
    const selectedKey = keys[Math.floor(Math.random() * keys.length)];
    const ai = new GoogleGenAI({ apiKey: selectedKey });

    let generationPayload;
    if (contents && contents.length > 0) {
      generationPayload = { parts: [...contents, { text: prompt }] };
    } else {
      generationPayload = prompt;
    }

    const defaultInstruction = "You are the Lead Pedagogical Architect at Ibn Al Hytham Islamic School. All content must adhere to the 2026-2027 Academic Year standards. Maintain a formal, professional tone suitable for institutional documentation.";

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: generationPayload,
      config: {
        systemInstruction: instructionOverride || defaultInstruction,
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
    console.error("MATRIX LOGIC FAILURE:", error.message);
    return new Response(
      JSON.stringify({ error: 'AI_LOGIC_ERROR', message: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
