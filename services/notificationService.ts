import { SCHOOL_NAME } from '../constants.ts';
import { User, SubstitutionRecord } from '../types.ts';

export class NotificationService {
  static isSupported(): boolean {
    return 'Notification' in window && typeof Notification !== 'undefined';
  }

  static async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      console.warn("Notifications are not supported in this environment.");
      return 'denied';
    }

    // Checking for Secure Context (Required for Notifications)
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      console.warn("Notifications require a secure context (HTTPS).");
    }

    // Inside an iframe, permissions might be blocked by the parent
    if (window.self !== window.top) {
      console.warn("App is running in an iframe. Notification prompts may be blocked by browser security policy.");
    }

    try {
      // Handle both Promise-based and Callback-based APIs
      const request = Notification.requestPermission();
      
      if (request && typeof (request as any).then === 'function') {
        return await (request as any);
      } else {
        // Fallback for callback-only versions (older Safari/Chrome)
        return new Promise((resolve) => {
          Notification.requestPermission((permission) => {
            resolve(permission);
          });
        });
      }
    } catch (e) {
      console.error("Critical error during notification permission request:", e);
      return 'denied';
    }
  }

  static async sendNotification(title: string, options: NotificationOptions = {}) {
    if (!this.isSupported() || Notification.permission !== 'granted') return;

    const defaultOptions: any = {
      vibrate: [200, 100, 200],
      tag: 'ihis-portal-alert',
      icon: 'https://raw.githubusercontent.com/ahmedminwal/ihis-assets/main/logo.png',
      ...options
    };

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification(`${SCHOOL_NAME}: ${title}`, defaultOptions);
      } else {
        new Notification(`${SCHOOL_NAME}: ${title}`, defaultOptions);
      }
    } catch (err) {
      console.error("Failed to trigger notification:", err);
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    this.sendNotification("New Substitution Duty", {
      body: `You have been assigned as proxy for Class ${className} during Period ${slotId}.`,
      requireInteraction: true
    } as any);
  }

  static sendWhatsAppAlert(teacher: User, sub: SubstitutionRecord) {
    if (!teacher.phone_number) return false;
    const cleanPhone = teacher.phone_number.replace(/\D/g, '');
    const message = `*Assalamu Alaikum ${teacher.name}*,\n\nYou have been assigned a *PROXY DUTY* at ${SCHOOL_NAME}.\n\n📌 *Class:* ${sub.className}\n🕒 *Period:* ${sub.slotId}\n📚 *Subject:* ${sub.subject}\n📅 *Date:* ${sub.date}\n\nPlease check your staff portal for details.`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  }
}