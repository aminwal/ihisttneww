
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { calculateDistance } from '../utils/geoUtils.ts';

export class GeoValidationService {
  /**
   * Securely validates user location via Edge Handshake.
   * If Cloud is disabled, it falls back to local math.
   */
  static async validate(lat: number, lng: number, targetLat: number, targetLng: number, radius: number): Promise<{ valid: boolean; distance: number; error?: string }> {
    if (!IS_CLOUD_ENABLED) {
      const dist = calculateDistance(lat, lng, targetLat, targetLng);
      return { valid: dist <= radius + 15, distance: dist }; // 15m buffer included
    }

    try {
      // Conceptual call to Supabase Edge Function 'validate-location'
      // This prevents users from simply overriding the 'calculateDistance' function in browser console
      const { data, error } = await supabase.functions.invoke('validate-location', {
        body: { 
          user_lat: lat, 
          user_lng: lng,
          target_lat: targetLat,
          target_lng: targetLng,
          radius_meters: radius
        }
      });

      if (error) throw error;
      return data; // Expected { valid: boolean, distance: number }
    } catch (err) {
      console.warn("IHIS: Edge Validation failed. Falling back to Local Protocol.");
      const dist = calculateDistance(lat, lng, targetLat, targetLng);
      return { valid: dist <= radius + 15, distance: dist };
    }
  }
}
