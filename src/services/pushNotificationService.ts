import { getToken, onMessage, type MessagePayload } from 'firebase/messaging';
import { firebasePublicConfigForSw, firebaseVapidKey, getFirebaseMessaging } from '../lib/firebase';
import { supabase } from '../lib/supabase';
import { recordSupabaseError } from '../lib/supabaseRequestGuard';

const PUSH_TOKEN_SESSION_KEY = 'signflow.push_token.session_v1';
const pushTokenLocalKey = (userId: string) => `signflow.push_token.last_v1.${userId}`;

function getBrowserLabel(): string {
  try {
    return navigator.userAgent.slice(0, 255);
  } catch {
    return 'unknown';
  }
}

function isPushTokenRegisteredThisSession(userId: string, token: string): boolean {
  try {
    const raw = sessionStorage.getItem(PUSH_TOKEN_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { userId?: string; token?: string };
    return parsed.userId === userId && parsed.token === token;
  } catch {
    return false;
  }
}

function markPushTokenRegistered(userId: string, token: string): void {
  try {
    sessionStorage.setItem(PUSH_TOKEN_SESSION_KEY, JSON.stringify({ userId, token }));
    localStorage.setItem(pushTokenLocalKey(userId), token);
  } catch {
    /* ignore storage errors */
  }
}

function isPushTokenUnchangedSinceLastVisit(userId: string, token: string): boolean {
  try {
    return localStorage.getItem(pushTokenLocalKey(userId)) === token;
  } catch {
    return false;
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
    if (import.meta.env.DEV) console.debug('requestNotificationPreference error', e);
    return null;
  }
}

export async function saveFcmToken(userId: string | number, token: string): Promise<void> {
  const uid = String(userId ?? '').trim();
  const t = String(token ?? '').trim();
  if (!uid || !t) return;

  if (isPushTokenRegisteredThisSession(uid, t)) return;
  if (isPushTokenUnchangedSinceLastVisit(uid, t)) {
    markPushTokenRegistered(uid, t);
    return;
  }

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
    recordSupabaseError('skyline_push_tokens', error);
    return;
  }
  markPushTokenRegistered(uid, t);
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
    if (import.meta.env.DEV) console.debug('requestNotificationPermission error', e);
    return null;
  }
}

/**
 * Best-effort: if notifications are already granted, ensure we have a saved FCM token.
 * Does NOT prompt the user (no Notification.requestPermission call).
 */
export async function ensureFcmToken(userId: string | number): Promise<string | null> {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
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
    await saveFcmToken(uid, token);
    return token;
  } catch (e) {
    if (import.meta.env.DEV) console.debug('ensureFcmToken error', e);
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
