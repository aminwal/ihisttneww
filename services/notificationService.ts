
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
    try {
      return await Notification.requestPermission();
    } catch (e) {
      return new Promise((resolve) => {
        (Notification as any).requestPermission((p: NotificationPermission) => resolve(p));
      });
    }
  }

  static async sendLocalTest() {
    await this.sendNotification("Matrix Connectivity Test", {
      body: "Institutional handshake successful. Browser alerts are active.",
      tag: 'test-' + Date.now()
    });
  }

  static async sendNotification(title: string, options: any = {}) {
    if (!this.isSupported()) return;
    
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await this.requestPermission();
    }

    if (permission !== 'granted') return;

    const defaultOptions: any = {
      body: options.body || "",
      icon: 'https://i.imgur.com/SmEY27a.png',
      badge: 'https://i.imgur.com/SmEY27a.png',
      vibrate: [100, 50, 100],
      tag: options.tag || 'ihis-alert-' + Date.now(),
      renotify: true,
      requireInteraction: options.requireInteraction ?? false,
      data: { url: window.location.origin },
      ...options
    };

    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && 'showNotification' in registration) {
        await registration.showNotification(title, defaultOptions);
      } else {
        new Notification(title, defaultOptions);
      }
    } catch (err) {
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
    await this.sendNotification("New Proxy Duty Assigned", {
      body: `Class ${className}, Period ${slotId}. Check your dashboard.`,
      tag: `sub-${className}-${slotId}`,
      requireInteraction: true
    });
  }
}
