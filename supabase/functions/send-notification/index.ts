import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendNotificationInput = {
  userIds: string[];
  title: string;
  message: string;
  url?: string;
  type?: string;
};

type PushTokenRow = { id: string; user_id: string; fcm_token: string; is_active: boolean };

type FcmSendResult =
  | { ok: true }
  | { ok: false; invalidToken: boolean; status: number; errorStatus?: string; errorMessage?: string };

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanPrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n');
}

async function createJWT(input: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
  aud: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: input.clientEmail,
    scope: input.scope,
    aud: input.aud,
    iat: now,
    exp: now + 3600,
  };
  const toSign = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

  const keyData = input.privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const pkcs8 = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(toSign));
  return `${toSign}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAccessToken(input: { clientEmail: string; privateKeyPem: string }): Promise<string> {
  const assertion = await createJWT({
    clientEmail: input.clientEmail,
    privateKeyPem: input.privateKeyPem,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
  });

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenJson = (await tokenResp.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResp.ok || !tokenJson.access_token) {
    console.error('getAccessToken failed', { status: tokenResp.status, body: tokenJson });
    throw new Error('Failed to obtain Google access token');
  }
  return tokenJson.access_token;
}

async function sendFCM(input: {
  projectId: string;
  accessToken: string;
  token: string;
  title: string;
  message: string;
  url: string;
  type: string;
}): Promise<FcmSendResult> {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${input.projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: input.token,
        notification: { title: input.title, body: input.message },
        webpush: {
          fcm_options: { link: input.url },
          notification: {
            title: input.title,
            body: input.message,
          },
        },
        data: {
          url: input.url,
          type: input.type,
        },
      },
    }),
  });

  if (resp.ok) return { ok: true };

  const errJson = (await resp.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
  const errorStatus = errJson?.error?.status;
  const errorMessage = errJson?.error?.message;
  const invalidToken = errorStatus === 'UNREGISTERED' || errorStatus === 'INVALID_ARGUMENT';
  return { ok: false, invalidToken, status: resp.status, errorStatus, errorMessage };
}

function normalizeInput(raw: unknown): { ok: true; value: Required<Pick<SendNotificationInput, 'userIds' | 'title' | 'message'>> & { url: string; type: string } } | { ok: false; message: string } {
  const body = raw as Partial<SendNotificationInput> | null;
  const userIds = Array.isArray(body?.userIds) ? body!.userIds.map((x) => String(x).trim()).filter(Boolean) : [];
  const title = String(body?.title ?? '').trim();
  const message = String(body?.message ?? '').trim();
  const url = String(body?.url ?? '').trim() || '/';
  const type = String(body?.type ?? '').trim() || 'general';
  if (userIds.length === 0) return { ok: false, message: 'userIds must be a non-empty array.' };
  if (!title) return { ok: false, message: 'title is required.' };
  if (!message) return { ok: false, message: 'message is required.' };
  return { ok: true, value: { userIds: [...new Set(userIds)], title, message, url, type } };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  let json: unknown = null;
  try {
    json = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON input' }, { status: 400, headers: corsHeaders });
  }

  const parsed = normalizeInput(json);
  if (!parsed.ok) {
    return Response.json({ success: false, error: parsed.message }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';
  const clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL') ?? '';
  const privateKeyRaw = Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ success: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500, headers: corsHeaders });
  }
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return Response.json({ success: false, error: 'Missing Firebase secrets' }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { userIds, title, message, url, type } = parsed.value;

  // 1) Insert in-app notifications
  try {
    const insertRows = userIds.map((uid) => ({ user_id: uid, title, message, url, type, is_read: false }));
    const { data: inserted, error: insertError } = await supabase.from('skyline_notifications').insert(insertRows).select('id');
    if (insertError) {
      console.error('insert notifications error', insertError);
      return Response.json({ success: false, error: 'Failed to insert notifications' }, { status: 500, headers: corsHeaders });
    }

    // 2) Load active push tokens
    const { data: tokenRows, error: tokenError } = await supabase
      .from('skyline_push_tokens')
      .select('id,user_id,fcm_token,is_active')
      .in('user_id', userIds)
      .eq('is_active', true);
    if (tokenError) {
      console.error('load push tokens error', tokenError);
      return Response.json(
        {
          success: true,
          inserted_notifications: inserted?.length ?? 0,
          push_success: 0,
          push_failed: 0,
          invalid_tokens: 0,
          warning: 'Failed to load push tokens',
        },
        { status: 200, headers: corsHeaders }
      );
    }

    const tokens = ((tokenRows as PushTokenRow[] | null) ?? []) as PushTokenRow[];
    if (tokens.length === 0) {
      return Response.json(
        { success: true, inserted_notifications: inserted?.length ?? 0, push_success: 0, push_failed: 0, invalid_tokens: 0 },
        { status: 200, headers: corsHeaders }
      );
    }

    // 3) Create OAuth access token
    let accessToken = '';
    try {
      accessToken = await getAccessToken({ clientEmail, privateKeyPem: cleanPrivateKey(privateKeyRaw) });
    } catch (e) {
      console.error('FCM auth failed', e);
      return Response.json(
        {
          success: true,
          inserted_notifications: inserted?.length ?? 0,
          push_success: 0,
          push_failed: tokens.length,
          invalid_tokens: 0,
          warning: 'Failed to authenticate with Firebase',
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // 4) Send pushes in parallel
    const results = await Promise.allSettled(
      tokens.map((t) =>
        sendFCM({
          projectId,
          accessToken,
          token: t.fcm_token,
          title,
          message,
          url,
          type,
        }).then((r) => ({ rowId: t.id, result: r }))
      )
    );

    let pushSuccess = 0;
    let pushFailed = 0;
    const invalidTokenIds: string[] = [];
    for (const r of results) {
      if (r.status === 'rejected') {
        pushFailed += 1;
        console.error('sendFCM rejected', r.reason);
        continue;
      }
      if (r.value.result.ok) {
        pushSuccess += 1;
      } else {
        pushFailed += 1;
        if (r.value.result.invalidToken) invalidTokenIds.push(r.value.rowId);
        console.error('sendFCM failed', {
          status: r.value.result.status,
          errorStatus: r.value.result.errorStatus,
          errorMessage: r.value.result.errorMessage,
        });
      }
    }

    // 5) Deactivate invalid tokens
    if (invalidTokenIds.length > 0) {
      const { error: deactivateErr } = await supabase
        .from('skyline_push_tokens')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('id', invalidTokenIds);
      if (deactivateErr) console.error('deactivate invalid tokens error', deactivateErr);
    }

    return Response.json(
      {
        success: true,
        inserted_notifications: inserted?.length ?? 0,
        push_success: pushSuccess,
        push_failed: pushFailed,
        invalid_tokens: invalidTokenIds.length,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (e) {
    console.error('send-notification unexpected error', e);
    return Response.json({ success: false, error: 'Unexpected error' }, { status: 500, headers: corsHeaders });
  }
});

