import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Paperclip, Upload, RefreshCw, Download, GraduationCap, ExternalLink, Plus, Trash2, Link as LinkIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { toast } from '../../utils/toast';
import {
  deleteLearningDoc,
  listLearningDocs,
  logDocActivity,
  uploadLearningDoc,
  zipAndDownloadLearningDocs,
  type LearningAudience,
  type LearningDoc,
} from '../../lib/formDocuments';
import { fetchForm, updateForm } from '../../lib/formEngine';
import { LearningDocRows } from './LearningDocRows';

type Props = {
  formId: number;
  formName: string;
  canUpload: boolean;
  canDelete?: boolean;
  /** When false, do not auto-load on mount (caller will invoke refresh) */
  autoLoad?: boolean;
  /** When false, trainer/assessor-only materials are not shown (e.g. student view). Default true. */
  showTrainerSection?: boolean;
};

export const FormDocumentsPanel: React.FC<Props> = ({
  formId,
  formName,
  canUpload,
  canDelete = false,
  autoLoad = true,
  showTrainerSection = true,
}) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [studentDocs, setStudentDocs] = useState<LearningDoc[]>([]);
  const [trainerDocs, setTrainerDocs] = useState<LearningDoc[]>([]);
  const studentFileInputRef = useRef<HTMLInputElement | null>(null);
  const trainerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LearningDoc | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [zipping, setZipping] = useState(false);

  const [materialUrls, setMaterialUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [savingUrls, setSavingUrls] = useState(false);

  const title = useMemo(() => `Documents`, []);
  const totalCount = studentDocs.length + (showTrainerSection ? trainerDocs.length : 0);

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
        console.error('FormDocumentsPanel zip download error', e);
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
      const formP = fetchForm(formId, { allowInactiveForAdmin: true });
      const [s, t, formRow] = await Promise.all([studentP, trainerP, formP]);
      setStudentDocs(s);
      setTrainerDocs(t);
      setMaterialUrls(formRow?.learning_material_urls ?? []);
      setSelectedPaths(new Set());
    } catch (e) {
      console.error('FormDocumentsPanel list error', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      setStudentDocs([]);
      setTrainerDocs([]);
      setMaterialUrls([]);
      setSelectedPaths(new Set());
    } finally {
      setLoading(false);
    }
  }, [formId, formName, showTrainerSection]);

  const addMaterialUrl = useCallback(async () => {
    const url = newUrl.trim();
    if (!url) return;
    try { new URL(url); } catch { toast.error('Enter a valid URL (e.g. https://…)'); return; }
    if (materialUrls.includes(url)) { toast.error('This URL is already added.'); return; }
    const next = [...materialUrls, url];
    setSavingUrls(true);
    const { error } = await updateForm(formId, { learning_material_urls: next });
    setSavingUrls(false);
    if (error) { toast.error(error.message); return; }
    setMaterialUrls(next);
    setNewUrl('');
    toast.success('URL added');
    void logDocActivity(formId, 'add_url', { publicUrl: url });
  }, [formId, materialUrls, newUrl]);

  const removeMaterialUrl = useCallback(async (url: string) => {
    const next = materialUrls.filter((u) => u !== url);
    setSavingUrls(true);
    const { error } = await updateForm(formId, { learning_material_urls: next });
    setSavingUrls(false);
    if (error) { toast.error(error.message); return; }
    setMaterialUrls(next);
    toast.success('URL removed');
    void logDocActivity(formId, 'remove_url', { publicUrl: url });
  }, [formId, materialUrls]);

  useEffect(() => {
    if (!autoLoad) return;
    void load();
  }, [autoLoad, load]);

  const onPickFiles = async (list: File[], audience: LearningAudience) => {
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        await uploadLearningDoc({ formId, formName, file, upsert: true, audience });
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
    <div className="rounded-xl border-2 border-amber-200/80 bg-amber-50/35 p-4 shadow-sm ring-1 ring-amber-100/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm text-gray-700">
          <Paperclip className="h-4 w-4 text-gray-500" />
          <span className="font-semibold text-[var(--text)]">{title}</span>
          <span className="text-gray-500">({totalCount})</span>
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
        <div className="py-6">
          <Loader variant="dots" size="lg" message="Loading documents..." />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                <BookOpen className="h-4 w-4 text-gray-500 shrink-0" />
                <span className="font-semibold">Student learning</span>
                <span className="text-gray-500 font-normal">({studentDocs.length})</span>
              </div>
              {canUpload ? (
                <>
                  <input
                    ref={studentFileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
                      e.currentTarget.value = '';
                      void onPickFiles(files, 'student');
                    }}
                    disabled={uploading}
                  />
                  <Button type="button" size="sm" disabled={uploading} onClick={() => studentFileInputRef.current?.click()}>
                    {uploading ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Upload className="mr-2 h-4 w-4" />}
                    Upload
                  </Button>
                </>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-gray-500">Visible to students and trainers.</p>
            <LearningDocRows
              docs={studentDocs}
              uploading={uploading}
              loading={loading}
              canDelete={canDelete}
              onDeleteClick={setDeleteTarget}
              selectedPaths={selectedPaths}
              onTogglePath={togglePath}
              onBulkSelectDocs={bulkSelectDocs}
              onDownloadSectionZip={() => void downloadZipForDocs(studentDocs)}
              zipping={zipping}
            />
          </div>

          {showTrainerSection ? (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                  <GraduationCap className="h-4 w-4 text-gray-500 shrink-0" />
                  <span className="font-semibold">Trainer / assessor</span>
                  <span className="text-gray-500 font-normal">({trainerDocs.length})</span>
                </div>
                {canUpload ? (
                  <>
                    <input
                      ref={trainerFileInputRef}
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
                        e.currentTarget.value = '';
                        void onPickFiles(files, 'trainer');
                      }}
                      disabled={uploading}
                    />
                    <Button type="button" size="sm" disabled={uploading} onClick={() => trainerFileInputRef.current?.click()}>
                      {uploading ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Upload className="mr-2 h-4 w-4" />}
                      Upload
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                Not shown to students—trainers and staff only.
              </p>
              <LearningDocRows
                docs={trainerDocs}
                uploading={uploading}
                loading={loading}
                canDelete={canDelete}
                onDeleteClick={setDeleteTarget}
                selectedPaths={selectedPaths}
                onTogglePath={togglePath}
                onBulkSelectDocs={bulkSelectDocs}
                onDownloadSectionZip={() => void downloadZipForDocs(trainerDocs)}
                zipping={zipping}
              />
            </div>
          ) : null}
        </div>
      )}

      {(materialUrls.length > 0 || canUpload) && !loading ? (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
            <LinkIcon className="h-4 w-4 text-gray-500 shrink-0" />
            <span className="font-semibold">Learning material links</span>
            <span className="text-gray-500 font-normal">({materialUrls.length})</span>
          </div>
          {materialUrls.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {materialUrls.map((url) => (
                <li key={url} className="flex items-start gap-2 text-sm group">
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 break-all text-blue-600 underline hover:text-blue-800"
                  >
                    {url}
                  </a>
                  {canUpload ? (
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded p-0.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                      title="Remove URL"
                      onClick={() => void removeMaterialUrl(url)}
                      disabled={savingUrls}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-gray-500">No links added yet.</p>
          )}
          {canUpload ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="url"
                placeholder="https://example.com/material.pdf"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addMaterialUrl(); } }}
                className="min-w-0 flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                disabled={savingUrls}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void addMaterialUrl()}
                disabled={savingUrls || !newUrl.trim()}
              >
                {savingUrls ? <Loader variant="dots" size="sm" inline className="mr-1" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

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
              await deleteLearningDoc(target.path, formId);
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
