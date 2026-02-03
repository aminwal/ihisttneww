
// Follow Deno standards for Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user_lat, user_lng, target_lat, target_lng, radius_meters } = await req.json()

    // Haversine formula on server side
    const R = 6371e3; // meters
    const φ1 = (user_lat * Math.PI) / 180;
    const φ2 = (target_lat * Math.PI) / 180;
    const Δφ = ((target_lat - user_lat) * Math.PI) / 180;
    const Δλ = ((target_lng - user_lng) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c;
    const isValid = distance <= (radius_meters + 15); // Static 15m safety buffer

    return new Response(
      JSON.stringify({ valid: isValid, distance: distance }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
