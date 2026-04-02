// Induction OTP only: always calls skyline_request_induction_otp (institutional email + OTP; no staff/student mix-ups).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, message: 'Invalid JSON body.' }, { status: 400, headers: corsHeaders });
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
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
  const { data, error } = await supabase.rpc('skyline_request_induction_otp', { p_email: email });

  if (error) {
    console.error('skyline_request_induction_otp RPC error:', error);
    return Response.json(
      { success: false, message: error.message || 'Failed to request induction code.' },
      { status: 200, headers: corsHeaders }
    );
  }

  const row = (data as Array<{ success: boolean; otp: string | null; message: string | null }>)?.[0];
  if (!row) {
    return Response.json({ success: false, message: 'Unexpected response from server.' }, { status: 200, headers: corsHeaders });
  }
  if (!row.success) {
    const msg =
      typeof row.message === 'string' && row.message.trim()
        ? row.message
        : 'Use your @student.slit.edu.au or @slit.edu.au email, or contact your administrator.';
    return Response.json({ success: false, message: msg }, { status: 200, headers: corsHeaders });
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
