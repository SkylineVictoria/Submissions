import { getToken, onMessage, type MessagePayload } from 'firebase/messaging';
import { firebasePublicConfigForSw, firebaseVapidKey, getFirebaseMessaging } from '../lib/firebase';
import { supabase } from '../lib/supabase';

function getBrowserLabel(): string {
  try {
    return navigator.userAgent.slice(0, 255);
  } catch {
    return 'unknown';
  }
}

async function registerFirebaseMessagingServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const payload = { type: 'FIREBASE_CONFIG', config: firebasePublicConfigForSw };
  registration.active?.postMessage(payload);
  registration.waiting?.postMessage(payload);
  registration.installing?.postMessage(payload);
  return registration;
}

/** Ask permission only (no token save). Useful for flows that don't have a staff userId available (e.g. public induction). */
export async function requestNotificationPreference(): Promise<NotificationPermission | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  try {
    // Don't keep re-prompting if the user already decided (or the browser is blocking prompts).
    if (Notification.permission !== 'default') return Notification.permission;

    const permission = await Notification.requestPermission();
    // Register SW so background delivery works once token is later collected in the admin app.
    if (permission === 'granted') {
      await registerFirebaseMessagingServiceWorker().catch(() => null);
    }
    return permission;
  } catch (e) {
    console.error('requestNotificationPreference error', e);
    return null;
  }
}

export async function saveFcmToken(userId: string | number, token: string): Promise<void> {
  const uid = String(userId ?? '').trim();
  const t = String(token ?? '').trim();
  if (!uid || !t) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('skyline_push_tokens').upsert(
    {
      user_id: uid,
      fcm_token: t,
      platform: 'web',
      browser: getBrowserLabel(),
      is_active: true,
      updated_at: now,
    },
    { onConflict: 'user_id,fcm_token' }
  );
  if (error) {
    console.error('saveFcmToken error', error);
  }
}

export async function requestNotificationPermission(userId: string | number): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (!firebaseVapidKey) return null;
  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;

  // If blocked, the browser will refuse prompting; if already granted, skip the prompt.
  if (Notification.permission === 'denied') return null;
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
  }
  if (Notification.permission !== 'granted') return null;

  const registration = await registerFirebaseMessagingServiceWorker();
  if (!registration) return null;

  try {
    const token = await getToken(messaging, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;
    await saveFcmToken(userId, token);
    return token;
  } catch (e) {
    console.error('requestNotificationPermission error', e);
    return null;
  }
}

/**
 * Best-effort: if notifications are already granted, ensure we have a saved FCM token.
 * Does NOT prompt the user (no Notification.requestPermission call).
 */
export async function ensureFcmToken(userId: string | number): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;
  if (!firebaseVapidKey) return null;
  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;

  const registration = await registerFirebaseMessagingServiceWorker();
  if (!registration) return null;

  try {
    const token = await getToken(messaging, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;
    await saveFcmToken(userId, token);
    return token;
  } catch (e) {
    console.error('ensureFcmToken error', e);
    return null;
  }
}

export async function listenForForegroundMessages(
  callback: (payload: MessagePayload) => void
): Promise<(() => void) | null> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;
  return onMessage(messaging, callback);
}

