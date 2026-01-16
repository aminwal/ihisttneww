import { SCHOOL_NAME } from '../constants.ts';
import { User, SubstitutionRecord } from '../types.ts';

export class NotificationService {
  static async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn("This browser does not support desktop notifications");
      return 'denied';
    }
    return await Notification.requestPermission();
  }

  static async sendNotification(title: string, options: NotificationOptions = {}) {
    if (Notification.permission !== 'granted') return;

    const defaultOptions: any = {
      vibrate: [200, 100, 200],
      tag: 'ihis-portal-alert',
      ...options
    };

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification(`${SCHOOL_NAME}: ${title}`, defaultOptions);
    } else {
      new Notification(`${SCHOOL_NAME}: ${title}`, defaultOptions);
    }
  }

  static async notifySubstitution(className: string, slotId: number) {
    this.sendNotification("New Substitution Duty", {
      body: `You have been assigned as proxy for Class ${className} during Period ${slotId}.`,
      requireInteraction: true
    } as any);
  }

  /**
   * Manual WhatsApp Redirect Flow (Free Method)
   */
  static sendWhatsAppAlert(teacher: User, sub: SubstitutionRecord) {
    if (!teacher.phone_number) return false;
    
    // Remove all non-numeric characters for the API link
    const cleanPhone = teacher.phone_number.replace(/\D/g, '');
    const message = `*Assalamu Alaikum ${teacher.name}*,\n\nYou have been assigned a *PROXY DUTY* at ${SCHOOL_NAME}.\n\n📌 *Class:* ${sub.className}\n🕒 *Period:* ${sub.slotId}\n📚 *Subject:* ${sub.subject}\n📅 *Date:* ${sub.date}\n\nPlease check your staff portal for details.`;
    
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  }

  static async notifyAttendanceReminder() {
    this.sendNotification("Attendance Reminder", {
      body: "Good Morning! Please remember to mark your attendance via Geolocation check-in.",
    });
  }

  static async notifyAnnouncement(msg: string) {
    this.sendNotification("New Announcement", {
      body: msg,
    });
  }
}