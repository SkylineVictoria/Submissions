import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Loader } from '../components/ui/Loader';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import { listBatchesPaged, listStudentsPaged } from '../lib/formEngine';
import type { Course, Student } from '../lib/formEngine';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export const AdminCourseStudentsPage: React.FC = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const cid = Number(courseId);

  const PAGE_SIZE = 20;
  const [course, setCourse] = useState<Course | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(true);

  const [students, setStudents] = useState<Student[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const [batchFilterId, setBatchFilterId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Number.isFinite(cid) || cid <= 0) {
        setCourse(null);
        setLoadingCourse(false);
        return;
      }
      setLoadingCourse(true);
      const { data, error } = await supabase.from('skyline_courses').select('*').eq('id', cid).maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('load course error', error);
        setCourse(null);
      } else {
        setCourse((data as Course | null) ?? null);
      }
      setLoadingCourse(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cid]);

  const loadBatchFilterOptions = useCallback(
    async (page: number, search: string) => {
      if (!Number.isFinite(cid) || cid <= 0) return { options: [], hasMore: false };
      const res = await listBatchesPaged(page, 20, search || undefined, cid);
      const opts = res.data.map((b) => ({ value: String(b.id), label: b.name }));
      const withAll = page === 1 && !search?.trim() ? [{ value: '', label: 'All batches' }, ...opts] : opts;
      return { options: withAll, hasMore: page * 20 < res.total };
    },
    [cid]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [batchFilterId, statusFilter, searchTerm, cid]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      if (!Number.isFinite(cid) || cid <= 0) {
        setStudents([]);
        setTotalStudents(0);
        setLoading(false);
        return;
      }
      setLoading(true);
      const res = await listStudentsPaged(currentPage, PAGE_SIZE, searchTerm, statusFilter || undefined, {
        batchId: batchFilterId ? Number(batchFilterId) : null,
        courseIds: [cid],
      });
      setStudents(res.data);
      setTotalStudents(res.total);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [cid, currentPage, searchTerm, statusFilter, batchFilterId]);

  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const title = useMemo(() => course?.name ?? 'Course students', [course?.name]);

  if (!Number.isFinite(cid) || cid <= 0) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-4 py-6">
        <p className="text-sm text-gray-600">Invalid course.</p>
        <button className="mt-4 text-sm text-blue-600 hover:underline" onClick={() => navigate('/admin/courses')}>
          Back to courses
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <Link to="/admin/courses" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            <ChevronLeft className="w-4 h-4" />
            Courses
          </Link>
        </div>

        <Card className="mb-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                <Users className="w-5 h-5 text-[var(--brand)]" />
                {title}
              </h2>
              {loadingCourse ? (
                <p className="text-sm text-gray-600 mt-1">Loading course…</p>
              ) : course ? (
                <p className="text-sm text-gray-600 mt-1">
                  Students enrolled in this course{course.qualification_code?.trim() ? ` (${course.qualification_code})` : ''}.
                </p>
              ) : (
                <p className="text-sm text-gray-600 mt-1">Course not found.</p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3 min-w-0">
              <Select
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as '' | 'active' | 'inactive')}
                options={STATUS_FILTER_OPTIONS}
                compact
                className="w-full min-w-0 md:w-[200px]"
              />
              <SelectAsync
                value={batchFilterId}
                onChange={(v) => setBatchFilterId(v)}
                loadOptions={loadBatchFilterOptions}
                placeholder="All batches"
                selectedLabel={batchFilterId ? undefined : 'All batches'}
                className="w-full md:w-64"
              />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search students…"
                className="w-full h-10 md:w-60"
              />
            </div>
          </div>

          {!loading && (
            <AdminListPagination
              placement="top"
              totalItems={totalStudents}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="students"
            />
          )}

          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading students..." />
            </div>
          ) : students.length === 0 ? (
            <p className="text-gray-500">No students found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Student</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Batch</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Status</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="font-medium text-gray-900 break-words">
                          {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.email}
                        </div>
                        <div className="text-xs text-gray-500">Student ID: {s.student_id || '-'}</div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">{s.batch_name ?? '—'}</td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            (s.status || 'active') === 'active'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {s.status || 'active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <button
                          type="button"
                          className="text-blue-600 hover:underline font-medium"
                          onClick={() => navigate(`/admin/students/${s.id}`)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && (
            <AdminListPagination
              placement="bottom"
              totalItems={totalStudents}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="students"
            />
          )}
        </Card>
      </div>
    </div>
  );
};

