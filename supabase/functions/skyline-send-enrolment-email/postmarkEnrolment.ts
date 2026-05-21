/** Postmark email with PDF + file attachments for enrolment submissions. */

export type PostmarkAttachment = {
  Name: string;
  Content: string;
  ContentType: string;
};

export type SendEnrolmentEmailResult = { ok: true } | { ok: false; message: string };

export function getPostmarkConfig(): { token: string; from: string; messageStream?: string } | null {
  const token = (Deno.env.get('POSTMARK_SERVER_TOKEN') || Deno.env.get('SKYLINE_POSTMARK_SERVER_TOKEN') || '').trim();
  const from = (Deno.env.get('POSTMARK_FROM_EMAIL') || Deno.env.get('SKYLINE_POSTMARK_FROM_EMAIL') || '').trim();
  if (!token || !from) return null;
  const messageStream = (Deno.env.get('POSTMARK_MESSAGE_STREAM') || Deno.env.get('SKYLINE_POSTMARK_MESSAGE_STREAM') || '').trim();
  return { token, from, messageStream: messageStream || undefined };
}

function buildEnrolmentEmailBodies(input: {
  recipientName: string;
  applicationNo: string | null;
  forAgent: boolean;
}): { subject: string; htmlBody: string; textBody: string } {
  const ref = input.applicationNo ? ` (reference ${input.applicationNo})` : '';
  const subject = input.forAgent
    ? `Student enrolment application copy${ref}`
    : `Your Skyline enrolment application${ref}`;

  const intro = input.forAgent
    ? `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">Hello,</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">A copy of the international student enrolment application for <strong>${escapeHtml(input.recipientName)}</strong> is attached, as requested.</p>`
    : `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">Hi${input.recipientName ? ` ${escapeHtml(input.recipientName)}` : ''},</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">Thank you for submitting your international student application to Skyline Institute of Technology.</p>`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f1f5f9;color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;">
<tr><td style="padding:28px 32px;">
${intro}
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">Attached are your completed <strong>application form (PDF)</strong> and the <strong>documents you uploaded</strong> with this application.</p>
<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#64748b;">Our admissions team will contact you using the email address on your application.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">Please do not reply to this email.</p>
</td></tr>
<tr><td style="padding:14px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
<p style="margin:0;font-size:12px;color:#5b21b6;">© Skyline Institute of Technology</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const textBody = [
    input.forAgent
      ? `A copy of the enrolment application for ${input.recipientName} is attached.`
      : `Thank you for submitting your international student application to Skyline Institute of Technology.`,
    '',
    'Attached: application form (PDF) and your uploaded documents.',
    input.applicationNo ? `Reference: ${input.applicationNo}` : '',
    '',
    'Please do not reply to this email.',
    '',
    '© Skyline Institute of Technology',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, htmlBody, textBody };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEnrolmentEmailViaPostmark(input: {
  to: string;
  recipientName: string;
  applicationNo: string | null;
  forAgent: boolean;
  attachments: PostmarkAttachment[];
}): Promise<SendEnrolmentEmailResult> {
  const config = getPostmarkConfig();
  if (!config) {
    return { ok: false, message: 'Enrolment email is not configured. Contact your administrator.' };
  }

  const { subject, htmlBody, textBody } = buildEnrolmentEmailBodies({
    recipientName: input.recipientName,
    applicationNo: input.applicationNo,
    forAgent: input.forAgent,
  });

  const payload: Record<string, unknown> = {
    From: config.from,
    To: input.to.trim(),
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: textBody,
    Attachments: input.attachments,
  };
  if (config.messageStream) payload.MessageStream = config.messageStream;

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': config.token,
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => ({}))) as { ErrorCode?: number; Message?: string };
    if (res.ok && json.ErrorCode === 0) {
      return { ok: true };
    }

    console.error('Postmark enrolment send failed', { status: res.status, body: json, to: input.to });
    return {
      ok: false,
      message: typeof json.Message === 'string' && json.Message.trim() ? json.Message : 'Failed to send enrolment email.',
    };
  } catch (e) {
    console.error('Postmark enrolment error:', e);
    return { ok: false, message: 'Failed to send enrolment email.' };
  }
}
