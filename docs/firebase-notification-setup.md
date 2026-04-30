# Firebase + Supabase Notifications Setup

## 1) Create Firebase project and web app

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create/select your project.
3. Add a **Web App** and copy config values.
4. In **Project settings > Cloud Messaging** generate a **Web Push certificate key pair** and copy the **VAPID key**.

## 2) Frontend environment variables

Add these in your app env (for Vite):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

## 3) Supabase database objects

Run migrations that create:

- `skyline_push_tokens`
- `skyline_notifications`

No RLS policies are added in this phase.

## 4) Supabase Edge Function secrets

Set secrets for `send-notification`:

```bash
supabase secrets set FIREBASE_PROJECT_ID=...
supabase secrets set FIREBASE_CLIENT_EMAIL=...
supabase secrets set FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Also ensure these are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 5) Service account key setup

1. Firebase Console > Project settings > Service accounts.
2. Generate new private key JSON.
3. Use:
   - `project_id` -> `FIREBASE_PROJECT_ID`
   - `client_email` -> `FIREBASE_CLIENT_EMAIL`
   - `private_key` -> `FIREBASE_PRIVATE_KEY` (preserve newlines as `\n` when setting)

## 6) Deploy edge function

```bash
supabase functions deploy send-notification
```

If running locally:

```bash
supabase functions serve send-notification --env-file ./supabase/.env.local
```

## 7) Runtime flow

1. User logs in.
2. App requests browser notification permission.
3. App gets FCM token and upserts into `skyline_push_tokens`.
4. Admin/system calls `send-notification`.
5. Function inserts rows into `skyline_notifications`.
6. Function sends push to active `skyline_push_tokens`.
7. Bell UI and Notifications page read from `skyline_notifications` and update in realtime.

