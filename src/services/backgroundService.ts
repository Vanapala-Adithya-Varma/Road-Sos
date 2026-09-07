/**
 * Keeps the sensor + wake-word pipelines alive when the screen is off or the app is
 * backgrounded.
 *
 *  - Native foreground monitoring requires a bundled native foreground-service plugin.
 *    This repository does not include one, so native background detection is reported
 *    as unavailable instead of claiming protection is active.
 *  - Web/PWA: acquires a Screen Wake Lock so the page is not throttled while driving
 *    (browsers cannot run sensors with the screen off — this is why Android is the
 *    primary target for Features 1 and 3).
 */
import { Capacitor } from '@capacitor/core';

export type BackgroundMode = 'foreground-service' | 'wake-lock' | 'none';

let wakeLock: any = null;
let active: BackgroundMode = 'none';

export const backgroundService = {
  get mode(): BackgroundMode { return active; },

  async enable(): Promise<BackgroundMode> {
    if (active !== 'none') return active;
    if (Capacitor.isNativePlatform()) console.warn('[Background] Native foreground monitoring is not bundled; protection may stop when the app backgrounds.');
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await (navigator as any).wakeLock.request('screen');
        wakeLock.addEventListener?.('release', () => { if (active === 'wake-lock') active = 'none'; });
        document.addEventListener('visibilitychange', reacquire);
        active = 'wake-lock';
      }
    } catch (e) {
      console.warn('[Background] wake lock unavailable', (e as Error).message);
    }
    return active;
  },

  async disable() {
    try { await wakeLock?.release?.(); } catch { /* ignore */ }
    document.removeEventListener('visibilitychange', reacquire);
    wakeLock = null;
    active = 'none';
  },
};

async function reacquire() {
  if (document.visibilityState === 'visible' && active === 'wake-lock' && !wakeLock) {
    try { wakeLock = await (navigator as any).wakeLock.request('screen'); } catch { /* ignore */ }
  }
}
