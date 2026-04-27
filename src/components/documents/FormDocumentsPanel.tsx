import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Upload, RefreshCw, Download, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { toast } from '../../utils/toast';
import { deleteLearningDoc, getLearningDocPublicUrl, listLearningDocs, uploadLearningDoc, type LearningDoc } from '../../lib/formDocuments';

type Props = {
  formId: number;
  formName: string;
  canUpload: boolean;
  canDelete?: boolean;
  /** When false, do not auto-load on mount (caller will invoke refresh) */
  autoLoad?: boolean;
};

const formatBytes = (n: number | null): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const FormDocumentsPanel: React.FC<Props> = ({ formId, formName, canUpload, canDelete = false, autoLoad = true }) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<LearningDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LearningDoc | null>(null);

  const title = useMemo(() => `Documents`, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listLearningDocs({ formId, formName });
      setDocs(items);
    } catch (e) {
      console.error('FormDocumentsPanel list error', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [formId, formName]);

  useEffect(() => {
    if (!autoLoad) return;
    void load();
  }, [autoLoad, load]);

  const onPickFiles = async (list: File[]) => {
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        // Sequential to keep UI simple and avoid rate limits.
        await uploadLearningDoc({ formId, formName, file, upsert: true });
      }
      toast.success(`Uploaded ${list.length} file${list.length === 1 ? '' : 's'}`);
      await load();
    } catch (e) {
      console.error('FormDocumentsPanel upload error', e);
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm text-gray-700">
          <Paperclip className="h-4 w-4 text-gray-500" />
          <span className="font-semibold text-[var(--text)]">{title}</span>
          <span className="text-gray-500">({docs.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || uploading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {canUpload ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
                  // Allow selecting the same file again later (and avoid invalidating FileList before copy).
                  e.currentTarget.value = '';
                  void onPickFiles(files);
                }}
                disabled={uploading}
              />
              <Button
                type="button"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader variant="dots" size="sm" inline className="mr-2" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Upload
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="py-6">
          <Loader variant="dots" size="lg" message="Loading documents..." />
        </div>
      ) : docs.length === 0 ? (
        <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No documents yet.
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-[var(--border)] overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {docs.map((d) => {
              const href = getLearningDocPublicUrl(d.path);
              return (
                <div key={d.path} className="flex items-center justify-between gap-3 px-3 py-2 bg-white hover:bg-[var(--brand)]/10 transition-colors">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text)] break-words">{d.name}</div>
                    <div className="text-xs text-gray-500">
                      <span>{formatBytes(d.size)}</span>
                      {d.updatedAt ? <span className="ml-2">Updated {new Date(d.updatedAt).toLocaleString()}</span> : null}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-colors"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                    {canDelete ? (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete"
                        disabled={uploading || loading}
                        onClick={async () => {
                          setDeleteTarget(d);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!canUpload ? (
        <div className="mt-2 text-xs text-gray-500">Uploads are managed by administrators.</div>
      ) : null}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete document"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : 'Delete this document?'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          const target = deleteTarget;
          if (!target) return;
          void (async () => {
            try {
              setUploading(true);
              await deleteLearningDoc(target.path);
              toast.success('Deleted');
              await load();
            } catch (e) {
              console.error('FormDocumentsPanel delete error', e);
              toast.error(e instanceof Error ? e.message : 'Delete failed');
            } finally {
              setUploading(false);
            }
          })();
        }}
      />
    </div>
  );
};

