import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { User, SubstitutionRecord } from '../types.ts';

export class NotificationService {
  static isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  static isStandalone(): boolean {
    return (window.matchMedia('(display-mode: standalone)').matches) || ((window.navigator as any).standalone === true);
  }

  static async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';

    // If already denied, requesting again won't show the prompt
    if (Notification.permission === 'denied') {
      console.warn("IHIS: Notifications blocked by browser settings.");
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (e) {
      return new Promise((resolve) => {
        (Notification as any).requestPermission((p: NotificationPermission) => resolve(p));
      });
    }
  }

  static async sendNotification(title: string, options: any = {}) {
    if (!this.isSupported()) return;
    
    // Always request/verify permission before sending
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error("Permission not granted. Current status: " + permission);
    }

    const defaultOptions: any = {
      body: options.body || "",
      // Android strictly requires absolute HTTPS URLs for icons/badges
      icon: 'https://i.imgur.com/SmEY27a.png',
      badge: 'https://i.imgur.com/SmEY27a.png',
      vibrate: [100, 50, 100],
      tag: options.tag || 'ihis-notif-' + Date.now(),
      renotify: true,
      requireInteraction: true,
      data: { url: window.location.origin },
      ...options
    };

    try {
      // Android Chrome FIX: Must use service worker registration
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, defaultOptions);
        console.log("IHIS: Notification sent via Service Worker");
        return;
      }

      // Fallback for iOS/Desktop if SW registration is somehow missing
      new Notification(title, defaultOptions);
    } catch (err) {
      console.error("IHIS: Final delivery attempt failed", err);
      // Last ditch effort
      try { new Notification(title, defaultOptions); } catch(e) {}
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    try {
      await this.sendNotification("New Proxy Duty Assigned", {
        body: `Class ${className}, Period ${slotId}. Check your dashboard.`,
        tag: `sub-${className}-${slotId}`
      });
    } catch (e) {
      console.error("IHIS: Substitution alert failed", e);
    }
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