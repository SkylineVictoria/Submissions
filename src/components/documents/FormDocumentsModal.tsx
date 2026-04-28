import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, Upload, RefreshCw, Download } from 'lucide-react';
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
  /** When false, trainer/assessor folder is omitted (e.g. read-only student context). Default true. */
  showTrainerSection?: boolean;
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

export const FormDocumentsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  formId,
  formName,
  canUpload,
  showTrainerSection = true,
}) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [studentDocs, setStudentDocs] = useState<LearningDoc[]>([]);
  const [trainerDocs, setTrainerDocs] = useState<LearningDoc[]>([]);

  const title = useMemo(() => `Documents — ${formName}`, [formName]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const studentP = listLearningDocs({ formId, formName, audience: 'student' });
      const trainerP = showTrainerSection
        ? listLearningDocs({ formId, formName, audience: 'trainer' })
        : Promise.resolve([] as LearningDoc[]);
      const [s, t] = await Promise.all([studentP, trainerP]);
      setStudentDocs(s);
      setTrainerDocs(t);
    } catch (e) {
      console.error('FormDocumentsModal list error', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      setStudentDocs([]);
      setTrainerDocs([]);
    } finally {
      setLoading(false);
    }
  }, [formId, formName, showTrainerSection]);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  const onPickFile = async (file: File | null, audience: 'student' | 'trainer') => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadLearningDoc({ formId, formName, file, upsert: true, audience });
      toast.success('Uploaded');
      await load();
    } catch (e) {
      console.error('FormDocumentsModal upload error', e);
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const renderRows = (docs: LearningDoc[]) =>
    docs.map((d) => {
      const href = getLearningDocPublicUrl(d.path);
      return (
        <div
          key={d.path}
          className="flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-[var(--brand)]/10 transition-colors"
        >
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
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-colors shrink-0"
            title="Download"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>
      );
    });

  const totalCount = studentDocs.length + (showTrainerSection ? trainerDocs.length : 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm text-gray-700">
            <span className="font-medium">{totalCount}</span>
            <span className="text-gray-500">document{totalCount === 1 ? '' : 's'}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || uploading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-8">
            <Loader variant="dots" size="lg" message="Loading documents..." />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <BookOpen className="h-4 w-4 text-gray-500" />
                  Student learning ({studentDocs.length})
                </div>
                {canUpload ? (
                  <label className="inline-flex cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => void onPickFile(e.target.files?.[0] ?? null, 'student')}
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
              {studentDocs.length === 0 ? (
                <div className="rounded-lg border border-[var(--border)] bg-gray-50 p-4 text-sm text-gray-600">
                  No student learning documents yet.
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                  {renderRows(studentDocs)}
                </div>
              )}
            </div>

            {showTrainerSection ? (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    <GraduationCap className="h-4 w-4 text-gray-500" />
                    Trainer / assessor ({trainerDocs.length})
                  </div>
                  {canUpload ? (
                    <label className="inline-flex cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => void onPickFile(e.target.files?.[0] ?? null, 'trainer')}
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
                <p className="text-xs text-amber-800 mb-2">Not shown to students.</p>
                {trainerDocs.length === 0 ? (
                  <div className="rounded-lg border border-[var(--border)] bg-gray-50 p-4 text-sm text-gray-600">
                    No trainer documents yet.
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                    {renderRows(trainerDocs)}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {!canUpload ? (
          <div className="text-xs text-gray-500">If you need to add documents, contact an administrator.</div>
        ) : null}
      </div>
    </Modal>
  );
};
