import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { User, SubstitutionRecord } from '../types.ts';

export class NotificationService {
  /**
   * Comprehensive check for notification support.
   */
  static isSupported(): boolean {
    return 'Notification' in window;
  }

  /**
   * Helper to check if the app is running in Standalone (PWA) mode.
   */
  static isStandalone(): boolean {
    return (window.matchMedia('(display-mode: standalone)').matches) || ((window.navigator as any).standalone === true);
  }

  static async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      console.warn("IHIS: Notifications not supported on this device.");
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (e) {
      // Older versions of Safari might still use a callback-based approach
      return new Promise((resolve) => {
        (Notification as any).requestPermission((p: NotificationPermission) => resolve(p));
      });
    }
  }

  static async sendNotification(title: string, options: any = {}) {
    if (!this.isSupported() || Notification.permission !== 'granted') {
      console.warn("IHIS: Cannot send notification - Permission is " + Notification.permission);
      return;
    }

    const defaultOptions: any = {
      body: options.body || "",
      vibrate: [200, 100, 200],
      badge: 'https://i.imgur.com/SmEY27a.png',
      icon: 'https://i.imgur.com/SmEY27a.png',
      tag: options.tag || 'ihis-notification',
      renotify: true,
      requireInteraction: true,
      ...options
    };

    try {
      // Strategy 1: Attempt via Service Worker (Best for PWA/Android/iOS Home Screen)
      if ('serviceWorker' in navigator) {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((_, reject) => setTimeout(() => reject('timeout'), 2000))
        ]).catch(() => null);

        if (registration) {
          await registration.showNotification(title, defaultOptions);
          return;
        }
      }
      
      // Strategy 2: Fallback to standard window.Notification
      new Notification(title, defaultOptions);
    } catch (err) {
      console.error("IHIS: Notification delivery failed", err);
      // Final attempt fallback
      try {
        new Notification(title, defaultOptions);
      } catch (innerErr) {
        console.error("IHIS: Hard fallback failed", innerErr);
      }
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    await this.sendNotification("New Proxy Duty Assigned", {
      body: `Class ${className}, Period ${slotId}. Check your dashboard.`,
      tag: `sub-${className}-${slotId}`
    });
  }

  static sendWhatsAppAlert(teacher: User, sub: SubstitutionRecord) {
    if (!teacher.phone_number) return false;
    const cleanPhone = teacher.phone_number.replace(/\D/g, '');
    const message = `*Assalamu Alaikum ${teacher.name}*,\n\nYou have been assigned a *PROXY DUTY*.\n\n📌 *Class:* ${sub.className}\n🕒 *Period:* ${sub.slotId}\n📚 *Subject:* ${sub.subject}\n\nPlease check your staff portal at Ibn Al Hytham Islamic School.`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  }
}