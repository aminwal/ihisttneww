export class BiometricService {
  /**
   * Check if the device/browser supports WebAuthn Biometrics
   */
  static async isSupported(): Promise<boolean> {
    return (
      window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  }

  /**
   * Register the device for biometrics
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
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
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
   */
  static async authenticate(userId: string): Promise<boolean> {
    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      
      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge,
        allowCredentials: [], // Allow any credential registered on this device
        userVerification: "required",
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