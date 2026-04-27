import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Paperclip, Upload, RefreshCw, Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import { getLearningDocPublicUrl, listLearningDocs, uploadLearningDoc, type LearningDoc } from '../../lib/formDocuments';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  formId: number;
  formName: string;
  canUpload: boolean;
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

export const FormDocumentsModal: React.FC<Props> = ({ isOpen, onClose, formId, formName, canUpload }) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<LearningDoc[]>([]);

  const title = useMemo(() => `Documents — ${formName}`, [formName]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listLearningDocs({ formId, formName });
      setDocs(items);
    } catch (e) {
      console.error('FormDocumentsModal list error', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [formId, formName]);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadLearningDoc({ formId, formName, file, upsert: true });
      toast.success('Uploaded');
      await load();
    } catch (e) {
      console.error('FormDocumentsModal upload error', e);
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm text-gray-700">
            <Paperclip className="h-4 w-4 text-gray-500" />
            <span className="font-medium">{docs.length}</span>
            <span className="text-gray-500">document{docs.length === 1 ? '' : 's'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || uploading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {canUpload ? (
              <label className="inline-flex">
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
                <span>
                  <Button type="button" size="sm" disabled={uploading}>
                    {uploading ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Upload className="mr-2 h-4 w-4" />}
                    Upload
                  </Button>
                </span>
              </label>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="py-8">
            <Loader variant="dots" size="lg" message="Loading documents..." />
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-gray-50 p-4 text-sm text-gray-600">
            No documents uploaded for this assessment yet.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="divide-y divide-[var(--border)]">
              {docs.map((d) => {
                const href = getLearningDocPublicUrl(d.path);
                return (
                  <div key={d.path} className="flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-[var(--brand)]/10 transition-colors">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text)] break-words">{d.name}</div>
                      <div className="text-xs text-gray-500">
                        <span>{formatBytes(d.size)}</span>
                        {d.updatedAt ? <span className="ml-2">Updated {new Date(d.updatedAt).toLocaleString()}</span> : null}
                      </div>
                    </div>
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
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!canUpload ? (
          <div className="text-xs text-gray-500">
            If you need to add documents, contact an administrator.
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

