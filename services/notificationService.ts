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
      console.warn("IHIS: Notifications not supported on this browser.");
      return;
    }
    
    // Check permission - if default, request it
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await this.requestPermission();
    }

    if (permission !== 'granted') {
      throw new Error("Matrix Permission Denied: " + permission);
    }

    const defaultOptions: any = {
      body: options.body || "",
      icon: 'https://i.imgur.com/SmEY27a.png',
      badge: 'https://i.imgur.com/SmEY27a.png',
      vibrate: [100, 50, 100],
      tag: options.tag || 'ihis-alert-' + Date.now(),
      renotify: true,
      requireInteraction: options.requireInteraction ?? false,
      data: { 
        url: window.location.origin,
        timestamp: Date.now()
      },
      ...options
    };

    try {
      // ANDROID CRITICAL FIX: Use the .ready promise to get the registration
      // Android Chrome requires showNotification() on the registration, NOT new Notification()
      const registration = await navigator.serviceWorker.ready;
      
      if (registration && 'showNotification' in registration) {
        await registration.showNotification(title, defaultOptions);
        console.log("IHIS: Notification delivered via SW Registration");
      } else {
        // Fallback for non-Android / Desktop
        new Notification(title, defaultOptions);
      }
    } catch (err) {
      console.error("IHIS: Primary delivery failed, attempting Worker Bridge:", err);
      
      // ANDROID FALLBACK: Send message to the Service Worker to trigger from its context
      // This bypasses many UI-thread restrictions in mobile Chrome
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'TRIGGER_NOTIFICATION',
          title,
          options: defaultOptions
        });
      } else {
        // Last ditch effort if worker isn't controlling yet
        try { new Notification(title, defaultOptions); } catch(e) {}
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
      console.error("IHIS: Proxy alert delivery failed", e);
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