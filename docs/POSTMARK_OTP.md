# Postmark OTP email

**Flow:** The app calls a Supabase Edge Function (`skyline-request-otp` or `skyline-request-induction-otp`). The function creates the OTP in the database and sends email via **Postmark** server-side. The OTP is **never returned to the client** and does not appear in the browser network tab.

## Sequence

1. **App:** `POST /functions/v1/skyline-request-otp` with `{ "email": "...", "type": "staff" | "student" | "induction" }` (or induction-only function).
2. **Edge Function:** RPC creates OTP in DB.
3. **Edge Function:** `POST https://api.postmarkapp.com/email` with HTML + text body.
4. **Client:** Receives `{ "success": true }` only (no OTP in response).

## Supabase secrets

Set these on the project (Dashboard → Edge Functions → Secrets, or CLI):

```bash
supabase secrets set POSTMARK_SERVER_TOKEN="your-server-token"
supabase secrets set POSTMARK_FROM_EMAIL="SignFlow <noreply@your-verified-domain.com>"
```

Optional aliases (same values):

```bash
supabase secrets set SKYLINE_POSTMARK_SERVER_TOKEN="..."
supabase secrets set SKYLINE_POSTMARK_FROM_EMAIL="..."
```

Optional message stream (default Postmark `outbound`):

```bash
supabase secrets set POSTMARK_MESSAGE_STREAM="outbound"
```

Redeploy after setting secrets:

```bash
supabase functions deploy skyline-request-otp
supabase functions deploy skyline-request-induction-otp
```

You can remove legacy Power Automate secrets (`POWER_AUTOMATE_OTP_URL`, `SKYLINE_POWER_AUTOMATE_OTP_URL`) once Postmark is live.

## Postmark setup

1. Create a Postmark account and **Server** (transactional).
2. Verify your **sender signature** (domain or single From address).
3. Use the server **API token** as `POSTMARK_SERVER_TOKEN`.
4. Set `POSTMARK_FROM_EMAIL` to a verified sender (e.g. `SignFlow <noreply@slit.edu.au>`).

HTML matches `docs/otp-email-template.json` (subject: `Your Skyline OTP is :{otp}`).

## Functions

| Function | RPC | Notes |
|----------|-----|--------|
| `skyline-request-otp` | `skyline_request_otp` / `skyline_request_student_otp` / `skyline_request_induction_otp` | By `type` or `x-skyline-otp-type` header |
| `skyline-request-induction-otp` | `skyline_request_induction_otp` only | Dedicated induction login |

Postmark sender logic lives **inside each function folder** (deployed together, not read from your PC at runtime):

- `supabase/functions/skyline-request-otp/postmarkOtp.ts`
- `supabase/functions/skyline-request-induction-otp/postmarkOtp.ts`

When you run `supabase functions deploy <name>`, the CLI uploads `index.ts` **and** `postmarkOtp.ts` as one bundle to Supabase cloud. The function then calls Postmark’s API over the internet — it does not read files from your local machine after deploy.

If you change `postmarkOtp.ts`, update both copies (or redeploy both functions).

## Enrolment submission email

Function: `skyline-send-enrolment-email` — sends application PDF + uploaded documents to the applicant; optional copy to agent when **Send a copy via email to the agent** is checked.

Uses the same Postmark secrets. Deploy:

```bash
supabase functions deploy skyline-send-enrolment-email
```
