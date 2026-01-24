
export class HapticService {
  /**
   * Triggers a subtle tactile pulse
   */
  static light() {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  }

  /**
   * Confirmation pulse (double tap)
   */
  static success() {
    if ('vibrate' in navigator) {
      navigator.vibrate([15, 30, 15]);
    }
  }

  /**
   * Warning/Error pulse (stronger single pulse)
   */
  static error() {
    if ('vibrate' in navigator) {
      navigator.vibrate([100]);
    }
  }

  /**
   * Notification pulse
   */
  static notification() {
    if ('vibrate' in navigator) {
      navigator.vibrate(30);
    }
  }
}
