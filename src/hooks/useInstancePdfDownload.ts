import { useCallback, useRef, useState } from 'react';
import {
  LIVE_PDF_GENERATE_CONFIRM_MESSAGE,
  requestInstancePdfDownload,
  type InstancePdfDownloadOutcome,
} from '../lib/generatedPdfs';
import { toast } from '../utils/toast';

export type LivePdfGenerateDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'default';
};

export function useInstancePdfDownload(defaultRole = 'office') {
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const promptLiveGenerate = useCallback((): Promise<boolean> => {
    setLiveConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const closeLiveConfirm = useCallback((approved: boolean) => {
    setLiveConfirmOpen(false);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(approved);
  }, []);

  const downloadInstancePdf = useCallback(
    async (instanceId: number, role = defaultRole): Promise<InstancePdfDownloadOutcome> => {
      setDownloadingId(instanceId);
      try {
        const result = await requestInstancePdfDownload(instanceId, role, {
          confirmLiveGenerate: promptLiveGenerate,
        });
        if (result.outcome === 'unavailable' && result.message) {
          toast.error(result.message);
        }
        return result.outcome;
      } finally {
        setDownloadingId(null);
      }
    },
    [defaultRole, promptLiveGenerate],
  );

  const liveGenerateDialogProps: LivePdfGenerateDialogProps = {
    isOpen: liveConfirmOpen,
    onClose: () => closeLiveConfirm(false),
    onConfirm: () => closeLiveConfirm(true),
    title: 'Generate PDF now?',
    message: LIVE_PDF_GENERATE_CONFIRM_MESSAGE,
    confirmLabel: 'Generate and download',
    cancelLabel: 'Not now',
    variant: 'default',
  };

  return { downloadingId, downloadInstancePdf, liveGenerateDialogProps };
}
