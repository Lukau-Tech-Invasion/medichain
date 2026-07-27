/**
 * Browser push-notification subscription (Phase 5.2).
 *
 * The backend already has a real FCM HTTP v1 client (`send_push_to_user`,
 * `api/src/notifications.rs`) and both apps' service workers already handle
 * the `push` event (`public/sw.js`) — what was missing was the piece in
 * between: nothing ever asked the browser for permission, subscribed via
 * Firebase Cloud Messaging, or told the backend which token to send to.
 * This closes that gap.
 *
 * Gated behind Firebase config env vars, same pattern as `SMTP_ENABLED`/
 * `SNYK_ENABLED` elsewhere in this project: unconfigured (the default) is a
 * silent, safe no-op so builds and dev/demo runs are unaffected. A real
 * Firebase project (console.firebase.google.com) + VAPID key are something
 * only the project owner can create — this environment cannot provision one,
 * so the full send→receive path is not live-verified here. What IS verified:
 * `npm run typecheck` passes with these calls in place, and the no-op path
 * (no config) is exercised by never throwing when the env vars are absent.
 */
import { registerDeviceToken } from './api/endpoints';

interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}

function firebaseConfigFromEnv(): FirebaseWebConfig | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.VITE_FIREBASE_APP_ID;

  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    return null;
  }
  return { apiKey, projectId, messagingSenderId, appId };
}

let initialized = false;

/**
 * Request notification permission, subscribe via Firebase Cloud Messaging,
 * and register the resulting token with the backend. Call once after login.
 *
 * No-ops (returns false) when: Firebase env vars aren't configured, the
 * browser doesn't support the Push API/service workers, or the user denies
 * (or has denied) the permission prompt. Never throws — a missing push
 * subscription must never block login or break the app.
 */
export async function initPushNotifications(): Promise<boolean> {
  if (initialized) return true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  const config = firebaseConfigFromEnv();
  const vapidKey = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FCM_VAPID_KEY;
  if (!config || !vapidKey) {
    // Not configured — expected in dev/demo and in this environment (needs a
    // real Firebase project this environment cannot create). Silent no-op.
    return false;
  }

  try {
    const [{ initializeApp }, { getMessaging, getToken }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return false;
    }

    const app = initializeApp(config);
    const messaging = getMessaging(app);
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return false;
    }

    await registerDeviceToken(token, detectDeviceType(), navigator.userAgent.slice(0, 120));
    initialized = true;
    return true;
  } catch (err) {
    console.warn('[push] Initialization failed, continuing without push notifications:', err);
    return false;
  }
}

function detectDeviceType(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android-web';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web';
  return 'web';
}
