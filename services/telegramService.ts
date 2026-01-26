import { SCHOOL_NAME } from '../constants.ts';
import { SubstitutionRecord, User } from '../types.ts';

export class TelegramService {
  /**
   * Dispatches a raw message to a specific Chat ID
   */
  static async sendMessage(token: string, chatId: string, text: string): Promise<boolean> {
    if (!token || !chatId) return false;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'MarkdownV2'
        })
      });
      
      const result = await response.json();
      return result.ok === true;
    } catch (err) {
      console.error("Telegram API Error:", err);
      return false;
    }
  }

  /**
   * Broadcasts a message to multiple users
   */
  static async broadcast(token: string, users: User[], message: string): Promise<{ success: number, fail: number }> {
    const targets = users.filter(u => !!u.telegram_chat_id);
    let success = 0;
    let fail = 0;

    const escapedMsg = this.escape(message);
    const header = `*${this.escape(`📢 SYSTEM BROADCAST`)}*\n\n`;
    const footer = `\n\n_Sent via IHIS Portal_`;

    for (const user of targets) {
      const ok = await this.sendMessage(token, user.telegram_chat_id!, header + escapedMsg + footer);
      if (ok) success++;
      else fail++;
    }

    return { success, fail };
  }

  /**
   * Sends a private custom message to one user
   */
  static async sendCustomSignal(token: string, chatId: string, message: string): Promise<boolean> {
    const escapedMsg = this.escape(message);
    const header = `*${this.escape(`✉️ PRIVATE SIGNAL`)}*\n\n`;
    const footer = `\n\n_Institutional Secure Line_`;
    return await this.sendMessage(token, chatId, header + escapedMsg + footer);
  }

  /**
   * Polls getUpdates to find a specific user's chat_id via /start param
   */
  static async checkUpdatesForSync(token: string, userId: string): Promise<string | null> {
    if (!token) return null;
    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=100&allowed_updates=["message"]`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.result) {
        const match = data.result.find((update: any) => {
          const text = update.message?.text || "";
          return text.includes(`/start ${userId}`);
        });
        
        if (match) {
          return String(match.message.from.id);
        }
      }
      return null;
    } catch (err) {
      console.error("Telegram Update Error:", err);
      return null;
    }
  }

  /**
   * Escapes special characters for Telegram MarkdownV2
   */
  static escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Formats and sends a proxy assignment alert
   */
  static async sendProxyAlert(token: string, teacher: User, sub: SubstitutionRecord): Promise<boolean> {
    if (!teacher.telegram_chat_id) return false;

    const title = this.escape(`🚨 PROXY DUTY ASSIGNED`);
    const school = this.escape(SCHOOL_NAME);
    const date = this.escape(sub.date);
    const period = this.escape(String(sub.slotId));
    const className = this.escape(sub.className);
    const subject = this.escape(sub.subject);
    const absent = this.escape(sub.absentTeacherName);
    
    const message = `*${title}*\n\n` +
      `🏫 *School:* ${school}\n` +
      `📅 *Date:* ${date}\n` +
      `🕒 *Period:* ${period}\n` +
      `📚 *Class:* ${className}\n` +
      `📖 *Subject:* ${subject}\n\n` +
      `👤 *In Place Of:* ${absent}\n\n` +
      `🔗 [Open Staff Portal](${window.location.origin})`;

    return await this.sendMessage(token, teacher.telegram_chat_id, message);
  }

  /**
   * Sends a general verification/test message
   */
  static async sendTestSignal(token: string, chatId: string, userName: string): Promise<boolean> {
    const text = this.escape(`✅ MATRIX LINK VERIFIED\n\nSalams ${userName}, your Telegram account is successfully synced with the ${SCHOOL_NAME} Staff Portal.`);
    return await this.sendMessage(token, chatId, text);
  }
}