
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
      });

      if (credential) {
        localStorage.setItem(`ihis_biometric_active_${userId}`, 'true');
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
  static async authenticate(userId: string): Promise<boolean> {
    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      
      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge,
        // Empty array allows the browser to 'discover' the credential on the device
        allowCredentials: [], 
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

  static isEnrolled(userId: string): boolean {
    return localStorage.getItem(`ihis_biometric_active_${userId}`) === 'true';
  }

  static unenroll(userId: string) {
    localStorage.removeItem(`ihis_biometric_active_${userId}`);
  }
}
