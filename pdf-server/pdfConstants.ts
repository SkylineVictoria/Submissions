/** Max induction/assessment PDFs per bulk client export (enforced on server batch route + frontend). */
export const MAX_BULK_PDF_EXPORT = 25;

/** Restart shared Chromium after this many completed PDF jobs to release memory. */
export const BROWSER_RESTART_AFTER_JOBS = 4;

export const PDF_PAGE_LOAD_TIMEOUT_MS = 60_000;
export const PDF_RENDER_TIMEOUT_MS = 60_000;

export const PDF_PRINT_CSS = `
    /* pdf-print */
    img {
      max-width: 100%;
      height: auto;
      object-fit: contain;
    }
    .signature-img {
      max-width: 150px;
      max-height: 60px;
      object-fit: contain;
    }
    @media print {
      * {
        animation: none !important;
        transition: none !important;
      }
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
`;

export const DEFAULT_PAGE_PDF_OPTIONS = {
  format: 'A4' as const,
  printBackground: true,
  preferCSSPageSize: true,
  timeout: PDF_RENDER_TIMEOUT_MS,
};

/** Warn when inline images bloat HTML (signatures/photos as base64). */
export function pdfImageSrc(url: string, context: string): string {
  const u = String(url || '').trim();
  if (u.startsWith('data:') && u.length > 400_000) {
    console.warn(
      `[PDF] large base64 image (~${Math.round(u.length / 1024)}KB) in ${context} — prefer storage URLs`
    );
  }
  return u;
}

/** Inject print CSS and #pdf-ready marker for Playwright (never use networkidle). */
export function finalizePdfHtml(html: string): string {
  let out = html;
  if (!out.includes('id="pdf-ready"')) {
    out = out.replace(/<\/body>/i, '<div id="pdf-ready" aria-hidden="true"></div>\n</body>');
  }
  if (!out.includes('/* pdf-print */')) {
    const inject = `\n${PDF_PRINT_CSS}\n`;
    if (/<\/style>/i.test(out)) {
      out = out.replace(/<\/style>/i, `${inject}  </style>`);
    } else if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head[^>]*>/i, (m) => `${m}\n  <style>${PDF_PRINT_CSS}</style>`);
    }
  }
  return out;
}
