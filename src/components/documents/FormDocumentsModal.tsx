import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, Upload, RefreshCw, Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import { listLearningDocs, uploadLearningDoc, zipAndDownloadLearningDocs, type LearningDoc } from '../../lib/formDocuments';
import { LearningDocRows } from './LearningDocRows';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  formId: number;
  formName: string;
  canUpload: boolean;
  /** When false, trainer/assessor folder is omitted (e.g. read-only student context). Default true. */
  showTrainerSection?: boolean;
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
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [zipping, setZipping] = useState(false);

  const title = useMemo(() => `Documents — ${formName}`, [formName]);

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const bulkSelectDocs = useCallback((docs: LearningDoc[], select: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const d of docs) {
        if (select) next.add(d.path);
        else next.delete(d.path);
      }
      return next;
    });
  }, []);

  const downloadZipForDocs = useCallback(
    async (pickFrom: LearningDoc[]) => {
      const picked = pickFrom.filter((d) => selectedPaths.has(d.path));
      if (picked.length === 0) return;
      setZipping(true);
      try {
        await zipAndDownloadLearningDocs(picked, formName?.trim() ? formName : `form-${formId}`);
        toast.success(`Prepared zip with ${picked.length} file${picked.length === 1 ? '' : 's'}`);
      } catch (e) {
        console.error('FormDocumentsModal zip download error', e);
        toast.error(e instanceof Error ? e.message : 'Zip download failed');
      } finally {
        setZipping(false);
      }
    },
    [selectedPaths, formName, formId]
  );

  const handleDownloadSelectedZip = useCallback(() => {
    const all = [...studentDocs, ...(showTrainerSection ? trainerDocs : [])];
    void downloadZipForDocs(all);
  }, [studentDocs, trainerDocs, showTrainerSection, downloadZipForDocs]);

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
      setSelectedPaths(new Set());
    } catch (e) {
      console.error('FormDocumentsModal list error', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      setStudentDocs([]);
      setTrainerDocs([]);
      setSelectedPaths(new Set());
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

  const totalCount = studentDocs.length + (showTrainerSection ? trainerDocs.length : 0);

  const noopDelete = () => {};

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm text-gray-700">
            <span className="font-medium">{totalCount}</span>
            <span className="text-gray-500">document{totalCount === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedPaths.size > 0 ? (
              <>
                <span className="text-xs text-gray-600 whitespace-nowrap">{selectedPaths.size} selected</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadSelectedZip()}
                  disabled={loading || uploading || zipping}
                >
                  {zipping ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Download className="mr-2 h-4 w-4" />}
                  Download zip
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedPaths(new Set())} disabled={loading || uploading}>
                  Clear
                </Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || uploading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
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
              <LearningDocRows
                docs={studentDocs}
                uploading={uploading}
                loading={loading}
                canDelete={false}
                onDeleteClick={noopDelete}
                selectedPaths={selectedPaths}
                onTogglePath={togglePath}
                onBulkSelectDocs={bulkSelectDocs}
                emptyMessage="No student learning documents yet."
                spacing="comfortable"
                onDownloadSectionZip={() => void downloadZipForDocs(studentDocs)}
                zipping={zipping}
              />
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
                <LearningDocRows
                  docs={trainerDocs}
                  uploading={uploading}
                  loading={loading}
                  canDelete={false}
                  onDeleteClick={noopDelete}
                  selectedPaths={selectedPaths}
                  onTogglePath={togglePath}
                  onBulkSelectDocs={bulkSelectDocs}
                  emptyMessage="No trainer documents yet."
                  spacing="comfortable"
                  onDownloadSectionZip={() => void downloadZipForDocs(trainerDocs)}
                  zipping={zipping}
                />
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
