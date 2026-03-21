// OTP request Edge Function: creates OTP in DB and sends email via Power Automate server-side.
// The OTP is never returned to the client, so it does not appear in the network tab.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  let body: { email?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, message: 'Invalid JSON body.' }, { status: 400, headers: corsHeaders });
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const type = (body?.type === 'student' ? 'student' : 'staff') as 'staff' | 'student';

  if (!email) {
    return Response.json({ success: false, message: 'Email is required.' }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const powerAutomateUrl = Deno.env.get('SKYLINE_POWER_AUTOMATE_OTP_URL') || Deno.env.get('POWER_AUTOMATE_OTP_URL');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return Response.json(
      { success: false, message: 'Server configuration error.' },
      { status: 500, headers: corsHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const rpcName = type === 'student' ? 'skyline_request_student_otp' : 'skyline_request_otp';
  const { data, error } = await supabase.rpc(rpcName, { p_email: email });

  if (error) {
    console.error('RPC error:', error);
    return Response.json(
      { success: false, message: error.message || 'Failed to request OTP.' },
      { status: 200, headers: corsHeaders }
    );
  }

  const row = (data as Array<{ success: boolean; otp: string | null; message: string }>)?.[0];
  if (!row) {
    return Response.json({ success: false, message: 'Unexpected response.' }, { status: 200, headers: corsHeaders });
  }
  if (!row.success) {
    return Response.json({ success: false, message: row.message || 'User not found.' }, { status: 200, headers: corsHeaders });
  }

  const otp = row.otp ?? '';
  if (!otp) {
    return Response.json({ success: false, message: 'Failed to generate OTP.' }, { status: 200, headers: corsHeaders });
  }

  if (!powerAutomateUrl?.trim()) {
    return Response.json(
      { success: false, message: 'OTP email is not configured. Contact your administrator.' },
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    const res = await fetch(powerAutomateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    const accepted = res.status === 202 || (res.ok && json.success !== false);
    if (!accepted) {
      return Response.json(
        { success: false, message: json.message || 'Failed to send OTP email. Please try again.' },
        { status: 200, headers: corsHeaders }
      );
    }
  } catch (e) {
    console.error('Power Automate error:', e);
    return Response.json(
      { success: false, message: 'Failed to send OTP email. Please try again.' },
      { status: 200, headers: corsHeaders }
    );
  }

  return Response.json(
    { success: true, message: 'OTP sent. Check your email. Valid for 10 minutes.' },
    { status: 200, headers: corsHeaders }
  );
});
