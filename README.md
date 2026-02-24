# SignFlow - Training Evaluation Form

A React-based multi-page training evaluation form application with role-based privacy, signature capture, and PDF generation. Built to scale from 3 pages to 100-160 pages dynamically.

## Features

- **Form Builder Admin**: Create and edit forms with steps, sections, and questions. Drag-drop reordering with @dnd-kit.
- **Form Fill App**: Role-based form filling with stepper UI, autosave (300ms debounce), and PDF preview.
- **PDF Generation**: Server-side PDF via Node.js + Playwright (HTML → PDF). Skyline header layout, A4 pages.
- **Supabase Backend**: Postgres tables with BIGINT PKs. No RLS (per spec).
- **Question Types**: instruction_block, short_text, long_text, yes_no, single_choice, multi_choice, likert_5, grid_table, date, signature, page_break.
- **Role Visibility/Editability**: Per-question toggles for student/trainer/office.

## Tech Stack

- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS** (styling)
- **Supabase** (Postgres + Storage)
- **React Hook Form** + **Zod** (validation)
- **@dnd-kit** (drag-drop for builder)
- **Playwright** (PDF rendering in pdf-server)

## Getting Started

### Installation

```bash
npm install
```

### Environment Setup

1. Copy `env.example` to `.env` and fill in your Supabase credentials:
   - `VITE_SUPABASE_URL` - Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` - Supabase anon/public key
   - `SUPABASE_URL` - Same as above (for pdf-server)
   - `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for pdf-server only)
   - `VITE_PDF_API_URL` - Leave empty to use Vite proxy; or set to `http://localhost:3001` for direct PDF server

2. Run the Supabase migrations (in order):
   - In Supabase Dashboard: SQL Editor → run `supabase/migrations/20250211000000_create_form_tables.sql`
   - Then run `supabase/migrations/20250211000001_add_students.sql`

3. Seed the database:
```bash
npm run seed
```

### Development

**Terminal 1 - React app:**
```bash
npm run dev
```
The app will be available at `http://localhost:5173`

**Terminal 2 - PDF server (required for PDF preview/download):**
```bash
cd pdf-server
npm install
npx playwright install chromium
npm run dev
```
PDF server runs on `http://localhost:3001`. The Vite dev server proxies `/pdf/*` to it.

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Deployment

The app has two parts:
- **Frontend** (React/Vite) → Deploy to Vercel
- **PDF server** (Node + Playwright) → Deploy separately (Railway, Render, etc.)

### PDF logos

For crest/logo images in PDFs, add these to `public/` (project root) or `pdf-server/public/`:
- `logo-crest.png` or `logo.png` / `logo.jpeg` / `logo.jpg`
- `logo-text.png`

If missing, a minimal text fallback is used. The deploy copies from `public/` into `pdf-server/public/` when available.

### Deploy PDF Server (required for PDF preview/download in production)

#### Option A: Railway (free tier: $1/month credit + $5 trial)

1. Create a [Railway](https://railway.app/) account and connect your GitHub repo.
2. Add a **new service** → **Deploy from GitHub repo** → Select SignFlow.
3. Configure the service:
   - **Root Directory**: Leave empty (repo root)
   - **Build Command**: `cd pdf-server && npm install`
   - **Start Command**: `npm start`

   Or use Docker: set **Root Directory** to `pdf-server` and ensure **Dockerfile** is used.

4. Add environment variables in Railway → Variables:
   - `SUPABASE_URL` – Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` – Supabase service role key

5. Deploy. Railway will assign a URL like `https://signflow-pdf-production.up.railway.app`.

**Free tier note:** Railway’s free plan includes $1/month credit (plus $5 one-time trial). On the free tier, services can sleep after inactivity; pinging `GET /health` every 5–14 minutes (e.g. with [UptimeRobot](https://uptimerobot.com)) helps keep the PDF server awake. On the Hobby plan ($5/month) you can disable Serverless so the service stays on.

#### Option B: Render

1. Create a [Render](https://render.com/) account and connect your repo.
2. New → **Web Service** → Connect your SignFlow repo.
3. Configure (if Root Directory doesn't work, use repo root with custom commands):
   - **Root Directory**: Leave empty
   - **Build Command**: `cd pdf-server && npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node

   Or use Docker: set **Root Directory** to `pdf-server` and **Environment** to Docker.

4. Add environment variables:
   - `SUPABASE_URL` – Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` – Supabase service role key

5. Deploy. Render will assign a URL like `https://signflow-pdf.onrender.com`.

**Avoid slow “service waking up” on Render (free tier):**  
Free-tier web services spin down after ~15 minutes of inactivity. The first request after that can take 30–60+ seconds. To reduce this:

- **Health endpoint:** The PDF server exposes `GET /health`. Use a free uptime monitor (e.g. [UptimeRobot](https://uptimerobot.com)) to hit `https://your-pdf-service.onrender.com/health` every 5–14 minutes. That keeps the service from sleeping so PDF requests stay fast.
- **Paid tier:** On a paid Render plan, the instance stays on and does not spin down.

### Configure Frontend (Vercel)

1. In Vercel → Project → **Settings** → **Environment Variables**.
2. Add:
   - `VITE_PDF_API_URL` = `https://your-pdf-server-url` (the Railway or Render URL from above, **no trailing slash**)
3. Redeploy the frontend so it picks up the new variable.

## Project Structure

```
src/
├── components/
│   ├── form/              # Form UI components
│   │   ├── DetailsTable.tsx
│   │   ├── LikertMatrix.tsx
│   │   ├── TextareaSection.tsx
│   │   ├── CheckboxGroup.tsx
│   │   ├── SignatureBlock.tsx
│   │   └── FormSectionRenderer.tsx
│   └── pdf/               # PDF generation components
│       ├── PdfDetailsTable.tsx
│       ├── PdfLikertMatrix.tsx
│       ├── PdfTextarea.tsx
│       ├── PdfCheckboxGroup.tsx
│       ├── PdfSignatureBlock.tsx
│       ├── PdfSectionRenderer.tsx
│       └── PdfDocument.tsx
├── pages/
│   ├── FormView.tsx       # Main form view
│   └── FormPage.tsx       # Individual page component
├── store/
│   └── formStore.ts       # Zustand store
├── types/
│   ├── index.ts           # Core types
│   └── formDefinition.ts  # Form schema types
├── utils/
│   ├── roleUtils.ts       # Role-based visibility logic
│   └── pdfExport.ts       # PDF export utility
└── data/
    └── formDefinition.json # Form definition (schema)

```

## How It Works

### Form Definition Schema

The form is driven by a JSON schema (`src/data/formDefinition.json`) that defines:

- **Meta**: Organization info, title, version
- **Pages**: Array of pages, each containing sections
- **Sections**: Different section types (detailsTable, likertMatrix, textarea, checkboxGroup, signatureBlock)
- **Role Scope**: Each field/section has a `roleScope` that determines visibility:
  - `"student"`: Only visible to student and office
  - `"trainer"`: Only visible to trainer and office
  - `"both"`: Visible to all roles
  - `"office"`: Only visible to office role

### Role-based Privacy

- **Student Role**: Can see and edit student fields, cannot see trainer signature/date
- **Trainer Role**: Can see and edit trainer fields, cannot see student signature/date
- **Office Role**: Can view all fields but cannot edit (read-only mode)

Signatures are stored separately:
- `studentSignature`: { imageDataUrl, signedAtDate }
- `trainerSignature`: { imageDataUrl, signedAtDate }

### Adding New Pages/Questions

To add new pages or questions, simply edit `src/data/formDefinition.json`:

1. **Add a new page**:
```json
{
  "pageNumber": 4,
  "sections": [
    {
      "type": "likertMatrix",
      "title": "New Evaluation Section",
      "questions": [
        {
          "fieldId": "new.q1",
          "question": "Your question here",
          "roleScope": "student"
        }
      ],
      "scaleLabels": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"]
    }
  ]
}
```

2. **Add sections to existing page**: Add to the `sections` array of any page

3. **No code changes needed**: The form engine automatically renders new pages and sections

### PDF Generation

PDF generation uses `@react-pdf/renderer` which:

- Renders the same form structure as the UI
- Respects role-based privacy (hides signatures per role)
- Supports automatic pagination
- Scales efficiently to 100-160 pages (no screenshot conversion needed)

**Export Modes**:
- **Student mode**: Includes student signature only, hides trainer signature
- **Trainer mode**: Includes trainer signature only, hides student signature
- **Office mode**: Shows both signatures (if present) + all fields

### State Management

- **Zustand Store**: Manages form state, role, signatures, answers
- **localStorage Persistence**: Auto-saves drafts via Zustand persist middleware
- **Submit Locking**: Once submitted, role-specific fields are locked

## Usage

1. **Select Role**: Choose Student, Trainer, or Office from the dropdown
2. **Fill Form**: Complete the form fields relevant to your role
3. **Sign**: Use the signature canvas to capture your signature
4. **Save Draft**: Automatically saved to localStorage, or click "Save Draft"
5. **Submit**: Lock your section (prevents further edits)
6. **Export PDF**: Generate PDF based on current role view

## Scaling to 100-160 Pages

The architecture is designed to handle large forms:

1. **JSON-driven**: All form structure comes from JSON - no hardcoded components
2. **Component Reuse**: LikertMatrix, DetailsTable, etc. are reusable components
3. **Efficient PDF**: `@react-pdf/renderer` handles large documents efficiently
4. **Lazy Loading**: Can be extended with React.lazy for page-level code splitting
5. **Virtual Scrolling**: Can be added for UI if needed (PDF doesn't need it)

To scale:
- Add pages to `formDefinition.json`
- No code changes required
- PDF will automatically generate all pages
- UI will render all pages (consider pagination UI for 100+ pages)

## Future Enhancements

- [ ] Form validation with Zod schemas
- [ ] Server-side storage/API integration
- [ ] Multi-form support
- [ ] Advanced PDF customization (watermarks, headers/footers)
- [ ] Print preview mode
- [ ] Accessibility improvements (ARIA labels, keyboard navigation)
- [ ] Internationalization (i18n)

## License

MIT

