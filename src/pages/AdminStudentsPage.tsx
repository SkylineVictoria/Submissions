import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Plus, Send, Mail, Phone, Pencil, Upload, Trash2, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  listStudentsPaged,
  createStudent,
  updateStudent,
  createFormInstance,
  getInstanceForStudentAndForm,
  listForms,
  listBatchesPaged,
  updateFormInstanceDates,
  extendInstanceAccessTokensToDate,
  getStudentsByEmails,
  listCoursesPaged,
  getCoursesByQualificationCodes,
  setStudentCourses,
} from '../lib/formEngine';
import {
  buildEmailFromLocalAndDomain,
  getEmailLocalPartForEdit,
  getInstitutionalDomainFromEmail,
  type InstitutionalDomain,
  STUDENT_DOMAIN,
} from '../lib/emailUtils';
import type { Student } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { EmailWithDomainPicker } from '../components/ui/EmailWithDomainPicker';
import { Select } from '../components/ui/Select';
import { SelectAsync } from '../components/ui/SelectAsync';
import { MultiSelectAsync } from '../components/ui/MultiSelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { pdf } from '@react-pdf/renderer';
import { GenericLinksPdf } from '../components/pdf/GenericLinksPdf';
import { registerPdfFonts } from '../utils/fontLoader';
import { AdminListPagination } from '../components/admin/AdminListPagination';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...STATUS_OPTIONS,
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatCreatedDisplay = (value: string | null | undefined): string => {
  const v = String(value ?? '').trim();
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return v;
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

export const AdminStudentsPage: React.FC = () => {
  const navigate = useNavigate();
  const PAGE_SIZE = 20;
  const [students, setStudents] = useState<Student[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);
  const [hasBatches, setHasBatches] = useState(false);
  const [studentCoursesMap, setStudentCoursesMap] = useState<
    Record<number, Array<{ id: number; name: string; qualification_code: string | null }>>
  >({});
  const [studentDraft, setStudentDraft] = useState({
    student_id: '',
    first_name: '',
    last_name: '',
    email_local: '',
    email_domain: STUDENT_DOMAIN as InstitutionalDomain,
    phone: '',
    batch_id: '',
    course_ids: [] as number[],
    status: 'active' as 'active' | 'inactive',
  });
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importBatchId, setImportBatchId] = useState('');
  const [importRows, setImportRows] = useState<Array<{
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    student_id?: string;
    unit_code?: string;
    qualification_code?: string;
    activity_start_date?: string;
    activity_end_date?: string;
  }>>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null);
  const [importExistingByEmail, setImportExistingByEmail] = useState<Record<string, Student>>({});
  const [importIdDecisionByEmail, setImportIdDecisionByEmail] = useState<Record<string, 'keep_existing' | 'use_new'>>({});
  const [lastImportLinksPayload, setLastImportLinksPayload] = useState<{
    createdAtIso: string;
    batchId: number | null;
    forms: Array<{ id: number; name: string; version?: string | null; url: string }>;
    students: Array<{ id: number; name: string; email: string }>;
  } | null>(null);

  const importMappingResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [importMappingMessage, setImportMappingMessage] = useState<string | null>(null);
  const [importResultModal, setImportResultModal] = useState<{ title: string; message: string; error?: boolean } | null>(null);

  const dismissImportResult = useCallback(() => {
    setImportResultModal(null);
    setIsImportOpen(false);
    setImportRows([]);
    setImportFileName('');
  }, []);

  const digitsOnly = (val: string) => val.replace(/\D/g, '');
  const validateCreateStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    phone: string;
    batch_id?: string;
    course_ids?: number[];
  }): string | null => {
    if (!String(form.student_id ?? '').trim()) return 'Student ID is required.';
    if (!String(form.first_name ?? '').trim()) return 'First name is required.';
    const courseIds = Array.isArray(form.course_ids) ? form.course_ids : [];
    if (courseIds.filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).length === 0) return 'Select at least one course.';
    const email = buildEmailFromLocalAndDomain(
      form.email_local?.trim() || form.student_id,
      (form as { email_domain?: typeof STUDENT_DOMAIN }).email_domain ?? STUDENT_DOMAIN
    );
    if (!email) return 'Email local part (or Student ID) is required.';
    if (/\s/.test(form.student_id.trim())) return 'Student ID cannot contain spaces.';
    if (form.phone && !/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits when provided.';
    return null;
  };

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((c) => ({
        value: c.id,
        label: c.qualification_code?.trim() ? `${c.qualification_code} — ${c.name}` : c.name,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  useEffect(() => {
    listForms('published', { asAdmin: false }).then((f) => setForms(f));
  }, []);

  useEffect(() => {
    if (!importing) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Modern browsers ignore custom text but require returnValue to show the warning.
      e.preventDefault();
      e.returnValue = 'Import is still running. Leaving or refreshing will stop it.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [importing]);
  useEffect(() => {
    listBatchesPaged(1, 1).then((res) => setHasBatches(res.total > 0));
  }, []);
  const displayForms = forms;

  const loadBatchesOptionsWithNone = useCallback(async (page: number, search: string) => {
    const res = await listBatchesPaged(page, 20, search || undefined);
    const opts = res.data.map((b) => ({ value: String(b.id), label: b.name }));
    const withNone = page === 1 && !search?.trim() ? [{ value: '', label: 'No batch' }, ...opts] : opts;
    return { options: withNone, hasMore: page * 20 < res.total };
  }, []);

  const loadBatchesOptions = useCallback(async (page: number, search: string) => {
    const res = await listBatchesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((b) => ({ value: String(b.id), label: b.name })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await listStudentsPaged(currentPage, PAGE_SIZE, searchTerm, statusFilter || undefined);
      setStudents(res.data);
      setTotalStudents(res.total);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm, statusFilter]);

  useEffect(() => {
    if (students.length === 0) {
      setStudentCoursesMap({});
      return;
    }
    const ids = students.map((s) => s.id);
    supabase
      .from('skyline_student_courses')
      .select('student_id, skyline_courses(id, name, qualification_code)')
      .in('student_id', ids)
      .eq('status', 'active')
      .then(({ data }) => {
        const rows =
          (data as Array<{ student_id: number; skyline_courses: { id: number; name: string; qualification_code: string | null } | null }> | null) ||
          [];
        const map: Record<number, Array<{ id: number; name: string; qualification_code: string | null }>> = {};
        for (const r of rows) {
          const sid = Number(r.student_id);
          const c = r.skyline_courses;
          if (!Number.isFinite(sid) || !c) continue;
          const list = map[sid] ?? [];
          list.push(c);
          map[sid] = list;
        }
        setStudentCoursesMap(map);
      });
  }, [students]);

  const handleCreate = async () => {
    const formError = validateCreateStudentForm(studentDraft);
    if (formError) {
      toast.error(formError);
      return;
    }
    setCreating(true);
    const batchId = studentDraft.batch_id ? (Number(studentDraft.batch_id) || null) : null;
    const email = buildEmailFromLocalAndDomain(
      studentDraft.email_local?.trim() || studentDraft.student_id,
      studentDraft.email_domain
    );
    const created = await createStudent({
      student_id: studentDraft.student_id,
      first_name: studentDraft.first_name,
      last_name: studentDraft.last_name || undefined,
      phone: studentDraft.phone || undefined,
      email,
      batch_id: batchId ?? undefined,
      course_ids: studentDraft.course_ids,
      status: studentDraft.status,
    });
    if (created) {
      setCurrentPage(1);
      const res = await listStudentsPaged(1, PAGE_SIZE, searchTerm, statusFilter || undefined);
      setStudents(res.data);
      setTotalStudents(res.total);
      setStudentDraft({
        student_id: '',
        first_name: '',
        last_name: '',
        email_local: '',
        email_domain: STUDENT_DOMAIN,
        phone: '',
        batch_id: '',
        course_ids: [],
        status: 'active',
      });
      setIsCreateOpen(false);
      toast.success('Student added');
    } else {
      toast.error('Failed to add student');
    }
    setCreating(false);
  };

  const normalizeCol = (s: string) => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const colMatch = (h: string, ...aliases: string[]) =>
    aliases.some((a) => normalizeCol(h).includes(normalizeCol(a)) || normalizeCol(a).includes(normalizeCol(h)));

  const toIsoDate = (val: unknown): string | undefined => {
    if (val == null) return undefined;
    if (val instanceof Date) {
      if (Number.isNaN(val.getTime())) return undefined;
      // Use local calendar date (AEDT/user locale), not UTC shifting.
      const yyyy = String(val.getFullYear()).padStart(4, '0');
      const mm = String(val.getMonth() + 1).padStart(2, '0');
      const dd = String(val.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      const d = XLSX.SSF.parse_date_code(val);
      if (!d || !d.y || !d.m || !d.d) return undefined;
      const yyyy = String(d.y).padStart(4, '0');
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const s = String(val).trim();
    if (!s) return undefined;
    // Accept dd/mm/yyyy, dd-mm-yyyy (common in AU spreadsheets), or yyyy-mm-dd-ish.
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m1) {
      const dd = String(m1[1]).padStart(2, '0');
      const mm = String(m1[2]).padStart(2, '0');
      const yyyy = String(m1[3]).length === 2 ? `20${m1[3]}` : String(m1[3]).padStart(4, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const mDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if (mDash) {
      const dd = String(mDash[1]).padStart(2, '0');
      const mm = String(mDash[2]).padStart(2, '0');
      const yyyy = String(mDash[3]).length === 2 ? `20${mDash[3]}` : String(mDash[3]).padStart(4, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const asDate = new Date(s);
    if (!Number.isNaN(asDate.getTime())) {
      const yyyy = String(asDate.getFullYear()).padStart(4, '0');
      const mm = String(asDate.getMonth() + 1).padStart(2, '0');
      const dd = String(asDate.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return undefined;
  };

  const parseImportFile = (file: File): Promise<Array<{
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    student_id?: string;
    unit_code?: string;
    qualification_code?: string;
    activity_start_date?: string;
    activity_end_date?: string;
  }>> => {
    return new Promise((resolve, reject) => {
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Could not read file'));
            return;
          }
          // Keep raw numeric serial dates so parse_date_code can map calendar date directly.
          const wb = XLSX.read(data, { type: isCsv ? 'binary' : 'array' });
          const firstSheet = wb.SheetNames[0];
          if (!firstSheet) {
            reject(new Error('No sheets found'));
            return;
          }
          const ws = wb.Sheets[firstSheet];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
          if (rows.length < 2) {
            resolve([]);
            return;
          }
          const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
          const fnIdx = headers.findIndex((h) => colMatch(h, 'given name', 'first name', 'firstname'));
          const lnIdx = headers.findIndex((h) => colMatch(h, 'surname', 'last name', 'lastname'));
          const emIdx = headers.findIndex((h) => colMatch(h, 'email address', 'email'));
          const phIdx = headers.findIndex((h) => colMatch(h, 'mobile phone', 'phone', 'mobile'));
          const sidIdx = headers.findIndex((h) => colMatch(h, 'student id', 'studentid'));
          const unitIdx = headers.findIndex((h) => colMatch(h, 'unit code', 'unit of competency code', 'unit'));
          const qualIdx = headers.findIndex((h) => colMatch(h, 'qualification code', 'qualification'));
          const startIdx = headers.findIndex((h) => colMatch(h, 'activity start date', 'start date', 'activity start'));
          const endIdx = headers.findIndex((h) => colMatch(h, 'activity end date', 'end date', 'activity end'));
          if (fnIdx < 0 || emIdx < 0) {
            reject(new Error('Required columns: First Name, Email. Found: ' + headers.join(', ')));
            return;
          }
          const result: Array<{
            first_name: string;
            last_name: string;
            email: string;
            phone: string;
            student_id?: string;
            unit_code?: string;
            qualification_code?: string;
            activity_start_date?: string;
            activity_end_date?: string;
          }> = [];
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] as unknown[];
            const first = String(row[fnIdx] ?? '').trim();
            const last = lnIdx >= 0 ? String(row[lnIdx] ?? '').trim() : '';
            const email = String(row[emIdx] ?? '').trim();
            const phone = phIdx >= 0 ? digitsOnly(String(row[phIdx] ?? '')).slice(0, 10) : '';
            const studentId = sidIdx >= 0 ? String(row[sidIdx] ?? '').trim() : undefined;
            const unitCode = unitIdx >= 0 ? String(row[unitIdx] ?? '').trim() : '';
            const qualCode = qualIdx >= 0 ? String(row[qualIdx] ?? '').trim() : '';
            const start = startIdx >= 0 ? toIsoDate(row[startIdx]) : undefined;
            const end = endIdx >= 0 ? toIsoDate(row[endIdx]) : undefined;
            if (!first && !email) continue;
            result.push({
              first_name: first,
              last_name: last,
              email,
              phone,
              student_id: studentId || undefined,
              unit_code: unitCode || undefined,
              qualification_code: qualCode || undefined,
              activity_start_date: start,
              activity_end_date: end,
            });
          }
          resolve(result);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Parse failed'));
        }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      if (isCsv) {
        reader.readAsBinaryString(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      toast.error('Please upload a CSV or XLSX file.');
      return;
    }
    try {
      const rows = await parseImportFile(file);
      setImportRows(rows);
      setImportFileName(file.name);
      if (rows.length === 0) toast.info('No valid rows found. Expected columns: First Name, Last Name, Email, Phone.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse file');
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (importRows.length === 0) {
      setImportExistingByEmail({});
      setImportIdDecisionByEmail({});
      return;
    }
    const emails = Array.from(new Set(importRows.map((r) => String(r.email ?? '').trim().toLowerCase()).filter(Boolean)));
    getStudentsByEmails(emails).then((existing) => {
      const map: Record<string, Student> = {};
      for (const s of existing) {
        if (s.email) map[String(s.email).trim().toLowerCase()] = s;
      }
      setImportExistingByEmail(map);
      setImportIdDecisionByEmail((prev) => {
        const next = { ...prev };
        for (const email of emails) {
          if (!(email in next)) next[email] = 'keep_existing';
        }
        return next;
      });
    });
  }, [importRows]);

  const updateImportRow = (index: number, field: keyof typeof importRows[0], value: string) => {
    setImportRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: field === 'phone' ? digitsOnly(value).slice(0, 10) : value } : r))
    );
  };

  const removeImportRow = (index: number) => {
    setImportRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBulkImport = async () => {
    if (importRows.length === 0) {
      toast.error('Upload a file with student data first');
      return;
    }
    setImporting(true);
    setImportProgress({ done: 0, total: importRows.length, success: 0, failed: 0 });
    let success = 0;
    let failed = 0;
    let importStudentsForPdf: Array<{ id: number; name: string; email: string }> = [];
    let importFormIdsForPdf: Set<number> = new Set<number>();
    const splitCodes = (val: unknown) =>
      String(val ?? '')
        .toUpperCase()
        .split(/[;,|]/g)
        .map((x) => x.trim())
        .filter(Boolean);

    try {
      const importQualCodes = Array.from(new Set(importRows.flatMap((r) => splitCodes(r.qualification_code))));
      const courseByQual = await getCoursesByQualificationCodes(importQualCodes);
      const unitToFormIds = new Map<string, number[]>();
      const qualToFormIds = new Map<string, number[]>();
      for (const f of displayForms) {
        const unit = String((f as unknown as { unit_code?: string | null }).unit_code ?? '').trim().toUpperCase();
        if (unit) {
          const list = unitToFormIds.get(unit) ?? [];
          list.push(Number(f.id));
          unitToFormIds.set(unit, list);
        }
        const qual = String((f as unknown as { qualification_code?: string | null }).qualification_code ?? '').trim().toUpperCase();
        if (qual) {
          const list = qualToFormIds.get(qual) ?? [];
          list.push(Number(f.id));
          qualToFormIds.set(qual, list);
        }
      }

      const PAIR_SEP = '\x1e';
      /** (course qualification from import file) + unit → forms on that course with that unit (form may use a different qualification_code on the form record). */
      const courseLinkedPairToFormIds = new Map<string, Set<number>>();
      const courseIds = [
        ...new Set(
          Object.values(courseByQual)
            .map((c) => (c?.id ? Number(c.id) : 0))
            .filter((n) => Number.isFinite(n) && n > 0)
        ),
      ];
      const courseIdToQual = new Map<number, string>();
      for (const c of Object.values(courseByQual)) {
        if (!c?.id) continue;
        const q = String(c.qualification_code ?? '').trim().toUpperCase();
        if (q) courseIdToQual.set(Number(c.id), q);
      }
      const formById = new Map(displayForms.map((f) => [Number(f.id), f]));
      if (courseIds.length > 0) {
        const { data: courseFormLinks, error: cfErr } = await supabase
          .from('skyline_course_forms')
          .select('course_id, form_id')
          .in('course_id', courseIds);
        if (cfErr) console.error('skyline_course_forms (import mapping)', cfErr);
        for (const row of (courseFormLinks as Array<{ course_id: number; form_id: number }> | null) || []) {
          const cid = Number(row.course_id);
          const fid = Number(row.form_id);
          const courseQual = courseIdToQual.get(cid);
          if (!courseQual || !Number.isFinite(fid) || fid <= 0) continue;
          const linkedForm = formById.get(fid);
          if (!linkedForm) continue;
          const unit = String((linkedForm as unknown as { unit_code?: string | null }).unit_code ?? '').trim().toUpperCase();
          if (!unit) continue;
          const pairKey = `${courseQual}${PAIR_SEP}${unit}`;
          if (!courseLinkedPairToFormIds.has(pairKey)) courseLinkedPairToFormIds.set(pairKey, new Set());
          courseLinkedPairToFormIds.get(pairKey)!.add(fid);
        }
      }

      const formQualUnit = (f: (typeof displayForms)[number]) => ({
        qual: String((f as unknown as { qualification_code?: string | null }).qualification_code ?? '').trim().toUpperCase(),
        unit: String((f as unknown as { unit_code?: string | null }).unit_code ?? '').trim().toUpperCase(),
      });

      /**
       * When both qual and unit are on the row: same form fields (strict), OR form is linked to a course whose
       * qualification_code matches the row and the form’s unit_code matches (shared forms across courses).
       */
      const matchFormIdsForImportRow = (qualCodes: string[], unitCodes: string[]): number[] => {
        const hasQ = qualCodes.length > 0;
        const hasU = unitCodes.length > 0;
        const ids: number[] = [];
        for (const f of displayForms) {
          const { qual: fq, unit: fu } = formQualUnit(f);
          const fid = Number(f.id);
          if (!Number.isFinite(fid) || fid <= 0) continue;
          if (hasQ && hasU) {
            if (fq && fu && qualCodes.includes(fq) && unitCodes.includes(fu)) ids.push(fid);
          } else if (hasU) {
            if (fu && unitCodes.includes(fu)) ids.push(fid);
          } else if (hasQ) {
            if (fq && qualCodes.includes(fq)) ids.push(fid);
          }
        }
        if (hasQ && hasU) {
          for (const q of qualCodes) {
            for (const u of unitCodes) {
              const fromCourse = courseLinkedPairToFormIds.get(`${q}${PAIR_SEP}${u}`);
              if (fromCourse) {
                for (const fid of fromCourse) {
                  if (Number.isFinite(fid) && fid > 0) ids.push(fid);
                }
              }
            }
          }
        }
        return [...new Set(ids)];
      };

      const strictPairs = new Set<string>();
      for (const r of importRows) {
        const qs = splitCodes(r.qualification_code);
        const us = splitCodes(r.unit_code);
        if (qs.length && us.length) {
          for (const q of qs) for (const u of us) strictPairs.add(`${q}${PAIR_SEP}${u}`);
        }
      }
      const pairSatisfiedByStrictOrCourse = (q: string, u: string) => {
        if (
          displayForms.some((f) => {
            const { qual: fq, unit: fu } = formQualUnit(f);
            return fq === q && fu === u;
          })
        )
          return true;
        const via = courseLinkedPairToFormIds.get(`${q}${PAIR_SEP}${u}`);
        return Boolean(via && via.size > 0);
      };
      const missingStrictPairs = [...strictPairs].filter((key) => {
        const sep = key.indexOf(PAIR_SEP);
        if (sep < 0) return true;
        const q = key.slice(0, sep);
        const u = key.slice(sep + PAIR_SEP.length);
        return !pairSatisfiedByStrictOrCourse(q, u);
      });

      const importRowsWithUnitNoQual = importRows.filter((r) => splitCodes(r.unit_code).length > 0 && splitCodes(r.qualification_code).length === 0);
      const unitCodesOnlyFromRowsNoQual = Array.from(new Set(importRowsWithUnitNoQual.flatMap((r) => splitCodes(r.unit_code))));
      const missingUnitCodes = unitCodesOnlyFromRowsNoQual.filter((c) => !unitToFormIds.get(c)?.length);

      const importRowsWithQualNoUnit = importRows.filter((r) => splitCodes(r.qualification_code).length > 0 && splitCodes(r.unit_code).length === 0);
      const qualCodesOnlyFromRowsNoUnit = Array.from(new Set(importRowsWithQualNoUnit.flatMap((r) => splitCodes(r.qualification_code))));
      const missingQualCodesForForms = qualCodesOnlyFromRowsNoUnit.filter((c) => !qualToFormIds.get(c)?.length);

      const missingCourseCodes = importQualCodes.filter((c) => !courseByQual[c]);
      if (
        missingCourseCodes.length ||
        missingUnitCodes.length ||
        missingQualCodesForForms.length ||
        missingStrictPairs.length
      ) {
        const preview = (arr: string[]) =>
          arr.length <= 12 ? arr.join(', ') : `${arr.slice(0, 12).join(', ')} … (+${arr.length - 12})`;
        const previewPairs = (arr: string[]) => {
          const lines = arr.map((k) => {
            const sep = k.indexOf(PAIR_SEP);
            if (sep < 0) return k;
            return `${k.slice(0, sep)} + ${k.slice(sep + PAIR_SEP.length)}`;
          });
          return lines.length <= 12 ? lines.join('\n') : `${lines.slice(0, 12).join('\n')}\n… (+${lines.length - 12})`;
        };
        const msg =
          `Some codes in the import file do not exist / do not map.\n\n` +
          (missingCourseCodes.length
            ? `Missing courses (Qualification Code not found in Courses):\n${preview(missingCourseCodes)}\n\n`
            : '') +
          (missingStrictPairs.length
            ? `No form matches qualification + unit (same form fields, or a form linked to a course with that qualification):\n${previewPairs(missingStrictPairs)}\n\n`
            : '') +
          (missingUnitCodes.length
            ? `Rows with unit but no qualification: no form for Unit Code(s):\n${preview(missingUnitCodes)}\n\n`
            : '') +
          (missingQualCodesForForms.length
            ? `Rows with qualification but no unit: no form for Qualification Code(s):\n${preview(missingQualCodesForForms)}\n\n`
            : '') +
          `Continue import anyway? (Students will still be created/updated, but missing mappings will skip course assignment and/or assessments.)`;
        const consent = await new Promise<boolean>((resolve) => {
          importMappingResolveRef.current = (ok: boolean) => {
            importMappingResolveRef.current = null;
            setImportMappingMessage(null);
            resolve(ok);
          };
          setImportMappingMessage(msg);
        });
        if (!consent) {
          setImporting(false);
          setImportProgress(null);
          return;
        }
      }

      // Prevent duplicates within this single import run
      const localStudentByEmail = new Map<string, Student>();
      for (const [k, v] of Object.entries(importExistingByEmail)) {
        if (v) localStudentByEmail.set(String(k).trim().toLowerCase(), v);
      }
      const localStudentByStudentId = new Map<string, Student>();
      importStudentsForPdf = [];
      importFormIdsForPdf = new Set<number>();

      // Group rows by email to reduce repeated create/update calls (more efficient).
      const rowsByEmail = new Map<string, typeof importRows>();
      for (const r of importRows) {
        const ek = String(r.email ?? '').trim().toLowerCase();
        if (!ek) continue;
        const list = rowsByEmail.get(ek) ?? [];
        list.push(r);
        rowsByEmail.set(ek, list);
      }

      let done = 0;
      for (const [emailKey, rows] of rowsByEmail.entries()) {
        const firstRow = rows[0];
        const first = String(firstRow.first_name ?? '').trim();
        const email = String(firstRow.email ?? '').trim();
        if (!first || !email) {
          failed += rows.length;
          done += rows.length;
          setImportProgress({ done, total: importRows.length, success, failed });
          continue;
        }

        const existingStudent = localStudentByEmail.get(emailKey) ?? importExistingByEmail[emailKey];
        const candidateStudentId =
          String(firstRow.student_id ?? '').trim() ||
          (email.includes('@') ? email.split('@')[0] : `${(first + '.' + String(firstRow.last_name ?? '')).toLowerCase().replace(/\s+/g, '.')}`);
        const candidateIdKey = candidateStudentId.replace(/\s+/g, '').trim();
        const batchId = importBatchId ? Number(importBatchId) : null;
        let student: Student | null = existingStudent ?? null;
        if (!student && candidateIdKey) student = localStudentByStudentId.get(candidateIdKey) ?? null;

        if (student == null) {
          const created = await createStudent({
            student_id: candidateIdKey,
            first_name: first,
            last_name: String(firstRow.last_name ?? ''),
            email,
            phone: String(firstRow.phone ?? '') || undefined,
            batch_id: batchId && Number.isFinite(batchId) ? batchId : undefined,
          });
          if (!created) {
            failed += rows.length;
            done += rows.length;
            setImportProgress({ done, total: importRows.length, success, failed });
            continue;
          }
          student = created;
        } else {
          const decision = importIdDecisionByEmail[emailKey] ?? 'keep_existing';
          const studentIdToSet = decision === 'use_new' ? candidateStudentId : (student.student_id ?? candidateStudentId);
          const updated = await updateStudent(student.id, {
            student_id: studentIdToSet,
            first_name: first,
            last_name: String(firstRow.last_name ?? ''),
            phone: String(firstRow.phone ?? '') || undefined,
            batch_id: batchId && Number.isFinite(batchId) ? batchId : undefined,
          });
          if (updated) student = updated;
        }

        if (!student?.id) {
          failed += rows.length;
          done += rows.length;
          setImportProgress({ done, total: importRows.length, success, failed });
          continue;
        }
        localStudentByEmail.set(emailKey, student);
        if (candidateIdKey) localStudentByStudentId.set(candidateIdKey, student);

        // Assign course(s) from ALL qualification codes across this student's rows.
        const allQualCodes = Array.from(new Set(rows.flatMap((r) => splitCodes(r.qualification_code))));
        const courseIds = allQualCodes
          .map((c) => courseByQual[c]?.id)
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
        if (courseIds.length > 0) {
          await setStudentCourses(student.id, courseIds);
        }

        // Process each row's assessments (unit/qualification mapping) and dates.
        for (const row of rows) {
          const unitCodes = splitCodes(row.unit_code);
          const qualCodes = splitCodes(row.qualification_code);
          const matchedFormIds = matchFormIdsForImportRow(qualCodes, unitCodes);
          const start = String(row.activity_start_date ?? '').trim();
          const end = String(row.activity_end_date ?? '').trim();
          if (matchedFormIds.length > 0) {
            for (const formId of matchedFormIds) {
              if (!Number.isFinite(formId) || formId <= 0) continue;
              importFormIdsForPdf.add(formId);
              const existing = await getInstanceForStudentAndForm(formId, student.id);
              if (!existing) {
                const created = await createFormInstance(formId, 'student', student.id, {
                  start_date: start || null,
                  end_date: end || null,
                });
                if (created?.id && end) await extendInstanceAccessTokensToDate(created.id, 'student', end);
              } else {
                await updateFormInstanceDates(existing.id, { start_date: start || null, end_date: end || null });
                if (end) await extendInstanceAccessTokensToDate(existing.id, 'student', end);
              }
            }
          }

          done++;
          success++;
          setImportProgress({ done, total: importRows.length, success, failed });
        }

        importStudentsForPdf.push({
          id: student.id,
          name: [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || student.email,
          email: student.email,
        });
      }

      // Close out progress + UI state
      setImporting(false);
      setImportProgress(null);
    } catch (e) {
      console.error('handleBulkImport error', e);
      setImporting(false);
      setImportProgress(null);
      setImportResultModal({
        title: 'Import error',
        error: true,
        message:
          'Import stopped due to an error. Some rows may have been processed.\n\nClick OK to close this message and the import dialog.',
      });
      return;
    }

    if (success > 0) {
      setCurrentPage(1);
      const res = await listStudentsPaged(1, PAGE_SIZE, searchTerm, statusFilter || undefined);
      setStudents(res.data);
      setTotalStudents(res.total);
      const createdAtIso = new Date().toISOString();
      const bid = importBatchId ? Number(importBatchId) : null;
      const uniqueStudents = Array.from(
        new Map(importStudentsForPdf.map((s: { id: number; name: string; email: string }) => [s.id, s] as const)).values()
      );
      const formsForPdf = Array.from(importFormIdsForPdf).map((fid) => {
        const f = displayForms.find((x) => Number(x.id) === fid);
        return {
          id: Number(fid),
          name: f?.name ?? `Form #${fid}`,
          version: (f as unknown as { version?: string | null } | undefined)?.version ?? null,
          url: `${window.location.origin}/forms/${fid}/student-access`,
        };
      });
      setLastImportLinksPayload({
        createdAtIso,
        batchId: bid && Number.isFinite(bid) ? bid : null,
        forms: formsForPdf,
        students: uniqueStudents as Array<{ id: number; name: string; email: string }>,
      });
    }

    let summary = 'Import complete.\n\n';
    if (success > 0) {
      summary += `${success} row${success !== 1 ? 's' : ''} imported successfully.`;
      if (failed > 0) summary += `\n${failed} row${failed !== 1 ? 's' : ''} failed.`;
      summary += '\n\nUse "Download import PDF" on the Students page when you need generic assessment links.';
    } else if (failed > 0) {
      summary += `No rows were imported successfully. ${failed} row${failed !== 1 ? 's' : ''} failed.\n\nCheck duplicate emails, Student IDs, or required fields.`;
    } else {
      summary += 'No rows were processed.';
    }
    summary += '\n\nClick OK to close the import dialog.';
    setImportResultModal({
      title: success > 0 ? 'Import complete' : failed > 0 ? 'Import finished' : 'Import complete',
      message: summary,
      error: success === 0 && failed > 0,
    });
  };

  const downloadLastImportPdf = async () => {
    if (!lastImportLinksPayload) return;
    const bid = lastImportLinksPayload.batchId;
    const batchName = bid ? `Batch #${bid}` : 'No batch';
    await registerPdfFonts();
    const doc = (
      <GenericLinksPdf
        title="Student import – generic links"
        courseName=""
        batchName={batchName}
        createdAtIso={lastImportLinksPayload.createdAtIso}
        forms={lastImportLinksPayload.forms}
        students={lastImportLinksPayload.students}
      />
    );
    const asPdf = pdf(doc);
    const blob = await asPdf.toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-import-links-${(bid ? `batch-${bid}` : 'no-batch')}-${lastImportLinksPayload.createdAtIso.slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Assessment creation moved to Student Details page ("Add Assessment" dialog).

  const editingStudent = useMemo(() => (editingId ? students.find((s) => s.id === editingId) : null), [editingId, students]);
  const [editForm, setEditForm] = useState<{
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    email_domain: InstitutionalDomain;
    phone: string;
    batch_id: string;
    course_ids: number[];
    status: string;
  } | null>(null);
  const [editCourseLoading, setEditCourseLoading] = useState(false);

  useEffect(() => {
    if (editingStudent) {
      const email = editingStudent.email || editingStudent.student_id || '';
      const domain = getInstitutionalDomainFromEmail(email) ?? STUDENT_DOMAIN;
      setEditForm({
        student_id: editingStudent.student_id ?? '',
        first_name: editingStudent.first_name ?? '',
        last_name: editingStudent.last_name ?? '',
        email_local: getEmailLocalPartForEdit(email),
        email_domain: domain,
        phone: editingStudent.phone ?? '',
        batch_id: editingStudent.batch_id != null ? String(editingStudent.batch_id) : '',
        course_ids: [],
        status: editingStudent.status ?? 'active',
      });
    } else {
      setEditForm(null);
    }
  }, [editingStudent]);

  useEffect(() => {
    if (!editingStudent?.id) return;
    setEditCourseLoading(true);
    supabase
      .from('skyline_student_courses')
      .select('course_id')
      .eq('student_id', editingStudent.id)
      .eq('status', 'active')
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        setEditCourseLoading(false);
        if (error) return;
        const ids = ((data as Array<{ course_id: number }> | null) || [])
          .map((r) => Number(r.course_id))
          .filter((n) => Number.isFinite(n) && n > 0);
        setEditForm((p) => (p ? { ...p, course_ids: Array.from(new Set(ids)) } : p));
      });
  }, [editingStudent?.id]);

  const handleSaveEdit = async () => {
    if (!editingId || !editForm) return;
    const formError = validateEditStudentForm(editForm);
    if (formError) {
      toast.error(formError);
      return;
    }
    const batchId = editForm.batch_id ? (Number(editForm.batch_id) || null) : null;
    setSavingEdit(true);
    const email = buildEmailFromLocalAndDomain(
      editForm.email_local?.trim() || editForm.student_id,
      editForm.email_domain
    );
    const updated = await updateStudent(editingId, {
      student_id: editForm.student_id,
      first_name: editForm.first_name,
      last_name: editForm.last_name || undefined,
      phone: editForm.phone || undefined,
      email,
      batch_id: batchId ?? undefined,
      status: editForm.status,
    });
    if (updated) {
      await setStudentCourses(updated.id, editForm.course_ids);
    }
    setSavingEdit(false);
    if (updated) {
      const res = await listStudentsPaged(currentPage, PAGE_SIZE, searchTerm, statusFilter || undefined);
      setStudents(res.data);
      setTotalStudents(res.total);
      setEditingId(null);
      toast.success('Student updated');
    } else {
      toast.error('Failed to update student');
    }
  };

  const validateEditStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    phone: string;
    batch_id?: string;
    course_ids?: number[];
  }): string | null => {
    if (!String(form.student_id ?? '').trim()) return 'Student ID is required.';
    if (!String(form.first_name ?? '').trim()) return 'First name is required.';
    const courseIds = Array.isArray(form.course_ids) ? form.course_ids : [];
    if (courseIds.filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).length === 0) return 'Select at least one course.';
    const email = buildEmailFromLocalAndDomain(
      form.email_local?.trim() || form.student_id,
      (form as { email_domain?: typeof STUDENT_DOMAIN }).email_domain ?? STUDENT_DOMAIN
    );
    if (!email) return 'Email local part (or Student ID) is required.';
    if (/\s/.test((form.student_id ?? '').trim())) return 'Student ID cannot contain spaces.';
    if (form.phone && !/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits when provided.';
    return null;
  };

  const createFormError = useMemo(() => validateCreateStudentForm(studentDraft), [studentDraft]);
  const editFormError = useMemo(() => (editForm ? validateEditStudentForm(editForm) : null), [editForm]);
  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Students</h2>
              <p className="text-sm text-gray-600 mt-1">Manage learner profiles and send form links. Students must be in a batch.</p>
              {!hasBatches && <p className="text-amber-600 text-sm mt-1">Create batches first (Batches page).</p>}
            </div>
            <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="text-sm text-gray-600 shrink-0">Status:</span>
                <Select
                  value={statusFilter}
                  onChange={(v) => {
                    setStatusFilter(v as '' | 'active' | 'inactive');
                    setCurrentPage(1);
                  }}
                  options={STATUS_FILTER_OPTIONS}
                  className="min-w-0 w-full sm:min-w-[120px] sm:w-[140px]"
                />
                <Input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search..."
                  className="w-full min-w-0 sm:w-48 sm:shrink-0"
                />
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                <Button onClick={() => setIsCreateOpen(true)} disabled={!hasBatches} className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2 inline" />
                  Add Student
                </Button>
                <Button variant="outline" onClick={() => { setIsImportOpen(true); setImportRows([]); setImportFileName(''); }} disabled={!hasBatches} className="w-full sm:w-auto">
                  <Upload className="w-4 h-4 mr-2 inline" />
                  Import Students
                </Button>
                {lastImportLinksPayload && (
                  <Button
                    variant="outline"
                    onClick={() => void downloadLastImportPdf()}
                    className="w-full sm:w-auto"
                    title="Download generic links PDF from last import"
                  >
                    <FileText className="w-4 h-4 mr-2 inline" />
                    Download import PDF
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Student Directory</h2>
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
            <>
              <div className="space-y-3 lg:hidden">
                {students.map((student) => (
                  <div
                    key={student.id}
                    className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700">
                        {`${student.first_name?.[0] ?? ''}${student.last_name?.[0] ?? ''}`.toUpperCase() || (student.first_name?.[0] ?? student.email?.[0] ?? 'S').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/students/${student.id}`)}
                          className="text-left font-semibold text-blue-600 break-words hover:underline"
                          title="View student details"
                        >
                          {[student.first_name, student.last_name].filter(Boolean).join(' ') || student.email}
                        </button>
                        <div className="text-xs text-gray-500">ID: {student.student_id || '—'}</div>
                        <div className="mt-2 text-sm text-gray-700 break-words">
                          <span className="font-medium text-gray-600">Batch: </span>
                          {student.batch_name ?? '—'}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              (student.status || 'active') === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {student.status || 'active'}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">Created {formatCreatedDisplay(student.created_at)}</div>
                        <div className="mt-2 space-y-1 text-sm text-gray-700 break-all">
                          <div className="flex items-start gap-2">
                            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            <span>{student.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                            <span>{student.phone || 'No phone'}</span>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                          <span className="font-medium text-gray-600">Course: </span>
                          {(() => {
                            const list = studentCoursesMap[student.id] || [];
                            if (list.length === 0) return <span>—</span>;
                            const first = list[0];
                            const rest = list.length - 1;
                            return (
                              <span>
                                {first.qualification_code ? `${first.qualification_code} — ` : ''}
                                {first.name}
                                {rest > 0 ? ` (+${rest})` : ''}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-center sm:w-auto"
                            onClick={() => setEditingId(student.id)}
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-center sm:w-auto"
                            onClick={() => navigate(`/admin/students/${student.id}`)}
                          >
                            <Send className="mr-1 h-4 w-4" />
                            Details
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[1080px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Student</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Batch</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Course</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Status</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-[110px] whitespace-nowrap">Created</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Contact</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 font-semibold flex items-center justify-center">
                            {`${student.first_name?.[0] ?? ''}${student.last_name?.[0] ?? ''}`.toUpperCase() || (student.first_name?.[0] ?? student.email?.[0] ?? 'S').toUpperCase()}
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => navigate(`/admin/students/${student.id}`)}
                              className="text-left font-semibold text-blue-600 hover:underline"
                              title="View student details"
                            >
                              {[student.first_name, student.last_name].filter(Boolean).join(' ') || student.email}
                            </button>
                            <div className="text-xs text-gray-500">Student ID: {student.student_id || '-'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <span className="text-gray-700">{student.batch_name ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="text-gray-700 break-words">
                          {(() => {
                            const list = studentCoursesMap[student.id] || [];
                            if (list.length === 0) return '—';
                            const first = list[0];
                            const rest = list.length - 1;
                            return `${first.qualification_code ? `${first.qualification_code} — ` : ''}${first.name}${rest > 0 ? ` (+${rest})` : ''}`;
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            (student.status || 'active') === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {student.status || 'active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700 whitespace-nowrap">
                        {formatCreatedDisplay(student.created_at)}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-gray-700">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span>{student.email}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-700">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <span>{student.phone || 'No phone'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(student.id)}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[96px] whitespace-nowrap"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/admin/students/${student.id}`)}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[110px] whitespace-nowrap"
                          >
                            <Send className="w-4 h-4" />
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
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

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add Student" size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="md:col-span-2">
              <Input
                label="Student ID"
                value={studentDraft.student_id}
                onChange={(e) => {
                  const v = e.target.value;
                  setStudentDraft((p) => {
                    const syncEmail = !p.email_local || p.email_local === p.student_id;
                    return { ...p, student_id: v, email_local: syncEmail ? v : p.email_local };
                  });
                }}
                placeholder="Student ID *"
                required
              />
            </div>
            <Input
              label="First Name"
              value={studentDraft.first_name}
              onChange={(e) => setStudentDraft((p) => ({ ...p, first_name: e.target.value }))}
              placeholder="First name *"
              required
            />
            <Input
              label="Last Name"
              value={studentDraft.last_name}
              onChange={(e) => setStudentDraft((p) => ({ ...p, last_name: e.target.value }))}
              placeholder="Last name"
            />
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Course *</label>
              <MultiSelectAsync
                value={studentDraft.course_ids}
                onChange={(vals) => setStudentDraft((p) => ({ ...p, course_ids: vals }))}
                loadOptions={loadCoursesOptions}
                placeholder="Select course(s)"
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">A student can be assigned to multiple courses.</p>
            </div>
            <div className="md:col-span-2">
              <EmailWithDomainPicker
                label="Email"
                localPart={studentDraft.email_local || studentDraft.student_id}
                onLocalPartChange={(v) => setStudentDraft((p) => ({ ...p, email_local: v }))}
                domain={studentDraft.email_domain}
                onDomainChange={(d) => setStudentDraft((p) => ({ ...p, email_domain: d }))}
                placeholder="Student ID or e.g. firstname.lastname"
              />
            </div>
            <Input
              value={studentDraft.phone}
              onChange={(e) => setStudentDraft((p) => ({ ...p, phone: digitsOnly(e.target.value).slice(0, 10) }))}
              placeholder="Phone"
            />
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Batch</label>
              <SelectAsync
                value={studentDraft.batch_id}
                onChange={(v) => setStudentDraft((p) => ({ ...p, batch_id: v }))}
                loadOptions={loadBatchesOptions}
                placeholder="Select batch"
                className="w-full"
              />
            </div>
            <div className="md:col-span-2">
              <Select
                value={studentDraft.status}
                onChange={(v) => setStudentDraft((p) => ({ ...p, status: v as 'active' | 'inactive' }))}
                options={STATUS_OPTIONS}
                label="Status"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !!createFormError}>
              {creating ? (
                <>
                  <Loader variant="dots" size="sm" inline className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2 inline" />
                  Add Student
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Assessment creation moved to Student Details page ("Add Assessment" dialog). */}

      <Modal
        isOpen={isImportOpen}
        onClose={() => {
          if (importing) {
            toast.error('Import is running. Please wait until it finishes.');
            return;
          }
          setIsImportOpen(false);
        }}
        title="Import Students"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload a CSV or XLSX file with columns: <strong>Given Name</strong>, <strong>Surname</strong> (optional), <strong>Email Address</strong>, <strong>Mobile Phone</strong>, <strong>Qualification Code</strong>, <strong>Activity Start Date</strong>, <strong>Activity End Date</strong>, <strong>Student ID</strong>, <strong>Unit Code</strong>.
          </p>
          {importing && importProgress && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-amber-900">Importing…</div>
                <div className="text-xs text-amber-800">
                  {importProgress.done}/{importProgress.total} rows · {importProgress.success} ok · {importProgress.failed} failed
                </div>
              </div>
              <div className="mt-2">
                <div className="h-2 w-full rounded bg-amber-100 overflow-hidden">
                  <div
                    className="h-2 bg-amber-500"
                    style={{
                      width: `${importProgress.total > 0 ? Math.min(100, Math.round((importProgress.done / importProgress.total) * 100)) : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-amber-800">
                  Don’t refresh/close the tab — it will stop the import mid-way.
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer inline-flex">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleImportFileChange}
                className="sr-only"
                disabled={importing}
              />
              <span className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg border-2 border-[var(--border)] bg-white text-gray-700 hover:bg-gray-50 min-h-[40px]">
                <Upload className="w-4 h-4" />
                Choose file
              </span>
            </label>
            {importFileName && (
              <span className="text-sm text-gray-600">{importFileName} — {importRows.length} row{importRows.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {importRows.length > 0 && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assign to batch (optional)</label>
                <SelectAsync
                  value={importBatchId}
                  onChange={(v) => setImportBatchId(v)}
                  loadOptions={loadBatchesOptionsWithNone}
                  placeholder="Select batch (optional)"
                  className="w-full max-w-[300px]"
                />
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-600 font-medium">Duplicates / ID changes</div>
                <div className="text-xs text-gray-500 mt-1">
                  If a student with the same email already exists, you can choose whether to keep their current Student ID or replace it with the new one from the file.
                </div>
              </div>
              <p className="text-xs text-gray-500">Edit records before importing. Remove rows you don&apos;t want.</p>
              <div className="max-h-[320px] overflow-x-auto overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm table-auto min-w-[1900px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold">First Name</th>
                      <th className="text-left px-2 py-2 font-semibold">Last Name</th>
                      <th className="text-left px-2 py-2 font-semibold">Email</th>
                      <th className="text-left px-2 py-2 font-semibold">Phone</th>
                      <th className="text-left px-2 py-2 font-semibold">Qualification Code</th>
                      <th className="text-left px-2 py-2 font-semibold">Activity Start</th>
                      <th className="text-left px-2 py-2 font-semibold">Activity End</th>
                      <th className="text-left px-2 py-2 font-semibold">If exists</th>
                      <th className="w-10 px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((r, i) => (
                      (() => {
                        const emailKey = String(r.email ?? '').trim().toLowerCase();
                        const existing = importExistingByEmail[emailKey];
                        const candidateId = (r.student_id ?? '').trim() || (r.email?.includes('@') ? r.email.split('@')[0] : '');
                        const existingId = (existing?.student_id ?? '').trim();
                        const hasConflict = !!existing && !!candidateId && !!existingId && candidateId !== existingId;
                        const decision = importIdDecisionByEmail[emailKey] ?? 'keep_existing';
                        return (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.first_name}
                            onChange={(e) => updateImportRow(i, 'first_name', e.target.value)}
                            placeholder="First name"
                            className="text-sm py-1.5 min-h-0 w-[220px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.last_name}
                            onChange={(e) => updateImportRow(i, 'last_name', e.target.value)}
                            placeholder="Last name"
                            className="text-sm py-1.5 min-h-0 w-[220px]"
                          />
                        </td>
                        <td className="px-2 py-1.5 min-w-[140px]">
                          <Input
                            value={r.email}
                            onChange={(e) => updateImportRow(i, 'email', e.target.value)}
                            placeholder="Email"
                            className="text-sm py-1.5 min-h-0 w-[360px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.phone}
                            onChange={(e) => updateImportRow(i, 'phone', e.target.value)}
                            placeholder="Phone"
                            className="text-sm py-1.5 min-h-0 w-[160px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.qualification_code ?? ''}
                            onChange={(e) => updateImportRow(i, 'qualification_code', e.target.value)}
                            placeholder="Qualification code"
                            className="text-sm py-1.5 min-h-0 w-[220px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.activity_start_date ?? ''}
                            onChange={(e) => updateImportRow(i, 'activity_start_date', e.target.value)}
                            placeholder="YYYY-MM-DD"
                            className="text-sm py-1.5 min-h-0 w-[200px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.activity_end_date ?? ''}
                            onChange={(e) => updateImportRow(i, 'activity_end_date', e.target.value)}
                            placeholder="YYYY-MM-DD"
                            className="text-sm py-1.5 min-h-0 w-[200px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {!existing ? (
                            <span className="text-xs text-gray-500">New</span>
                          ) : !hasConflict ? (
                            <span className="text-xs text-emerald-700">Exists</span>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-[11px] text-amber-700">
                                ID differs: <span className="font-medium">{existingId}</span> → <span className="font-medium">{candidateId}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
                                  <input
                                    type="radio"
                                    name={`id-decision-${i}`}
                                    checked={decision === 'keep_existing'}
                                    onChange={() => setImportIdDecisionByEmail((p) => ({ ...p, [emailKey]: 'keep_existing' }))}
                                  />
                                  Keep
                                </label>
                                <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
                                  <input
                                    type="radio"
                                    name={`id-decision-${i}`}
                                    checked={decision === 'use_new'}
                                    onChange={() => setImportIdDecisionByEmail((p) => ({ ...p, [emailKey]: 'use_new' }))}
                                  />
                                  Use new
                                </label>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeImportRow(i)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                        );
                      })()
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                {lastImportLinksPayload && (
                  <Button variant="outline" onClick={() => void downloadLastImportPdf()}>
                    <FileText className="w-4 h-4 mr-2 inline" />
                    Download PDF
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    if (importing) {
                      toast.error('Import is running. Please wait until it finishes.');
                      return;
                    }
                    setIsImportOpen(false);
                  }}
                  disabled={importing}
                >
                  Close
                </Button>
                <Button
                  onClick={handleBulkImport}
                  disabled={importing}
                >
                  {importing ? (
                    <>
                      <Loader variant="dots" size="sm" inline className="mr-2" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2 inline" />
                      Import {importRows.length} student{importRows.length !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={!!importMappingMessage}
        onClose={() => importMappingResolveRef.current?.(false)}
        title="Check import mappings"
        size="md"
        overlayClassName="!z-[60]"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 whitespace-pre-line">{importMappingMessage}</p>
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button type="button" variant="outline" onClick={() => importMappingResolveRef.current?.(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => importMappingResolveRef.current?.(true)}>
              Continue import
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!importResultModal}
        onClose={dismissImportResult}
        title={importResultModal?.title ?? 'Import'}
        size="md"
        overlayClassName="!z-[60]"
      >
        {importResultModal && (
          <div className="space-y-4">
            <p
              className={`text-sm whitespace-pre-line ${importResultModal.error ? 'text-red-800' : 'text-gray-700'}`}
            >
              {importResultModal.message}
            </p>
            <div className="flex justify-end border-t border-[var(--border)] pt-4">
              <Button type="button" onClick={dismissImportResult}>
                OK
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {editingId && editForm && (
        <Modal isOpen={!!editingId} onClose={() => setEditingId(null)} title="Edit Student" size="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={editForm.student_id}
                onChange={(e) => setEditForm((p) => p ? { ...p, student_id: e.target.value } : p)}
                placeholder="Student ID *"
                required
              />
              <Input
                value={editForm.first_name}
                onChange={(e) => setEditForm((p) => p ? { ...p, first_name: e.target.value } : p)}
                placeholder="First name *"
                required
              />
              <Input
                value={editForm.last_name}
                onChange={(e) => setEditForm((p) => p ? { ...p, last_name: e.target.value } : p)}
                placeholder="Last name"
              />
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Course *</label>
                <MultiSelectAsync
                  value={editForm.course_ids}
                  onChange={(vals) => setEditForm((p) => (p ? { ...p, course_ids: vals } : p))}
                  loadOptions={loadCoursesOptions}
                  placeholder={editCourseLoading ? 'Loading courses…' : 'Select course(s)'}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">A student can be assigned to multiple courses.</p>
              </div>
              <div className="md:col-span-2">
                <EmailWithDomainPicker
                  label="Email"
                  localPart={editForm?.email_local ?? ''}
                  onLocalPartChange={(v) => setEditForm((p) => p ? { ...p, email_local: v } : p)}
                  domain={editForm?.email_domain ?? STUDENT_DOMAIN}
                  onDomainChange={(d) => setEditForm((p) => p ? { ...p, email_domain: d } : p)}
                  placeholder="Student ID or e.g. firstname.lastname"
                />
              </div>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p)}
                placeholder="Phone"
              />
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Batch</label>
                <SelectAsync
                  value={editForm.batch_id}
                  onChange={(v) => setEditForm((p) => (p ? { ...p, batch_id: v } : p))}
                  loadOptions={loadBatchesOptionsWithNone}
                  placeholder="Select batch (optional)"
                  selectedLabel={editingStudent?.batch_name ?? undefined}
                  className="w-full"
                />
              </div>
              <div className="md:col-span-2">
                <Select
                  value={editForm.status}
                  onChange={(v) => setEditForm((p) => (p ? { ...p, status: v } : p))}
                  options={STATUS_OPTIONS}
                  label="Status"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !!editFormError}>
                {savingEdit ? (
                  <>
                    <Loader variant="dots" size="sm" inline className="mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
};
