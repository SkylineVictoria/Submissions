// OTP request Edge Function: creates OTP in DB and sends email via Postmark server-side.
// The OTP is never returned to the client, so it does not appear in the network tab.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendOtpEmailViaPostmark } from './postmarkOtp.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-skyline-otp-type',
};

Deno.serve(async (req) => {
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
  const headerKind = req.headers.get('x-skyline-otp-type')?.trim().toLowerCase() ?? '';
  const bodyKind = typeof body?.type === 'string' ? body.type.trim().toLowerCase() : '';
  const kind = bodyKind || headerKind;
  const type = (kind === 'staff' ? 'staff' : kind === 'induction' ? 'induction' : 'student') as
    | 'staff'
    | 'student'
    | 'induction';

  if (!email) {
    return Response.json({ success: false, message: 'Email is required.' }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return Response.json(
      { success: false, message: 'Server configuration error.' },
      { status: 500, headers: corsHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const rpcName =
    type === 'staff'
      ? 'skyline_request_otp'
      : type === 'induction'
        ? 'skyline_request_induction_otp'
        : 'skyline_request_student_otp';
  const { data, error } = await supabase.rpc(rpcName, { p_email: email });
  const failFallback =
    rpcName === 'skyline_request_induction_otp'
      ? 'Use your @student.slit.edu.au or @slit.edu.au email, or contact your administrator.'
      : rpcName === 'skyline_request_student_otp'
        ? 'Student not found. Contact your administrator.'
        : 'User not found. Contact your administrator.';

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
    const msg = typeof row.message === 'string' && row.message.trim() ? row.message : failFallback;
    return Response.json({ success: false, message: msg }, { status: 200, headers: corsHeaders });
  }

  const otp = row.otp ?? '';
  if (!otp) {
    return Response.json({ success: false, message: 'Failed to generate OTP.' }, { status: 200, headers: corsHeaders });
  }

  const emailResult = await sendOtpEmailViaPostmark(email, otp);
  if (!emailResult.ok) {
    return Response.json({ success: false, message: emailResult.message }, { status: 200, headers: corsHeaders });
  }

  return Response.json(
    { success: true, message: 'OTP sent. Check your email. Valid for 10 minutes.' },
    { status: 200, headers: corsHeaders }
  );
});
