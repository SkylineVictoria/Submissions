// Sends enrolment PDF + uploaded documents via Postmark after successful submit.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEnrolmentEmailViaPostmark, type PostmarkAttachment } from './postmarkEnrolment.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type FileRefInput = {
  path?: string;
  name?: string;
  mimeType?: string;
  section?: string;
  field?: string;
};

const ATTACHMENT_LABELS: Record<string, string> = {
  'vet.passport': 'Passport',
  'vet.visa': 'Visa',
  'vet.english': 'English_results',
  'disability.document': 'Disability_support',
  'credit.evidence': 'RPL_credit_evidence',
  'oshc.document': 'OSHC',
};

function parseStoragePath(fullPath: string): { bucket: string; objectPath: string } | null {
  const trimmed = fullPath.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: trimmed.slice(0, slash), objectPath: trimmed.slice(slash + 1) };
}

function safeAttachmentName(name: string, fallback: string): string {
  const base = (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return base.includes('.') ? base : `${base}.bin`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function attachmentLabel(ref: FileRefInput): string {
  const key = `${ref.section ?? ''}.${ref.field ?? ''}`;
  return ATTACHMENT_LABELS[key] ?? ref.name ?? key;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  let body: {
    applicationId?: string;
    applicationNo?: string | null;
    applicantEmail?: string;
    applicantName?: string;
    agentEmail?: string;
    sendToAgent?: boolean;
    pdfBase64?: string;
    pdfFilename?: string;
    fileRefs?: FileRefInput[];
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, message: 'Invalid JSON body.' }, { status: 400, headers: corsHeaders });
  }

  const applicationId = typeof body.applicationId === 'string' ? body.applicationId.trim() : '';
  const applicantEmail = typeof body.applicantEmail === 'string' ? body.applicantEmail.trim().toLowerCase() : '';
  const applicantName = typeof body.applicantName === 'string' ? body.applicantName.trim() : '';
  const pdfBase64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64.trim() : '';
  const pdfFilename = safeAttachmentName(
    typeof body.pdfFilename === 'string' ? body.pdfFilename.trim() : '',
    'application_form.pdf'
  );
  const applicationNo =
    typeof body.applicationNo === 'string' && body.applicationNo.trim() ? body.applicationNo.trim() : null;
  const sendToAgent = Boolean(body.sendToAgent);
  const agentEmail = typeof body.agentEmail === 'string' ? body.agentEmail.trim().toLowerCase() : '';
  const fileRefs = Array.isArray(body.fileRefs) ? body.fileRefs : [];

  if (!applicationId || !applicantEmail || !isValidEmail(applicantEmail)) {
    return Response.json({ success: false, message: 'Valid application and applicant email are required.' }, {
      status: 400,
      headers: corsHeaders,
    });
  }
  if (!pdfBase64) {
    return Response.json({ success: false, message: 'Application PDF is required.' }, { status: 400, headers: corsHeaders });
  }
  if (sendToAgent && (!agentEmail || !isValidEmail(agentEmail))) {
    return Response.json({ success: false, message: 'Valid agent email is required when sending a copy to the agent.' }, {
      status: 400,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ success: false, message: 'Server configuration error.' }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: appRow, error: appErr } = await supabase
    .from('student_enrolment_applications')
    .select('id, status, email, application_no')
    .eq('id', applicationId)
    .maybeSingle();

  if (appErr) {
    console.error('enrolment lookup error', appErr);
    return Response.json({ success: false, message: 'Could not verify application.' }, { status: 200, headers: corsHeaders });
  }
  if (!appRow || appRow.status !== 'submitted') {
    return Response.json({ success: false, message: 'Application not found or not submitted.' }, { status: 200, headers: corsHeaders });
  }
  const rowEmail = String((appRow as { email?: string }).email ?? '').trim().toLowerCase();
  if (rowEmail && rowEmail !== applicantEmail) {
    return Response.json({ success: false, message: 'Email does not match application.' }, { status: 200, headers: corsHeaders });
  }

  const attachments: PostmarkAttachment[] = [
    {
      Name: pdfFilename.endsWith('.pdf') ? pdfFilename : `${pdfFilename}.pdf`,
      Content: pdfBase64,
      ContentType: 'application/pdf',
    },
  ];

  for (const ref of fileRefs) {
    if (!ref?.path || ref.field === 'application_pdf' || ref.section === 'package') continue;
    const parsed = parseStoragePath(String(ref.path));
    if (!parsed) continue;

    const { data: blob, error: dlErr } = await supabase.storage.from(parsed.bucket).download(parsed.objectPath);
    if (dlErr || !blob) {
      console.error('attachment download failed', ref.path, dlErr);
      continue;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = ref.name?.includes('.') ? '' : '';
    const label = attachmentLabel(ref);
    const fileName = safeAttachmentName(ref.name ?? '', `${label}${ext}`);
    attachments.push({
      Name: fileName,
      Content: bytesToBase64(bytes),
      ContentType: ref.mimeType?.trim() || blob.type || 'application/octet-stream',
    });
  }

  const studentResult = await sendEnrolmentEmailViaPostmark({
    to: applicantEmail,
    recipientName: applicantName,
    applicationNo: applicationNo ?? (appRow as { application_no?: string }).application_no ?? null,
    forAgent: false,
    attachments,
  });

  if (!studentResult.ok) {
    return Response.json({ success: false, message: studentResult.message }, { status: 200, headers: corsHeaders });
  }

  let agentSent = false;
  if (sendToAgent && agentEmail) {
    const agentResult = await sendEnrolmentEmailViaPostmark({
      to: agentEmail,
      recipientName: applicantName || 'Applicant',
      applicationNo: applicationNo ?? (appRow as { application_no?: string }).application_no ?? null,
      forAgent: true,
      attachments,
    });
    if (!agentResult.ok) {
      return Response.json(
        {
          success: true,
          applicantSent: true,
          agentSent: false,
          message: `Application emailed to ${applicantEmail}, but the agent copy failed: ${agentResult.message}`,
        },
        { status: 200, headers: corsHeaders }
      );
    }
    agentSent = true;
  }

  return Response.json(
    {
      success: true,
      applicantSent: true,
      agentSent,
      message: agentSent
        ? `Application emailed to ${applicantEmail} and ${agentEmail}.`
        : `Application emailed to ${applicantEmail}.`,
    },
    { status: 200, headers: corsHeaders }
  );
});
