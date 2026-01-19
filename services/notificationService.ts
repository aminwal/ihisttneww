import { SCHOOL_NAME } from '../constants.ts';
import { User, SubstitutionRecord } from '../types.ts';

export class NotificationService {
  static isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  static async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log("IHIS: Notification permission granted.");
      }
      return permission;
    } catch (e) {
      console.error("IHIS: Permission request failed", e);
      return 'denied';
    }
  }

  static async sendNotification(title: string, options: NotificationOptions = {}) {
    if (!this.isSupported()) return;

    // Fixed: Cast to any to avoid error if vibrate is missing from local NotificationOptions definition
    const defaultOptions: any = {
      vibrate: [200, 100, 200],
      badge: 'https://raw.githubusercontent.com/ahmedminwal/ihis-assets/main/logo.png',
      icon: 'https://raw.githubusercontent.com/ahmedminwal/ihis-assets/main/logo.png',
      ...options
    };

    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration) {
        await registration.showNotification(`${title}`, defaultOptions);
      } else {
        new Notification(`${title}`, defaultOptions);
      }
    } catch (err) {
      console.error("IHIS: Notification delivery failed", err);
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    // Fixed: Cast to any to avoid error if renotify is missing from local NotificationOptions definition
    await this.sendNotification("New Proxy Duty", {
      body: `Class ${className}, Period ${slotId}. Check your portal for details.`,
      tag: `sub-${className}-${slotId}`,
      renotify: true
    } as any);
  }

  static sendWhatsAppAlert(teacher: User, sub: SubstitutionRecord) {
    if (!teacher.phone_number) return false;
    const cleanPhone = teacher.phone_number.replace(/\D/g, '');
    const message = `*Assalamu Alaikum ${teacher.name}*,\n\nYou have been assigned a *PROXY DUTY*.\n\n📌 *Class:* ${sub.className}\n🕒 *Period:* ${sub.slotId}\n📚 *Subject:* ${sub.subject}\n\nPlease check your staff portal.`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  }
}