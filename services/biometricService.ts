
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

export class BiometricService {
  /**
   * Check if the device/browser supports WebAuthn Biometrics
   */
  static async isSupported(): Promise<boolean> {
    return (
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  }

  /**
   * Register the device for biometrics
   * Updated for Android compatibility: Uses Discoverable Credentials (Resident Keys)
   */
  static async register(userId: string, userName: string): Promise<boolean> {
    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      const userID = new TextEncoder().encode(userId);

      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: "IHIS Portal",
          id: window.location.hostname === 'localhost' ? undefined : window.location.hostname,
        },
        user: {
          id: userID,
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256 (Common for Android/iOS)
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "required", // Critical for Android discoverability
          requireResidentKey: true,  // Ensures key is stored on device
        },
        timeout: 60000,
        attestation: "none",
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as any;

      if (credential) {
        // Store locally for quick check
        localStorage.setItem(`ihis_biometric_active_${userId}`, 'true');
        
        // Cloud Sync: Store a reference or the credential ID in the profile
        if (IS_CLOUD_ENABLED) {
          try {
            // We store the rawId as a base64 string to identify this device's credential
            const rawId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
            await supabase.from('profiles').update({ biometric_public_key: rawId }).eq('id', userId);
          } catch (e) {
            console.warn("Biometric Cloud Sync Failed", e);
          }
        }
        
        return true;
      }
      return false;
    } catch (e) {
      console.error("Biometric registration failed", e);
      return false;
    }
  }

  /**
   * Authenticate using biometrics
   * On Android, this will trigger the 'Passkey' or Biometric prompt automatically
   */
  static async authenticate(userId: string, cloudKey?: string): Promise<boolean> {
    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      
      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge,
        // If we have a cloud key, we can target it, but empty array is better for discoverability
        allowCredentials: cloudKey ? [{
          id: Uint8Array.from(atob(cloudKey), c => c.charCodeAt(0)),
          type: 'public-key',
          transports: ['internal']
        }] : [], 
        userVerification: "required",
        rpId: window.location.hostname === 'localhost' ? undefined : window.location.hostname,
        timeout: 60000,
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      });

      return !!assertion;
    } catch (e) {
      console.error("Biometric authentication failed", e);
      return false;
    }
  }

  static isEnrolled(userId: string, cloudKey?: string): boolean {
    return localStorage.getItem(`ihis_biometric_active_${userId}`) === 'true' || !!cloudKey;
  }

  static unenroll(userId: string) {
    localStorage.removeItem(`ihis_biometric_active_${userId}`);
    // Note: Cloud unenrollment should be handled via profile update if needed
  }
}
