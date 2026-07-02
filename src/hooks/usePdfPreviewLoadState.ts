import { useCallback, useEffect, useState } from 'react';

/** Hide the blocking overlay even if iframe onLoad never fires (common for PDF embeds). */
const PDF_PREVIEW_SOFT_TIMEOUT_MS = 15_000;
const PDF_PREVIEW_HARD_TIMEOUT_MS = 120_000;

/**
 * Tracks PDF iframe preview loading. iframe `onLoad` is unreliable for cross-origin PDF
 * viewers, so we clear the overlay after a short soft timeout and show a warning on hard timeout.
 */
export function usePdfPreviewLoadState(active: boolean, resetKey: string | number) {
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      setTimedOut(false);
      return;
    }
    setLoading(true);
    setTimedOut(false);
    const softTimer = window.setTimeout(() => setLoading(false), PDF_PREVIEW_SOFT_TIMEOUT_MS);
    const hardTimer = window.setTimeout(() => {
      setLoading(false);
      setTimedOut(true);
    }, PDF_PREVIEW_HARD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(softTimer);
      window.clearTimeout(hardTimer);
    };
  }, [active, resetKey]);

  const onLoad = useCallback(() => {
    setLoading(false);
    setTimedOut(false);
  }, []);

  const onError = useCallback(() => {
    setLoading(false);
  }, []);

  const restart = useCallback(() => {
    setLoading(true);
    setTimedOut(false);
  }, []);

  return { loading, timedOut, onLoad, onError, restart };
}
