
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE } from '../constants.ts';

export interface SyncItem {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  payload: any;
  timestamp: number; // The absolute Unix time when the user clicked the button
  userName: string;
}

export class SyncService {
  private static STORAGE_KEY = 'ihis_sync_queue';

  static getQueue(): SyncItem[] {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  static addToQueue(type: 'CHECK_IN' | 'CHECK_OUT', payload: any, userName: string) {
    const queue = this.getQueue();
    const newItem: SyncItem = {
      id: generateUUID(),
      type,
      payload,
      timestamp: Date.now(),
      userName
    };
    queue.push(newItem);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(queue));
    
    window.dispatchEvent(new CustomEvent('ihis_sync_updated', { detail: queue.length }));
  }

  /**
   * Phase 6 Enhancement: Temporal Integrity Check
   * Validates if a synced check-in was late based on its original capture time.
   */
  private static reconcileTemporalRules(item: SyncItem) {
    if (item.type !== 'CHECK_IN') return item.payload;

    const originalTime = new Date(item.timestamp);
    // Force evaluation in Bahrain Time logic
    const hours = originalTime.getHours();
    const minutes = originalTime.getMinutes();

    const isLate = hours > LATE_THRESHOLD_HOUR || (hours === LATE_THRESHOLD_HOUR && minutes > LATE_THRESHOLD_MINUTE);
    
    return {
      ...item.payload,
      is_late: isLate,
      captured_at: originalTime.toISOString()
    };
  }

  static async processQueue(onItemSynced?: (item: SyncItem) => void): Promise<boolean> {
    if (!navigator.onLine || !IS_CLOUD_ENABLED) return false;

    const queue = this.getQueue();
    if (queue.length === 0) return false;

    const failed: SyncItem[] = [];
    let someSucceeded = false;

    for (const item of queue) {
      try {
        const reconciledPayload = this.reconcileTemporalRules(item);

        if (item.type === 'CHECK_IN') {
          const { error } = await supabase.from('attendance').insert(reconciledPayload);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('attendance')
            .update({ check_out: item.payload.check_out })
            .match({ user_id: item.payload.user_id, date: item.payload.date });
          if (error) throw error;
        }
        
        someSucceeded = true;
        if (onItemSynced) onItemSynced(item);
      } catch (err) {
        console.error("Background sync item failed:", err);
        failed.push(item);
      }
    }

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(failed));
    window.dispatchEvent(new CustomEvent('ihis_sync_updated', { detail: failed.length }));
    
    return someSucceeded;
  }

  static hasPending(): boolean {
    return this.getQueue().length > 0;
  }
}
