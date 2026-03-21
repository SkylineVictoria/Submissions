# Power Automate OTP Flow

**Flow:** The app calls a Supabase Edge Function (`skyline-request-otp`). The Edge Function creates the OTP in the database and calls Power Automate server-side, so the OTP is **never sent to the client** and does not appear in the browser network tab.

## Flow order

1. **App:** Calls Edge Function `POST /functions/v1/skyline-request-otp` with body `{ "email": "...", "type": "staff" | "student" }`.
2. **Edge Function:** Calls Supabase RPC (`skyline_request_otp` or `skyline_request_student_otp`) to create OTP.
3. **Edge Function:** If success, calls Power Automate with `{ email, otp }` (server-side only).
4. **Power Automate:** Sends email with OTP, returns `{ "success": true }`.
5. **Edge Function:** Returns `{ "success": true, "message": "..." }` to the app (no OTP in response).
6. **App:** Allows user to enter the OTP they received by email.

## Edge Function secret

Set the Power Automate HTTP trigger URL as a Supabase secret so the Edge Function can call it. The Edge Function checks both variable names:

```bash
supabase secrets set SKYLINE_POWER_AUTOMATE_OTP_URL="https://your-power-automate-trigger-url"
# or
supabase secrets set POWER_AUTOMATE_OTP_URL="https://your-power-automate-trigger-url"
```

You can remove `VITE_POWER_AUTOMATE_OTP_URL` from the frontend `.env`; it is no longer used.

## Power Automate flow

1. **HTTP trigger** – receives `POST` body `{ "email": "user@example.com", "otp": "123456" }`
2. **Send email** – use `triggerBody()?['email']` as To, and `triggerBody()?['otp']` in the HTML body
3. **Response** – return `{ "success": true, "message": "OTP sent." }` (status 200)

## Request Body JSON Schema (HTTP trigger)

```json
{
  "type": "object",
  "properties": {
    "email": { "type": "string" },
    "otp": { "type": "string" }
  },
  "required": ["email", "otp"]
}
```

Sample: `{ "email": "string", "otp": "string" }`

---

## OTP Email template (Skyline theme, inline CSS)

Use the JSON in `docs/otp-email-template.json` for the **Send an email (V2)** action. The template uses Skyline brand colors: `#F47A1F`, `#ea580c`, `#F8FAFC`, `#0F172A`.

### Copy from `docs/otp-email-template.json`

| Field | Use in Power Automate |
|-------|------------------------|
| **To** | `triggerBody()?['email']` |
| **Subject** | `concat('Your SignFlow login code: ', triggerBody()?['otp'])` |
| **Body** | Use Compose to replace `{{OTP}}` with `triggerBody()?['otp']` |

### Power Automate flow steps

1. **Compose** (Name: `HtmlTemplate`)  
   - Paste the full HTML from `docs/otp-email-body.html` (copy entire file; keep `{{OTP}}` as-is).

2. **Compose** (Name: `EmailBody`)  
   - `replace(outputs('HtmlTemplate'), '{{OTP}}', string(triggerBody()?['otp']))`

3. **Send an email (V2)** (Is HTML: **Yes**)
   - **To:** `triggerBody()?['email']`
   - **Subject:** `concat('Your SignFlow login code: ', triggerBody()?['otp'])`
   - **Body:** `outputs('EmailBody')`

4. **Response** – return `{ "success": true, "message": "OTP sent." }`
