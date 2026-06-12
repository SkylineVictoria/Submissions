import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright';
import { runPdfJob, preparePageForPrint, createPdfJobId, type PdfJobMeta } from './pdfBrowser.js';
import { DEFAULT_PAGE_PDF_OPTIONS, finalizePdfHtml, PDF_PAGE_LOAD_TIMEOUT_MS } from './pdfConstants.js';
import { logMemory } from './pdfMemory.js';

type PdfMargins = {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
};

async function loadPageAndPdf(
  page: Page,
  jobId: string,
  html: string,
  options: {
    margin?: PdfMargins;
    displayHeaderFooter?: boolean;
    headerTemplate?: string;
    footerTemplate?: string;
    preferCSSPageSize?: boolean;
  }
): Promise<Uint8Array> {
  const readyHtml = finalizePdfHtml(html);
  logMemory(`${jobId} before-setContent`);
  await page.setContent(readyHtml, {
    waitUntil: 'load',
    timeout: PDF_PAGE_LOAD_TIMEOUT_MS,
  });
  logMemory(`${jobId} after-setContent`);
  await preparePageForPrint(page);
  logMemory(`${jobId} before-page-pdf`);
  const pdf = await page.pdf({
    ...DEFAULT_PAGE_PDF_OPTIONS,
    preferCSSPageSize: options.preferCSSPageSize ?? true,
    margin: options.margin ?? { top: '12mm', right: '15mm', bottom: '12mm', left: '15mm' },
    displayHeaderFooter: options.displayHeaderFooter ?? false,
    headerTemplate: options.headerTemplate,
    footerTemplate: options.footerTemplate,
  });
  logMemory(`${jobId} after-page-pdf`);
  return pdf;
}

export async function renderHtmlToPdfBuffer(
  meta: PdfJobMeta,
  html: string,
  options: {
    margin?: PdfMargins;
    displayHeaderFooter?: boolean;
    preferCSSPageSize?: boolean;
  } = {}
): Promise<Uint8Array> {
  return runPdfJob(meta, (page) =>
    loadPageAndPdf(page, meta.jobId, html, {
      margin: options.margin,
      displayHeaderFooter: options.displayHeaderFooter ?? false,
      preferCSSPageSize: options.preferCSSPageSize,
    })
  );
}

export async function renderCoverAndRestPdf(
  meta: PdfJobMeta,
  coverHtml: string,
  restHtml: string,
  headerHtml: string,
  footerHtml: string
): Promise<{ coverPdf: Uint8Array; restPdf: Uint8Array }> {
  return runPdfJob(meta, async (page) => {
    const coverPdf = await loadPageAndPdf(page, `${meta.jobId}-cover`, coverHtml, {
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
    const restPdf = await loadPageAndPdf(page, `${meta.jobId}-rest`, restHtml, {
      margin: { top: '190px', right: '15mm', bottom: '70px', left: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      preferCSSPageSize: true,
    });
    return { coverPdf, restPdf };
  });
}

/** Merge cover + body PDFs; does not retain intermediate buffers after return. */
export async function mergeCoverRestPdf(coverPdf: Uint8Array, restPdf: Uint8Array): Promise<Buffer> {
  logMemory('before-pdf-merge');
  const mergedPdf = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(coverPdf);
  const [coverPage] = await mergedPdf.copyPages(coverDoc, [0]);
  mergedPdf.addPage(coverPage);

  const restDoc = await PDFDocument.load(restPdf);
  const restPageCount = restDoc.getPageCount();
  for (let i = 0; i < restPageCount; i++) {
    const [p] = await mergedPdf.copyPages(restDoc, [i]);
    mergedPdf.addPage(p);
  }

  const out = Buffer.from(await mergedPdf.save());
  logMemory('after-pdf-merge');
  return out;
}

export function pdfJobForInstance(instanceId: number, kind: 'instance' | 'preview' | 'induction' = 'instance'): PdfJobMeta {
  return {
    jobId: createPdfJobId(kind),
    label: kind === 'preview' ? `form-preview-${instanceId}` : kind === 'induction' ? `induction-${instanceId}` : `instance-${instanceId}`,
  };
}
