import { SCHOOL_NAME } from '../constants.ts';

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

    // If a service worker is active, use it for the notification
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