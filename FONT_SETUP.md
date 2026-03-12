# Custom Font Setup for PDF Generation

## Overview

The PDF generation now uses custom fonts to match the exact styling from the reference image:
- **Montserrat-Bold** for "SKYLINE" (main title)
- **Montserrat-Regular** for "INSTITUTE OF TECHNOLOGY" (subtitle)
- **Inter-Regular** for address block and all body text

## Setup Instructions

### Step 1: Download Font Files

Download the following font files from Google Fonts:

1. **Montserrat** (Regular & Bold):
   - Visit: https://fonts.google.com/specimen/Montserrat
   - Download the font family
   - Extract `Montserrat-Regular.ttf` and `Montserrat-Bold.ttf`

2. **Inter** (Regular):
   - Visit: https://fonts.google.com/specimen/Inter
   - Download the font family
   - Extract `Inter-Regular.ttf`

### Step 2: Place Font Files

Place the font files in the following directory:

```
public/assets/fonts/
├── Montserrat-Regular.ttf
├── Montserrat-Bold.ttf
└── Inter-Regular.ttf
```

### Step 3: Verify Font Registration

The fonts are automatically registered when the PDF component loads via `src/utils/fontLoader.ts`. The registration happens in `src/components/pdf/PdfDocument.tsx`.

## Font Usage in PDF

### Header Styling

**SKYLINE** (Main Title):
- Font: Montserrat (Bold)
- Size: 34pt
- Color: #f97316 (Orange)
- Letter Spacing: 2

**INSTITUTE OF TECHNOLOGY** (Subtitle):
- Font: Montserrat (Regular)
- Size: 11pt
- Color: #374151 (Dark Grey)
- Letter Spacing: 3

**Address Block**:
- Font: Inter (Regular)
- Size: 9pt
- Color: #374151 (Dark Grey)

### Body Text (Client-side react-pdf)

All other text in the client-side PDF (tables, form fields, etc.) uses Inter (Regular) at 10pt.

### Server-side PDF (Instance Fill / pdf-server)

The server-generated PDFs (form fill, view/download) use:
- Font: Calibri
- Normal text: 12pt
- Headings (h2, h3, section headers, task headers, etc.): 16pt
- Fallback: Arial, Helvetica, sans-serif

## Fallback Behavior

If the font files are not found, the system will automatically fall back to Helvetica. You'll see a console warning if fonts fail to load.

## Testing

After placing the font files:

1. Start the development server: `npm run dev`
2. Fill out the form
3. Click "Export PDF"
4. Verify that the header matches the reference image styling

## Troubleshooting

**Fonts not loading?**
- Verify files are in `public/assets/fonts/` (not `src/assets/fonts/`)
- Check file names match exactly (case-sensitive)
- Check browser console for font loading errors
- Ensure fonts are TTF format (not OTF or WOFF)

**Fonts look different?**
- Clear browser cache
- Restart development server
- Verify font files are not corrupted

