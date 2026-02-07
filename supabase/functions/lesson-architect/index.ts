
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@^1.34.0";

const process = { 
  env: (globalThis as any).Deno.env.toObject() 
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!process.env.API_KEY) {
       return new Response(
         JSON.stringify({ error: 'MISSING_API_KEY', message: 'Gemini API Key missing on server.' }),
         { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
       )
    }

    const payload = await req.json();
    const { prompt, contents, ping } = payload;

    if (ping) {
      return new Response(JSON.stringify({ status: 'Matrix Online' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      })
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    let generationPayload;
    if (contents && contents.length > 0) {
      generationPayload = { parts: [...contents, { text: prompt }] };
    } else {
      generationPayload = prompt;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: generationPayload,
      config: {
        systemInstruction: "Lead Pedagogical Architect at Ibn Al Hytham Islamic School. Formal, structured, 2026-27 standards. Include SEN/GT differentiation.",
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
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
