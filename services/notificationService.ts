import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
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
    if (!this.isSupported() || Notification.permission !== 'granted') return;

    const defaultOptions: any = {
      vibrate: [200, 100, 200],
      badge: 'https://i.imgur.com/SmEY27a.png',
      icon: 'https://i.imgur.com/SmEY27a.png',
      tag: 'ihis-notification',
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
    await this.sendNotification("New Proxy Duty Assigned", {
      body: `Class ${className}, Period ${slotId}. Check your dashboard for details.`,
      tag: `sub-${className}-${slotId}`,
      renotify: true,
      data: { url: '/substitutions' }
    } as any);
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