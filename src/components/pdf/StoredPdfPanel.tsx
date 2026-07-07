import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { LivePdfGenerateConfirmDialog } from './LivePdfGenerateConfirmDialog';
import {
  buildLiveInstancePdfDownloadUrl,
  buildLiveInstancePdfPreviewUrl,
  fetchGeneratedPdf,
  getStoredPdfPreviewUrl,
  isInstanceCompletedForPdfQueue,
  LIVE_PDF_GENERATE_CONFIRM_MESSAGE,
  queueGeneratedPdf,
  recordGeneratedPdfDownload,
  requestRegeneratePdf,
  retryFailedGeneratedPdf,
  type GeneratedPdfRecord,
} from '../../lib/generatedPdfs';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

type Props = {
  instanceId: number;
  role: string;
  workflowStatus: string;
  legacyStatus?: string | null;
  /** Show dev/admin fallback to live Render PDF generation. */
  showLiveFallback?: boolean;
  className?: string;
};

/**
 * Stored PDF panel — SharePoint for download; embedded preview via pdf-server iframe.
 * Does NOT auto-load Render on page mount (iframe only when panel is shown and VITE_PDF_API_URL is set).
 */
export const StoredPdfPanel: React.FC<Props> = ({
  instanceId,
  role,
  workflowStatus,
  legacyStatus,
  showLiveFallback = false,
  className,
}) => {
  const [row, setRow] = useState<GeneratedPdfRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [liveGenerateOpen, setLiveGenerateOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);

  const load = useCallback(async (options?: { refreshPreview?: boolean }) => {
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let record = await fetchGeneratedPdf(instanceId, role);
    const completed = isInstanceCompletedForPdfQueue(workflowStatus, legacyStatus);
    if (!record && completed) {
      record = await queueGeneratedPdf(instanceId, role);
    }
    setRow(record);
    setLoading(false);
    if (options?.refreshPreview && buildLiveInstancePdfPreviewUrl(instanceId, role)) {
      setPreviewRefresh((r) => r + 1);
    }
  }, [instanceId, role, workflowStatus, legacyStatus]);

  const sharePointUrl = useMemo(() => getStoredPdfPreviewUrl(row), [row]);
  const embeddedPreviewUrl = useMemo(() => {
    const base = buildLiveInstancePdfPreviewUrl(instanceId, role);
    if (!base) return null;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}refresh=${previewRefresh}`;
  }, [instanceId, role, previewRefresh]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (embeddedPreviewUrl) {
      setPreviewLoading(true);
    } else {
      setPreviewLoading(false);
    }
  }, [embeddedPreviewUrl]);

  useEffect(() => {
    if (!previewLoading) return;
    const timer = window.setTimeout(() => setPreviewLoading(false), 130_000);
    return () => window.clearTimeout(timer);
  }, [previewLoading, embeddedPreviewUrl]);

  const canLiveGenerate = Boolean(PDF_BASE && buildLiveInstancePdfDownloadUrl(instanceId, role));
  const livePdfUrl = embeddedPreviewUrl ?? '';
  const liveDownloadUrl = buildLiveInstancePdfDownloadUrl(instanceId, role) ?? '';

  const handleOpenStored = async (download = false) => {
    if (!sharePointUrl || !row) return;
    if (download) await recordGeneratedPdfDownload(row.id);
    window.open(sharePointUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenPdfServerPreview = () => {
    if (!embeddedPreviewUrl) return;
    window.open(embeddedPreviewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async () => {
    if (sharePointUrl) {
      await handleOpenStored(true);
      return;
    }
    if (!canLiveGenerate) return;
    setLiveGenerateOpen(true);
  };

  const handleConfirmLiveGenerate = () => {
    setLiveGenerateOpen(false);
    if (liveDownloadUrl) {
      window.open(liveDownloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleRegenerate = async () => {
    setActionLoading(true);
    const next = await requestRegeneratePdf(instanceId, role);
    setRow(next);
    setActionLoading(false);
  };

  const handleRetry = async () => {
    setActionLoading(true);
    const next = await retryFailedGeneratedPdf(instanceId, role);
    setRow(next);
    setActionLoading(false);
  };

  const statusMessage = (() => {
    if (loading) return null;
    if (!row) {
      if (isInstanceCompletedForPdfQueue(workflowStatus, legacyStatus)) {
        return canLiveGenerate
          ? 'PDF is queued for SharePoint. You can generate and download now if needed.'
          : 'PDF is queued for generation.';
      }
      return 'PDF will be queued after this assessment is completed.';
    }
    if (sharePointUrl) {
      return 'PDF ready (stored in SharePoint). Preview uses the PDF server; download opens SharePoint.';
    }
    switch (row.pdf_status) {
      case 'pending':
      case 'stale':
        return canLiveGenerate
          ? 'PDF is queued for SharePoint. You can generate and download now if needed.'
          : 'PDF is queued for generation.';
      case 'generating':
        return 'PDF is being generated. Please refresh shortly.';
      case 'failed':
        return canLiveGenerate
          ? 'PDF generation failed. You can try generating a live PDF now.'
          : 'PDF generation failed.';
      case 'uploaded':
        return 'PDF marked uploaded but URL is missing.';
      default:
        return null;
    }
  })();

  return (
    <Card className={className}>
      <h3 className="font-bold text-[var(--text)] mb-4">PDF Preview</h3>
      {loading ? (
        <Loader variant="dots" size="md" message="Loading PDF status…" />
      ) : (
        <div className="space-y-3">
          {statusMessage ? <p className="text-sm text-gray-600">{statusMessage}</p> : null}
          {row?.pdf_status === 'failed' && row.last_error && showLiveFallback ? (
            <p className="text-xs text-red-700 break-words">{row.last_error}</p>
          ) : null}

          <div className="space-y-2">
            {sharePointUrl ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleOpenPdfServerPreview}
                  disabled={!embeddedPreviewUrl}
                >
                  Preview PDF
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => void handleOpenStored(true)}>
                  Download PDF (SharePoint)
                </Button>
              </>
            ) : canLiveGenerate ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void handleDownload()}
                disabled={actionLoading}
              >
                Generate and download PDF now
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void load({ refreshPreview: true })}
              disabled={actionLoading}
            >
              Refresh status
            </Button>

            {row && (row.pdf_status === 'uploaded' || row.sharepoint_web_url) ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void handleRegenerate()}
                disabled={actionLoading}
              >
                Regenerate PDF
              </Button>
            ) : null}

            {row?.pdf_status === 'failed' ? (
              <Button variant="outline" size="sm" className="w-full" onClick={() => void handleRetry()} disabled={actionLoading}>
                Retry PDF Generation
              </Button>
            ) : null}

            {showLiveFallback && PDF_BASE ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-amber-800"
                  onClick={() => window.open(livePdfUrl, '_blank', 'width=900,height=700')}
                >
                  Generate live PDF (debug)
                </Button>
                <a href={liveDownloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="ghost" size="sm" className="w-full text-amber-800">
                    Download live PDF (debug)
                  </Button>
                </a>
              </>
            ) : null}
          </div>

          {embeddedPreviewUrl ? (
            <div className="mt-4 relative min-h-96 bg-gray-50 border border-[var(--border)] rounded-lg overflow-hidden">
              {previewLoading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50/95">
                  <Loader variant="dots" size="md" message="Generating PDF preview…" />
                </div>
              ) : null}
              <iframe
                key={embeddedPreviewUrl}
                src={embeddedPreviewUrl}
                title="PDF Preview"
                className="w-full h-64 sm:h-80 lg:h-96 min-h-[16rem] border-0 rounded-lg"
                onLoad={() => setPreviewLoading(false)}
              />
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              {canLiveGenerate
                ? 'No stored PDF in SharePoint yet. Use “Generate and download PDF now” or refresh after background generation completes.'
                : 'No stored PDF yet. Background generation runs during off-hours — refresh later.'}
            </div>
          )}
        </div>
      )}

      <LivePdfGenerateConfirmDialog
        isOpen={liveGenerateOpen}
        onClose={() => setLiveGenerateOpen(false)}
        onConfirm={handleConfirmLiveGenerate}
        title="Generate PDF now?"
        message={LIVE_PDF_GENERATE_CONFIRM_MESSAGE}
        confirmLabel="Generate and download"
        cancelLabel="Not now"
        variant="default"
      />
    </Card>
  );
};
