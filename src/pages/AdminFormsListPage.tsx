import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, Edit, Eye, MoreVertical, Copy } from 'lucide-react';
import { listFormsPaged, createForm, duplicateForm, getDefaultFormDates, listCourses, getCoursesForForms } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { Loader } from '../components/ui/Loader';

export const AdminFormsListPage: React.FC = () => {
  const PAGE_SIZE = 20;
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[]>([]);
  const [totalForms, setTotalForms] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newVersion, setNewVersion] = useState('1.0.0');
  const [newStartDate, setNewStartDate] = useState(() => getDefaultFormDates().start_date);
  const [newEndDate, setNewEndDate] = useState(() => getDefaultFormDates().end_date);
  const [qualificationCode, setQualificationCode] = useState('');
  const [qualificationName, setQualificationName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [duplicating, setDuplicating] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [formCoursesMap, setFormCoursesMap] = useState<Map<number, { id: number; name: string }[]>>(new Map());
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadFormsPage = useCallback(async (page: number, courseId?: number) => {
    setLoading(true);
    const res = await listFormsPaged(page, PAGE_SIZE, undefined, courseId);
    setForms(res.data);
    setTotalForms(res.total);
    const courseList = await listCourses();
    setCourses(courseList);
    const map = await getCoursesForForms(res.data.map((f) => f.id));
    setFormCoursesMap(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    const cid = courseFilter ? Number(courseFilter) : undefined;
    loadFormsPage(currentPage, cid);
  }, [currentPage, courseFilter, loadFormsPage]);

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
      start_date: newStartDate.trim() || undefined,
      end_date: newEndDate.trim() || undefined,
      qualification_code: qualificationCode.trim(),
      qualification_name: qualificationName.trim(),
      unit_code: unitCode.trim(),
      unit_name: unitName.trim(),
      assessment_tasks: [], // Default "Assessment - 1" / "Written Questions" created in form builder
    });
    if (created) {
      setCurrentPage(1);
      await loadFormsPage(1, courseFilter ? Number(courseFilter) : undefined);
      setNewName('');
      setNewVersion('1.0.0');
      setNewStartDate(getDefaultFormDates().start_date);
      setNewEndDate(getDefaultFormDates().end_date);
      setQualificationCode('');
      setQualificationName('');
      setUnitCode('');
      setUnitName('');
    }
    setCreating(false);
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
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Create New Form</h2>
          <p className="text-sm text-gray-600 mb-4">
            All fields are required. A default assessment (Assessment - 1 / Written Questions) is created automatically—you can edit or add more in the form builder.
          </p>
          <div className="space-y-3 min-w-0 overflow-x-auto">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Form name"
              required
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version (default: 1.0.0)</label>
              <Input
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder="1.0.0"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">Link validity period (sent links expire at end date)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <span className="block text-xs text-gray-500 mb-1">Start date</span>
                  <DatePicker
                    value={newStartDate}
                    onChange={setNewStartDate}
                    compact
                    placement="above"
                    className="w-full min-w-0"
                  />
                </div>
                <div className="min-w-0">
                  <span className="block text-xs text-gray-500 mb-1">End date</span>
                  <DatePicker
                    value={newEndDate}
                    onChange={setNewEndDate}
                    compact
                    placement="above"
                    className="w-full min-w-0"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              <Input
                value={qualificationCode}
                onChange={(e) => setQualificationCode(e.target.value)}
                placeholder="Qualification Code *"
                required
              />
              <Input
                value={qualificationName}
                onChange={(e) => setQualificationName(e.target.value)}
                placeholder="Qualification Name *"
                required
              />
              <Input
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
                placeholder="Unit Code *"
                required
              />
              <Input
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="Unit Name *"
                required
              />
            </div>
            <Button onClick={handleCreate} disabled={creating || !canCreate}>
              {creating ? (
                <Loader variant="dots" size="sm" inline className="mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2 inline" />
              )}
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text)]">All Forms</h2>
            <div className="flex items-center gap-3">
              <div className="w-56">
                <Select
                  value={courseFilter}
                  onChange={(v) => {
                    setCourseFilter(v);
                    setCurrentPage(1);
                  }}
                  options={[
                    { value: '', label: 'All courses' },
                    ...courses.map((c) => ({ value: String(c.id), label: c.name })),
                  ]}
                />
              </div>
              <div className="text-xs text-gray-500">Page {currentPage} of {totalPages} ({totalForms} total)</div>
            </div>
          </div>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading forms..." />
            </div>
          ) : forms.length === 0 ? (
            <p className="text-gray-500">No forms yet. Create one above.</p>
          ) : (
            <ul className="space-y-2">
              {forms.map((form) => (
                <li
                  key={form.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-white hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div>
                      <div className="font-medium text-[var(--text)]">{form.name}</div>
                      <div className="text-xs text-gray-500">
                        Status: {form.status} | Version: {form.version || '-'}
                        {formCoursesMap.get(form.id)?.length ? (
                          <span className="ml-1">
                            | Courses: {formCoursesMap.get(form.id)!.map((c) => c.name).join(', ')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="inline-flex min-w-[100px] items-center justify-center gap-2"
                      onClick={() => handlePreview(form.id)}
                      disabled={previewing !== null}
                    >
                      {previewing === form.id ? (
                        <Loader variant="dots" size="sm" inline />
                      ) : (
                        <Eye className="w-4 h-4 shrink-0" />
                      )}
                      {previewing === form.id ? 'Loading...' : 'Preview'}
                    </Button>
                    <Link to={`/admin/forms/${form.id}/builder`}>
                      <Button variant="outline" size="sm" className="inline-flex min-w-[100px] items-center justify-center gap-2">
                        <Edit className="w-4 h-4 shrink-0" />
                        Edit
                      </Button>
                    </Link>
                    <div
                      ref={openMenuId === form.id ? menuRef : undefined}
                      className="relative"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="inline-flex w-10 shrink-0 items-center justify-center !px-0"
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
                        <div
                          className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg"
                          role="menu"
                        >
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
                </li>
              ))}
            </ul>
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
    </div>
  );
};
