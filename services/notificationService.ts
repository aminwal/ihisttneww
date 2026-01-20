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

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    try {
      return await Notification.requestPermission();
    } catch (e) {
      return new Promise((resolve) => {
        (Notification as any).requestPermission((p: NotificationPermission) => resolve(p));
      });
    }
  }

  static async sendNotification(title: string, options: any = {}) {
    if (!this.isSupported()) {
      console.warn("Notifications not supported");
      return;
    }
    
    const permission = Notification.permission;
    if (permission !== 'granted') {
      throw new Error("Permission status: " + permission);
    }

    const defaultOptions: any = {
      body: options.body || "",
      icon: 'https://i.imgur.com/SmEY27a.png',
      badge: 'https://i.imgur.com/SmEY27a.png',
      vibrate: [100, 50, 100],
      tag: options.tag || 'ihis-notif-' + Date.now(),
      renotify: true,
      // requireInteraction is sometimes blocked by Android "Quiet" modes, disabling for test
      requireInteraction: options.requireInteraction ?? false,
      data: { 
        url: window.location.origin,
        timestamp: Date.now()
      },
      ...options
    };

    try {
      // ANDROID CRITICAL FIX: Always use .ready promise
      const registration = await navigator.serviceWorker.ready;
      
      if (registration) {
        // Attempt 1: Direct call from registration
        await registration.showNotification(title, defaultOptions);
        console.log("Notification triggered via SW Registration");
        return;
      }

      // Attempt 2: Fallback for Desktop/iOS
      if (!/Android/i.test(navigator.userAgent)) {
        new Notification(title, defaultOptions);
      }
    } catch (err) {
      console.error("Primary notification failed, trying message bridge:", err);
      
      // Attempt 3: Message Bridge (Final effort for Android)
      // Send a message to the SW to show the notification from the worker thread
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'TRIGGER_NOTIFICATION',
          title,
          options: defaultOptions
        });
      }
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    try {
      await this.sendNotification("New Proxy Duty Assigned", {
        body: `Class ${className}, Period ${slotId}. Check your dashboard.`,
        tag: `sub-${className}-${slotId}`,
        requireInteraction: true
      });
    } catch (e) {
      console.error("Substitution alert failed", e);
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