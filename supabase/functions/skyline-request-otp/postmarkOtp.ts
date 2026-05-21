/** Postmark OTP email (bundled with this edge function on deploy). */

export type SendOtpEmailResult = { ok: true } | { ok: false; message: string };

export function getPostmarkOtpConfig(): { token: string; from: string; messageStream?: string } | null {
  const token = (Deno.env.get('POSTMARK_SERVER_TOKEN') || Deno.env.get('SKYLINE_POSTMARK_SERVER_TOKEN') || '').trim();
  const from = (Deno.env.get('POSTMARK_FROM_EMAIL') || Deno.env.get('SKYLINE_POSTMARK_FROM_EMAIL') || '').trim();
  if (!token || !from) return null;
  const messageStream = (Deno.env.get('POSTMARK_MESSAGE_STREAM') || Deno.env.get('SKYLINE_POSTMARK_MESSAGE_STREAM') || '').trim();
  return { token, from, messageStream: messageStream || undefined };
}

/** HTML aligned with docs/otp-email-template.json (Skyline OTP layout). */
const OTP_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f1f5f9;color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;margin:0 auto;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:4px;">
<tr><td style="padding:28px 32px 24px 32px;">
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#0f172a;">Hi,</p>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.5;color:#0f172a;">Use this code to sign in:</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;">
<tr><td align="center" style="background-color:#fff7ed;border:1px solid #f47a1f;border-radius:6px;padding:22px 16px;">
<span style="font-size:32px;font-weight:700;letter-spacing:4px;color:#f47a1f;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">{{OTP}}</span>
</td></tr>
</table>
<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#475569;">This code is valid for <strong>10 minutes</strong>.</p>
<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#64748b;">If you didn't request this, you can safely ignore this email.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">Please do not reply to this email.</p>
</td></tr>
<tr><td style="padding:14px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
<p style="margin:0;font-size:12px;line-height:1.4;color:#5b21b6;">© Skyline Institute of Technology</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

function buildOtpEmailContent(otp: string): { subject: string; htmlBody: string; textBody: string } {
  const subject = `Your Skyline OTP is :${otp}`;
  const htmlBody = OTP_HTML_TEMPLATE.replace(/\{\{OTP\}\}/g, otp);
  const textBody = [
    'Hi,',
    '',
    'Use this code to sign in:',
    '',
    otp,
    '',
    'This code is valid for 10 minutes.',
    '',
    "If you didn't request this, you can safely ignore this email.",
    '',
    'Please do not reply to this email.',
    '',
    '© Skyline Institute of Technology',
  ].join('\n');
  return { subject, htmlBody, textBody };
}

export async function sendOtpEmailViaPostmark(to: string, otp: string): Promise<SendOtpEmailResult> {
  const config = getPostmarkOtpConfig();
  if (!config) {
    return { ok: false, message: 'OTP email is not configured. Contact your administrator.' };
  }

  const { subject, htmlBody, textBody } = buildOtpEmailContent(otp);
  const payload: Record<string, string> = {
    From: config.from,
    To: to,
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: textBody,
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

    console.error('Postmark send failed', { status: res.status, body: json });
    return {
      ok: false,
      message: typeof json.Message === 'string' && json.Message.trim() ? json.Message : 'Failed to send OTP email. Please try again.',
    };
  } catch (e) {
    console.error('Postmark error:', e);
    return { ok: false, message: 'Failed to send OTP email. Please try again.' };
  }
}
