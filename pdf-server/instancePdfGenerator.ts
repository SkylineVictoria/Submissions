import type { SupabaseClient } from '@supabase/supabase-js';
import { getPdfData } from './htmlGenerator.js';
import { mergeCoverRestPdf, pdfJobForInstance, renderCoverAndRestPdf } from './pdfRender.js';
import { splitCoverAndRestHtml } from './splitCoverHtml.js';
import { logMemory } from './pdfMemory.js';

export const PDF_GENERATION_TIMEOUT_MS = 120_000;

export class PdfGenerationTimeoutError extends Error {
  constructor(instanceId: number) {
    super(`PDF generation timed out after ${PDF_GENERATION_TIMEOUT_MS}ms for instance ${instanceId}`);
    this.name = 'PdfGenerationTimeoutError';
  }
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export type InstancePdfGenerationResult = {
  buffer: Buffer;
  unitCode: string;
  fileName: string;
};

/**
 * Generate an assessment instance PDF in-process (no HTTP self-call).
 * Reuses htmlGenerator.getPdfData + Playwright render pipeline from pdfRender.
 */
export async function generateInstancePdfBuffer(
  supabase: SupabaseClient,
  instanceId: number,
  role: 'student' | 'trainer' | 'office' = 'office',
): Promise<InstancePdfGenerationResult> {
  const job = pdfJobForInstance(instanceId, 'instance');
  logMemory(`${job.jobId} worker-generate-start role=${role}`);

  const work = async (): Promise<InstancePdfGenerationResult> => {
    const pdfData = await getPdfData(supabase, instanceId);
    if (!pdfData) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const { html, unitCode, version, headerHtml, fileName } = pdfData;
    const footerHtml = `
      <div style="font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; font-size: 11pt; color: #000000; width: 100%; height: 50px; display: flex; justify-content: space-between; align-items: center; padding: 0 15mm; box-sizing: border-box; page-break-inside: avoid; background: transparent; border-bottom: 1px solid #d1d5db; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
        <span>Version Number: ${version}</span>
        <span>Unit Code: ${unitCode || ''}</span>
        <span>Page <strong><span class="pageNumber"></span></strong> of <strong><span class="totalPages"></span></strong></span>
      </div>
    `;

    const { coverHtml, restHtml } = splitCoverAndRestHtml(html);
    const { coverPdf, restPdf } = await renderCoverAndRestPdf(job, coverHtml, restHtml, headerHtml, footerHtml);
    const pdf = await mergeCoverRestPdf(coverPdf, restPdf);

    if (!pdf?.length) {
      throw new Error(`Empty PDF buffer for instance ${instanceId}`);
    }
    if (!isPdfBuffer(pdf)) {
      throw new Error(`Invalid PDF buffer for instance ${instanceId} (missing %PDF- header)`);
    }

    logMemory(`${job.jobId} worker-generate-done bytes=${pdf.length}`);
    return { buffer: pdf, unitCode, fileName };
  };

  try {
    return await withTimeout(work(), PDF_GENERATION_TIMEOUT_MS, () => new PdfGenerationTimeoutError(instanceId));
  } finally {
    logMemory(`${job.jobId} worker-generate-finally`);
  }
}
