import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, Edit, Eye, MoreVertical, Copy, ToggleLeft, ToggleRight, Search } from 'lucide-react';
import { listFormsPaged, createForm, duplicateForm, updateForm, listCoursesPaged, getCoursesForForms } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';

export const AdminFormsListPage: React.FC = () => {
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
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [formCoursesMap, setFormCoursesMap] = useState<Map<number, { id: number; name: string }[]>>(new Map());
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
            <Button onClick={() => setIsCreateOpen(true)} className="min-w-[140px]">
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Form
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text)]">All Forms</h2>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 sm:flex-initial sm:min-w-[240px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none shrink-0" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search forms..."
                    className="!pl-10 min-w-0"
                  />
                </div>
                <div className="w-48 sm:w-56">
                  <SelectAsync
                    value={courseFilter}
                    onChange={(v) => setCourseFilter(v)}
                    loadOptions={loadCoursesOptions}
                    placeholder="All courses"
                    selectedLabel={courseFilter ? undefined : 'All courses'}
                  />
                </div>
                <div className="text-xs text-gray-500 shrink-0">Page {currentPage} of {totalPages} ({totalForms} total)</div>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading forms..." />
            </div>
          ) : forms.length === 0 ? (
            <p className="text-gray-500 py-8">No forms yet. Click "Add Form" to create one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[700px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
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
                    <tr key={form.id} className="hover:bg-gray-50">
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
                        <div className="flex items-center justify-end gap-2">
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
                          <Link to={`/admin/forms/${form.id}/builder`}>
                            <Button variant="outline" size="sm" className="inline-flex min-w-[90px] items-center justify-center gap-1.5">
                              <Edit className="w-4 h-4 shrink-0" />
                              Edit
                            </Button>
                          </Link>
                          <div ref={openMenuId === form.id ? menuRef : undefined} className="relative">
                            <Button
                              variant="outline"
                              size="sm"
                              className="inline-flex w-9 shrink-0 items-center justify-center !px-0"
                              data-menu-trigger
                              onClick={() => setOpenMenuId(openMenuId === form.id ? null : form.id)}
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
                              <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg" role="menu">
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-gray-100"
                                  onClick={() => handleDuplicate(form.id)}
                                  role="menuitem"
                                >
                                  <Copy className="w-4 h-4" />
                                  Duplicate
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && totalForms > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </div>

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
