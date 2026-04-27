import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, Edit, Eye, MoreVertical, Copy, ToggleLeft, ToggleRight, Search, Trash2 } from 'lucide-react';
import { listFormsPaged, createForm, duplicateForm, updateForm, listCoursesPaged, getCoursesForForms, deleteFormSuperadmin } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import { useAuth } from '../contexts/AuthContext';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';

export const AdminFormsListPage: React.FC = () => {
  const { user } = useAuth();
  const canManageForms = user?.role === 'superadmin';
  const PAGE_SIZE = 20;
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[]>([]);
  const [totalForms, setTotalForms] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVersion, setNewVersion] = useState('1.0.0');
  const [qualificationCode, setQualificationCode] = useState('');
  const [qualificationName, setQualificationName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [duplicating, setDuplicating] = useState<number | null>(null);
  const [togglingActive, setTogglingActive] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [openMenuPlacement, setOpenMenuPlacement] = useState<'up' | 'down'>('down');
  const [deleteFormTarget, setDeleteFormTarget] = useState<Form | null>(null);
  const [deletingFormId, setDeletingFormId] = useState<number | null>(null);
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [formCoursesMap, setFormCoursesMap] = useState<Map<number, { id: number; name: string }[]>>(new Map());
  const [expandedFormId, setExpandedFormId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadFormsPage = useCallback(async (page: number, courseId?: number, search?: string) => {
    setLoading(true);
    const res = await listFormsPaged(page, PAGE_SIZE, undefined, courseId, search || undefined, { asAdmin: true });
    setForms(res.data);
    setTotalForms(res.total);
    const map = await getCoursesForForms(res.data.map((f) => f.id));
    setFormCoursesMap(map);
    setLoading(false);
  }, []);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search ? search.trim() : undefined);
    const opts = res.data.map((c) => ({ value: String(c.id), label: c.name }));
    const withAll = page === 1 && !search?.trim() ? [{ value: '', label: 'All courses' }, ...opts] : opts;
    return { options: withAll, hasMore: page * 20 < res.total };
  }, []);

  useEffect(() => {
    const cid = courseFilter ? Number(courseFilter) : undefined;
    const t = setTimeout(
      () => loadFormsPage(currentPage, cid, searchTerm.trim() || undefined),
      searchTerm ? 250 : 0
    );
    return () => clearTimeout(t);
  }, [currentPage, courseFilter, searchTerm, loadFormsPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [courseFilter, searchTerm]);

  const canCreate =
    newName.trim() &&
    qualificationCode.trim() &&
    qualificationName.trim() &&
    unitCode.trim() &&
    unitName.trim();

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    const created = await createForm({
      name: newName.trim(),
      version: newVersion.trim() || '1.0.0',
      qualification_code: qualificationCode.trim(),
      qualification_name: qualificationName.trim(),
      unit_code: unitCode.trim(),
      unit_name: unitName.trim(),
      assessment_tasks: [
        { label: 'Assessment Task - 1', method: 'Written Questions' },
        { label: 'Assessment Task - 2', method: 'Practical' },
      ],
    });
    setCreating(false);
    if (created) {
      setCurrentPage(1);
      await loadFormsPage(1, courseFilter ? Number(courseFilter) : undefined, searchTerm.trim() || undefined);
      setNewName('');
      setNewVersion('1.0.0');
      setQualificationCode('');
      setQualificationName('');
      setUnitCode('');
      setUnitName('');
      setIsCreateOpen(false);
    }
  };

  const handlePreview = async (formId: number) => {
    setPreviewing(formId);
    navigate(`/admin/forms/${formId}/preview`);
    setPreviewing(null);
  };

  const handleDuplicate = async (formId: number) => {
    setOpenMenuId(null);
    setDuplicating(formId);
    const duplicated = await duplicateForm(formId);
    setDuplicating(null);
    if (duplicated) {
      setCurrentPage(1);
      await loadFormsPage(1, courseFilter ? Number(courseFilter) : undefined);
    }
  };

  const confirmDeleteForm = async () => {
    if (!deleteFormTarget) return;
    const id = deleteFormTarget.id;
    setDeletingFormId(id);
    try {
      const res = await deleteFormSuperadmin(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Form deleted');
      setDeleteFormTarget(null);
      setOpenMenuId(null);
      await loadFormsPage(currentPage, courseFilter ? Number(courseFilter) : undefined, searchTerm.trim() || undefined);
    } finally {
      setDeletingFormId(null);
    }
  };

  const handleCopyGenericLink = async (formId: number) => {
    const url = `${window.location.origin}/forms/${formId}/student-access`;
    await navigator.clipboard.writeText(url);
    toast.success('Generic student link copied');
    setOpenMenuId(null);
  };

  const toggleMenuFor = (formId: number, triggerEl: HTMLElement | null) => {
    if (openMenuId === formId) {
      setOpenMenuId(null);
      return;
    }
    // Decide whether to open up or down based on viewport space.
    try {
      const rect = triggerEl?.getBoundingClientRect?.();
      if (rect) {
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
        const margin = 8;
        const spaceBelow = Math.max(0, viewportH - rect.bottom - margin);
        const spaceAbove = Math.max(0, rect.top - margin);
        // Approx menu height ~110; if not enough below and more above, open up.
        const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
        setOpenMenuPlacement(openUp ? 'up' : 'down');
      } else {
        setOpenMenuPlacement('down');
      }
    } catch {
      setOpenMenuPlacement('down');
    }
    setOpenMenuId(formId);
  };

  const handleToggleActive = async (formId: number, currentlyActive: boolean) => {
    setTogglingActive(formId);
    const { error } = await updateForm(formId, { active: !currentlyActive });
    setTogglingActive(null);
    if (!error) {
      setForms((prev) => prev.map((f) => (f.id === formId ? { ...f, active: !currentlyActive } : f)));
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-menu-trigger]')) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalForms / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Forms</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create and manage assessment forms. Inactive forms are only visible to admins.
              </p>
            </div>
            {canManageForms ? (
              <Button onClick={() => setIsCreateOpen(true)} className="w-full md:w-auto md:min-w-[140px]">
                <Plus className="w-4 h-4 mr-2 inline" />
                Add Form
              </Button>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-lg font-bold text-[var(--text)]">Form directory</h2>
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
                <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[220px] lg:max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none shrink-0" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search forms..."
                    className="!pl-10 min-w-0 w-full"
                  />
                </div>
                <div className="w-full min-w-0 sm:w-56 lg:w-56">
                  <SelectAsync
                    value={courseFilter}
                    onChange={(v) => setCourseFilter(v)}
                    loadOptions={loadCoursesOptions}
                    placeholder="All courses"
                    selectedLabel={courseFilter ? undefined : 'All courses'}
                  />
                </div>
                {!loading && totalForms > 0 && (
                  <div className="hidden shrink-0 text-xs text-gray-500 lg:block">
                    {totalForms} form{totalForms === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            </div>
          </div>
          {!loading && (
            <AdminListPagination
              placement="top"
              totalItems={totalForms}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="forms"
            />
          )}
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading forms..." />
            </div>
          ) : forms.length === 0 ? (
            <p className="text-gray-500 py-8">
              {canManageForms ? 'No forms yet. Click "Add Form" to create one.' : 'No forms found.'}
            </p>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {forms.map((form) => (
                  <div
                    key={form.id}
                    className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm hover:bg-[var(--brand)]/10 transition-colors cursor-pointer"
                    onClick={() => setExpandedFormId((p) => (p === form.id ? null : form.id))}
                    title="Click to expand documents"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--text)] break-words">{form.name}</div>
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(form.id, form.active !== false)}
                            disabled={togglingActive !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                            title={form.active !== false ? 'Click to make inactive' : 'Click to make active'}
                          >
                            {togglingActive === form.id ? (
                              <Loader variant="dots" size="sm" />
                            ) : form.active !== false ? (
                              <>
                                <ToggleRight className="w-4 h-4 text-green-600" />
                                <span className="text-green-700">Active</span>
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="w-4 h-4 text-gray-400" />
                                <span className="text-gray-500">Inactive</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                          <span className="font-medium text-gray-600">Status: </span>
                          {form.status}
                        </div>
                        <div className="text-sm text-gray-700">
                          <span className="font-medium text-gray-600">Version: </span>
                          {form.version || '-'}
                        </div>
                        <div className="mt-1 text-sm text-gray-600 break-words">
                          <span className="font-medium text-gray-600">Courses: </span>
                          {formCoursesMap.get(form.id)?.map((c) => c.name).join(', ') || '—'}
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreview(form.id);
                            }}
                            disabled={previewing !== null}
                          >
                            {previewing === form.id ? <Loader variant="dots" size="sm" inline /> : <Eye className="mr-2 h-4 w-4 shrink-0" />}
                            Preview
                          </Button>
                          {canManageForms ? (
                            <Link to={`/admin/forms/${form.id}/builder`} className="block w-full" onClick={(e) => e.stopPropagation()}>
                              <Button variant="outline" size="sm" className="w-full justify-center">
                                <Edit className="mr-2 h-4 w-4 shrink-0" />
                                Edit in builder
                              </Button>
                            </Link>
                          ) : null}
                          <div className={`grid gap-2 ${canManageForms ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCopyGenericLink(form.id);
                              }}
                              disabled={duplicating !== null}
                            >
                              <Copy className="mr-2 h-4 w-4 shrink-0" />
                              Copy link
                            </Button>
                            {canManageForms ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-center"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicate(form.id);
                                }}
                                disabled={duplicating !== null}
                              >
                                {duplicating === form.id ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Copy className="mr-2 h-4 w-4 shrink-0" />}
                                Duplicate
                              </Button>
                            ) : null}
                            {canManageForms ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-center border-red-200 text-red-700 hover:bg-red-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteFormTarget(form);
                                }}
                                disabled={deletingFormId !== null}
                              >
                                <Trash2 className="mr-2 h-4 w-4 shrink-0" />
                                Delete form
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {expandedFormId === form.id ? (
                          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                            <FormDocumentsPanel formId={form.id} formName={form.name} canUpload={canManageForms} canDelete={canManageForms} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <div className="min-w-[700px] border border-[var(--border)] rounded-lg overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Form Name</th>
                        <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-24">Active</th>
                        <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-28">Status</th>
                        <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-24">Version</th>
                        <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Courses</th>
                        <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forms.map((form) => (
                        <React.Fragment key={form.id}>
                        <tr
                          className="hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors cursor-pointer"
                          onClick={() => setExpandedFormId((p) => (p === form.id ? null : form.id))}
                          title="Click to expand documents"
                        >
                          <td className="px-4 py-3 border-b border-[var(--border)]">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                              <span className="font-medium text-[var(--text)]">{form.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 border-b border-[var(--border)]">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(form.id, form.active !== false)}
                              disabled={togglingActive !== null}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                              title={form.active !== false ? 'Click to make inactive' : 'Click to make active'}
                            >
                              {togglingActive === form.id ? (
                                <Loader variant="dots" size="sm" />
                              ) : form.active !== false ? (
                                <>
                                  <ToggleRight className="w-4 h-4 text-green-600" />
                                  <span className="text-green-700">Active</span>
                                </>
                              ) : (
                                <>
                                  <ToggleLeft className="w-4 h-4 text-gray-400" />
                                  <span className="text-gray-500">Inactive</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">{form.status}</td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">{form.version || '-'}</td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-gray-600 max-w-[200px] truncate" title={formCoursesMap.get(form.id)?.map((c) => c.name).join(', ') ?? ''}>
                            {formCoursesMap.get(form.id)?.map((c) => c.name).join(', ') || '-'}
                          </td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="inline-flex min-w-[90px] items-center justify-center gap-1.5"
                                onClick={() => handlePreview(form.id)}
                                disabled={previewing !== null}
                              >
                                {previewing === form.id ? <Loader variant="dots" size="sm" inline /> : <Eye className="w-4 h-4 shrink-0" />}
                                Preview
                              </Button>
                              {canManageForms ? (
                                <Link to={`/admin/forms/${form.id}/builder`}>
                                  <Button variant="outline" size="sm" className="inline-flex min-w-[90px] items-center justify-center gap-1.5">
                                    <Edit className="w-4 h-4 shrink-0" />
                                    Edit
                                  </Button>
                                </Link>
                              ) : null}
                              <div ref={openMenuId === form.id ? menuRef : undefined} className="relative">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="inline-flex w-9 shrink-0 items-center justify-center !px-0"
                                  data-menu-trigger
                                  onClick={(e) => toggleMenuFor(form.id, e.currentTarget)}
                                  disabled={duplicating !== null}
                                  aria-label="More options"
                                >
                                  {duplicating === form.id ? (
                                    <Loader variant="dots" size="sm" />
                                  ) : (
                                    <MoreVertical className="w-4 h-4" />
                                  )}
                                </Button>
                                {openMenuId === form.id && (
                                  <div
                                    className={`absolute right-0 z-50 min-w-[190px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg ${
                                      openMenuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
                                    }`}
                                    role="menu"
                                  >
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-gray-100"
                                      onClick={() => void handleCopyGenericLink(form.id)}
                                      role="menuitem"
                                    >
                                      <Copy className="w-4 h-4" />
                                      Copy generic link
                                    </button>
                                    {canManageForms ? (
                                      <>
                                        <div className="my-1 h-px bg-gray-100" />
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-gray-100"
                                          onClick={() => handleDuplicate(form.id)}
                                          role="menuitem"
                                        >
                                          <Copy className="w-4 h-4" />
                                          Duplicate
                                        </button>
                                        <div className="my-1 h-px bg-gray-100" />
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            setDeleteFormTarget(form);
                                          }}
                                          role="menuitem"
                                        >
                                          <Trash2 className="w-4 h-4 shrink-0" />
                                          Delete form
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {expandedFormId === form.id ? (
                          <tr className="bg-white">
                            <td colSpan={6} className="px-4 py-3 border-b border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <FormDocumentsPanel formId={form.id} formName={form.name} canUpload={canManageForms} canDelete={canManageForms} />
                                <div className="rounded-lg border border-[var(--border)] bg-white p-4">
                                  <div className="text-sm font-semibold text-[var(--text)]">Form</div>
                                  <div className="mt-1 text-xs text-gray-600 break-words">{form.name}</div>
                                  <div className="mt-3 text-xs text-gray-500">
                                    Upload learning materials here to make them available to students/trainers.
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {!loading && (
            <AdminListPagination
              placement="bottom"
              totalItems={totalForms}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="forms"
            />
          )}
        </Card>
      </div>

      <Modal
        isOpen={!!deleteFormTarget}
        onClose={() => {
          if (deletingFormId) return;
          setDeleteFormTarget(null);
        }}
        title="Delete form"
        size="md"
      >
        {deleteFormTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Delete <strong className="break-words">{deleteFormTarget.name}</strong> permanently? This removes the form definition, all student assessment instances for this form, and course links. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteFormTarget(null)} disabled={deletingFormId !== null}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-700 border-red-600"
                onClick={() => void confirmDeleteForm()}
                disabled={deletingFormId !== null}
              >
                {deletingFormId === deleteFormTarget.id ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Trash2 className="w-4 h-4 mr-2 inline" />}
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={isCreateOpen} onClose={() => !creating && setIsCreateOpen(false)} title="Create New Form" size="lg">
        <p className="text-sm text-gray-600 mb-4">
          All fields are required. A default assessment (Assessment - 1 / Written Questions) is created automatically—you can edit or add more in the form builder.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Form name *</span>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Form name" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Version (default: 1.0.0)</span>
            <Input value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder="1.0.0" className="mt-1" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Qualification Code *</span>
              <Input value={qualificationCode} onChange={(e) => setQualificationCode(e.target.value)} placeholder="e.g. MSF30422" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Qualification Name *</span>
              <Input value={qualificationName} onChange={(e) => setQualificationName(e.target.value)} placeholder="e.g. Certificate III in Glass and Glazing" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Unit Code *</span>
              <Input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="e.g. MSMSUP102" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Unit Name *</span>
              <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. Communicate in the workplace" className="mt-1" />
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !canCreate}>
            {creating ? <Loader variant="dots" size="sm" inline className="mr-2" /> : <Plus className="w-4 h-4 mr-2 inline" />}
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
