import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, GripVertical, Trash2, ImagePlus, Copy, MoreVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { fetchForm, fetchFormSteps, updateForm, ensureTaskSectionsForForm, formNameExists } from '../lib/formEngine';
import { uploadFormCoverImage, uploadRowImage } from '../lib/storage';
import type { Form, FormStep, FormSection, FormQuestion, Json } from '../types/database';
import { Card } from '../components/ui/Card';
import { Loader } from '../components/ui/Loader';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Textarea } from '../components/ui/Textarea';
import { Checkbox } from '../components/ui/Checkbox';
import { TaskInstructionsModal, type TaskInstructionsData } from '../components/form-fill/TaskInstructionsModal';
import { SectionInstructionsEditor } from '../components/form-fill/SectionInstructionsEditor';
import { DatePicker } from '../components/ui/DatePicker';
import { cn } from '../components/utils/cn';

const FLUSH_PENDING_EVENT = 'form-builder:flush-pending';

const QUESTION_TYPES = [
  { value: 'instruction_block', label: 'Instruction Block' },
  { value: 'short_text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'yes_no', label: 'Yes/No' },
  { value: 'single_choice', label: 'Single Choice' },
  { value: 'multi_choice', label: 'Multi Choice' },
  { value: 'likert_5', label: 'Likert 5' },
  { value: 'grid_table', label: 'Grid Table' },
  { value: 'date', label: 'Date' },
  { value: 'signature', label: 'Signature' },
  { value: 'page_break', label: 'Page Break' },
];

const ROLES = [
  { value: 'student', label: 'Student' },
  { value: 'trainer', label: 'Trainer' },
  { value: 'office', label: 'Office' },
];

type GridColumnType = 'question' | 'answer';

interface GridTableColumnMeta {
  label: string;
  type: GridColumnType;
}

const GRID_COLUMN_TYPE_OPTIONS = [
  { value: 'answer', label: 'Answer (user input)' },
  { value: 'question', label: 'Question (row description)' },
];

function normalizeGridColumnType(raw: unknown): GridColumnType {
  return String(raw).trim().toLowerCase() === 'question' ? 'question' : 'answer';
}

function normalizeWordLimit(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getGridColumnsMeta(pm: Record<string, unknown>): GridTableColumnMeta[] {
  const rawMeta = pm.columnsMeta;
  if (Array.isArray(rawMeta)) {
    const parsed = rawMeta
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const label = String(e.label ?? '').trim();
        if (!label) return null;
        return { label, type: normalizeGridColumnType(e.type) } as GridTableColumnMeta;
      })
      .filter(Boolean) as GridTableColumnMeta[];
    if (parsed.length > 0) return parsed;
  }

  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : ['Column 1', 'Column 2'];
  const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
  return columns
    .map((c, idx) => {
      const label = String(c ?? '').trim();
      if (!label) return null;
      return {
        label,
        type: normalizeGridColumnType(types[idx]),
      } as GridTableColumnMeta;
    })
    .filter(Boolean) as GridTableColumnMeta[];
}

function withGridColumnsMeta(pm: Record<string, unknown>, columnsMeta: GridTableColumnMeta[]): Json {
  const existingLimitsRaw = Array.isArray(pm.columnWordLimits) ? (pm.columnWordLimits as unknown[]) : [];
  const normalized = columnsMeta
    .map((c) => ({ label: String(c.label || '').trim(), type: normalizeGridColumnType(c.type) }))
    .filter((c) => c.label.length > 0);
  return {
    ...pm,
    columnsMeta: normalized,
    // keep legacy fields synced for backward compatibility
    columns: normalized.map((c) => c.label),
    columnTypes: normalized.map((c) => c.type),
    columnWordLimits: normalized.map((_, idx) => normalizeWordLimit(existingLimitsRaw[idx])),
  } as Json;
}

// Prebuilt sections: can be reordered but not deleted (steps 5-20)
const PREBUILT_SECTION_TITLES = [
  'Student and trainer details',
  'Qualification and unit of competency',
  'Assessment Tasks',
  'Assessment Submission Method',
  'Student declaration',
  'Instructions to complete the outcomes of assessment',
  'Unit Requirements',
  'Feedback to student',
  'Plagiarism',
  'Collusion',
  'Competency outcome',
  'Additional evidence',
  'Reassessment',
  'Fail to complete by due date',
  'Reasonable Adjustment',
  'Confidentiality',
  'Assessment appeals process',
  'Recognised prior learning',
  'Special needs',
];

function isPrebuiltSection(title: string): boolean {
  return PREBUILT_SECTION_TITLES.includes(title);
}

function isPrebuiltQuestion(question: FormQuestion): boolean {
  const code = question.code || '';
  return ['student.', 'trainer.', 'qualification.', 'unit.', 'assessment.', 'reasonable_adjustment.'].some((p) => code.startsWith(p));
}

interface StepWithSections extends FormStep {
  sections: (FormSection & { questions: FormQuestion[] })[];
}

function SortableStepItem({
  step,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  menuOpen,
  onMenuToggle,
  menuRef,
}: {
  step: StepWithSections;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (title: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `step-${step.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1 p-2 rounded-lg cursor-pointer border transition-colors group',
        isSelected ? 'border-[var(--brand)] bg-orange-50' : 'border-transparent hover:bg-gray-100',
        isDragging && 'opacity-50'
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        className="p-0.5 rounded hover:bg-gray-200 cursor-grab active:cursor-grabbing touch-none"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-gray-500" />
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              onUpdate(title);
              setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="font-medium text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {step.title}
          </div>
        )}
      </div>
      <div ref={menuOpen ? menuRef : undefined} className="relative flex shrink-0 items-center">
        <button
          type="button"
          data-step-menu-trigger
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded hover:bg-gray-100 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle();
          }}
          aria-label="More options"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-0.5 z-20 min-w-[120px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg"
            role="menu"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-gray-100"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
                onMenuToggle();
              }}
              role="menuitem"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded hover:bg-red-100 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove step"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

const PDF_RENDER_MODES = [
  { value: 'normal', label: 'Details Table' },
  { value: 'likert_table', label: 'Likert Table' },
  { value: 'grid_table', label: 'Grid Table' },
  { value: 'assessment_tasks', label: 'Assessment Tasks' },
  { value: 'assessment_submission', label: 'Assessment Submission' },
  { value: 'reasonable_adjustment', label: 'Reasonable Adjustment' },
  { value: 'declarations', label: 'Declarations' },
  { value: 'task_instructions', label: 'Task Instructions' },
  { value: 'task_questions', label: 'Task Questions' },
  { value: 'task_results', label: 'Task Results' },
  { value: 'assessment_summary', label: 'Assessment Summary Sheet' },
];

interface AssessmentTaskRow {
  id: number;
  row_label: string;
}

function SortableSectionItem({
  section,
  isSelected,
  onSelect,
  onUpdate,
  onPdfModeChange,
  onAssessmentTaskRowChange,
  onRemove,
  onDuplicate,
  menuOpen,
  onMenuToggle,
  menuRef,
  canDelete = true,
  assessmentTaskRows = [],
}: {
  section: FormSection & { questions: FormQuestion[] };
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (title: string) => void;
  onPdfModeChange: (mode: string) => void;
  onAssessmentTaskRowChange?: (rowId: number | null) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  canDelete?: boolean;
  assessmentTaskRows?: AssessmentTaskRow[];
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `section-${section.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1 p-2 rounded-lg cursor-pointer border transition-colors group',
        isSelected ? 'border-[var(--brand)] bg-orange-50' : 'border-transparent hover:bg-gray-100',
        isDragging && 'opacity-50'
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        className="p-0.5 rounded hover:bg-gray-200 cursor-grab active:cursor-grabbing touch-none shrink-0"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-gray-500" />
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              onUpdate(title);
              setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {section.title}
          </div>
        )}
        {isSelected && (
          <div onClick={(e) => e.stopPropagation()} className="mt-2 space-y-2 w-full min-w-0">
            <Select
              value={section.pdf_render_mode}
              onChange={onPdfModeChange}
              options={PDF_RENDER_MODES}
            />
            {(section.pdf_render_mode === 'task_instructions' || section.pdf_render_mode === 'task_questions' || section.pdf_render_mode === 'task_results') && assessmentTaskRows.length > 0 && (
              <Select
                label="Link to task"
                value={String((section as { assessment_task_row_id?: number | null }).assessment_task_row_id ?? '')}
                onChange={(v) => onAssessmentTaskRowChange?.(v ? Number(v) : null)}
                options={[{ value: '', label: '— Select task —' }, ...assessmentTaskRows.map((r) => ({ value: String(r.id), label: r.row_label }))]}
              />
            )}
          </div>
        )}
      </div>
      <div ref={menuOpen ? menuRef : undefined} className="relative flex shrink-0 items-center">
        <button
          type="button"
          data-section-menu-trigger
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded hover:bg-gray-100 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle();
          }}
          aria-label="More options"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-0.5 z-20 min-w-[120px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg"
            role="menu"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-gray-100"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
                onMenuToggle();
              }}
              role="menuitem"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
          </div>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded hover:bg-red-100 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove section"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function SortableQuestionItem({
  question,
  isSelected,
  onSelect,
  onRemove,
  canDelete = true,
}: {
  question: FormQuestion;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  canDelete?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `question-${question.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1 p-2 rounded-lg cursor-pointer border text-sm transition-colors group',
        isSelected ? 'border-[var(--brand)] bg-orange-50' : 'border-transparent hover:bg-gray-100',
        isDragging && 'opacity-50'
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        className="p-0.5 rounded hover:bg-gray-200 cursor-grab active:cursor-grabbing touch-none shrink-0"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-gray-500" />
      </button>
      <div className="flex-1 min-w-0 truncate">
        {question.label || question.type}
      </div>
      {canDelete && (
        <button
          type="button"
          className="p-0.5 rounded hover:bg-red-100 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove question"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export const AdminFormBuilderPage: React.FC = () => {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm] = useState<Form | null>(null);
  const [steps, setSteps] = useState<StepWithSections[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ type: 'step' | 'section' | 'question'; id: number } | null>(null);
  const [assessmentTaskRows, setAssessmentTaskRows] = useState<AssessmentTaskRow[]>([]);
  const [openStepMenuId, setOpenStepMenuId] = useState<number | null>(null);
  const [openSectionMenuId, setOpenSectionMenuId] = useState<number | null>(null);
  const stepMenuRef = useRef<HTMLDivElement | null>(null);
  const sectionMenuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  const lastSavedFormNameRef = useRef<string>('');
  const questionPendingUpdates = useRef<Record<number, Partial<FormQuestion>>>({});
  const questionSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const questionBlurSavePromise = useRef<Promise<void> | null>(null);
  const QUESTION_SAVE_DEBOUNCE_MS = 450;

  const assessmentTasksGridQuestionId = useMemo(() => {
    for (const step of steps) {
      const sec = step.sections.find((s) => s.pdf_render_mode === 'assessment_tasks');
      if (!sec) continue;
      const gridQ = sec.questions.find((q) => q.type === 'grid_table');
      if (gridQ) return gridQ.id;
    }
    return null;
  }, [steps]);

  useEffect(() => {
    if (assessmentTasksGridQuestionId == null) {
      setAssessmentTaskRows([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('skyline_form_question_rows')
      .select('id, row_label')
      .eq('question_id', assessmentTasksGridQuestionId)
      .order('sort_order')
      .then(({ data }) => {
        if (!cancelled) setAssessmentTaskRows((data as AssessmentTaskRow[]) || []);
      });
    return () => { cancelled = true; };
  }, [assessmentTasksGridQuestionId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-step-menu-trigger]')) return;
      if (openStepMenuId !== null && stepMenuRef.current && !stepMenuRef.current.contains(target)) {
        setOpenStepMenuId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openStepMenuId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-section-menu-trigger]')) return;
      if (openSectionMenuId !== null && sectionMenuRef.current && !sectionMenuRef.current.contains(target)) {
        setOpenSectionMenuId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openSectionMenuId]);

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !formId || !form) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPEG, PNG, WebP, or GIF)');
      return;
    }
    setCoverUploading(true);
    try {
      const { url, error: uploadError } = await uploadFormCoverImage(Number(formId), file);
      if (uploadError) {
        alert(`Upload failed: ${uploadError}\n\nAdd INSERT policy on photomedia bucket. See scripts/fix-storage-policies.sql`);
        return;
      }
      if (url) {
        const { error } = await updateForm(Number(formId), { cover_asset_url: url });
        if (error) {
          console.error('Failed to save cover URL:', error);
          alert(`Upload succeeded but save failed: ${error.message}. Run scripts/fix-cover-column.sql`);
          return;
        }
        setForm((prev) => (prev ? { ...prev, cover_asset_url: url } : null));
      }
    } catch (err) {
      console.error(err);
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  const loadData = useCallback(async () => {
    if (!formId) return;
    await ensureTaskSectionsForForm(Number(formId));
    const f = await fetchForm(Number(formId));
    setForm(f || null);
    if (f) lastSavedFormNameRef.current = f.name || '';
    const stepList = await fetchFormSteps(Number(formId));
    const stepsWithSections: StepWithSections[] = [];
    for (const s of stepList) {
      const { data: secs } = await supabase
        .from('skyline_form_sections')
        .select('*')
        .eq('step_id', s.id)
        .order('sort_order');
      const sectionsWithQs: (FormSection & { questions: FormQuestion[] })[] = [];
      for (const sec of secs || []) {
        const { data: qs } = await supabase
          .from('skyline_form_questions')
          .select('*')
          .eq('section_id', sec.id)
          .order('sort_order');
        sectionsWithQs.push({ ...sec, questions: qs || [] });
      }
      stepsWithSections.push({ ...s, sections: sectionsWithQs });
    }
    setSteps(stepsWithSections);
    if (stepsWithSections.length > 0 && !selectedStepId) setSelectedStepId(stepsWithSections[0].id);
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      Object.keys(questionSaveTimers.current).forEach((id) => {
        clearTimeout(questionSaveTimers.current[Number(id)]);
        const pending = questionPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          supabase.from('skyline_form_questions').update(pending).eq('id', Number(id));
        }
      });
      questionSaveTimers.current = {};
      questionPendingUpdates.current = {};
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      Object.keys(questionSaveTimers.current).forEach((id) => {
        clearTimeout(questionSaveTimers.current[Number(id)]);
        const pending = questionPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          supabase.from('skyline_form_questions').update(pending).eq('id', Number(id));
        }
      });
      window.dispatchEvent(new CustomEvent(FLUSH_PENDING_EVENT, { detail: { addPromises: () => {} } }));
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const selectedStep = steps.find((s) => s.id === selectedStepId);
  const selectedSection = selectedStep?.sections.find((s) => s.id === selectedSectionId);

  const addStep = async () => {
    if (!formId) return;
    const { data } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: Number(formId), title: `Step ${steps.length + 1}`, sort_order: steps.length })
      .select('*')
      .single();
    if (data) {
      setSteps((prev) => [...prev, { ...data, sections: [] }]);
      setSelectedStepId(data.id);
    }
  };

  const updateStep = async (stepId: number, updates: Partial<FormStep>) => {
    await supabase.from('skyline_form_steps').update(updates).eq('id', stepId);
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...updates } : s))
    );
    if (updates.title != null) {
      const nextTitle = updates.title;
      const step = steps.find((s) => s.id === stepId);
      const taskLinkedModes = ['task_instructions', 'task_questions', 'task_results'];
      const firstTaskSec = step?.sections.find((sec) => taskLinkedModes.includes(sec.pdf_render_mode));
      const rowId = firstTaskSec ? (firstTaskSec as FormSection & { assessment_task_row_id?: number | null }).assessment_task_row_id : null;
      if (rowId != null) {
        await supabase.from('skyline_form_question_rows').update({ row_label: nextTitle }).eq('id', rowId);
        setAssessmentTaskRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, row_label: nextTitle } : r)));
      }
    }
  };

  const addSection = async () => {
    if (!selectedStepId) return;
    const { data } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: selectedStepId, title: `Section ${(selectedStep?.sections.length || 0) + 1}`, sort_order: selectedStep?.sections.length || 0 })
      .select('*')
      .single();
    if (data) {
      setSteps((prev) =>
        prev.map((s) =>
          s.id === selectedStepId
            ? { ...s, sections: [...s.sections, { ...data, questions: [] }] }
            : s
        )
      );
      setSelectedSectionId(data.id);
    }
  };

  const updateSection = async (sectionId: number, updates: Partial<FormSection>) => {
    await supabase.from('skyline_form_sections').update(updates).eq('id', sectionId);
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        sections: s.sections.map((sec) =>
          sec.id === sectionId ? { ...sec, ...updates } : sec
        ),
      }))
    );
  };

  const removeStep = (stepId: number) => {
    setConfirmRemove({ type: 'step', id: stepId });
  };

  const executeRemoveStep = async (stepId: number) => {
    await supabase.from('skyline_form_steps').delete().eq('id', stepId);
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    if (selectedStepId === stepId) {
      const remaining = steps.filter((s) => s.id !== stepId);
      setSelectedStepId(remaining[0]?.id ?? null);
      setSelectedSectionId(remaining[0]?.sections[0]?.id ?? null);
    }
  };

  const removeSection = (sectionId: number) => {
    setConfirmRemove({ type: 'section', id: sectionId });
  };

  const executeRemoveSection = async (sectionId: number) => {
    await supabase.from('skyline_form_sections').delete().eq('id', sectionId);
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        sections: s.sections.filter((sec) => sec.id !== sectionId),
      }))
    );
    if (selectedSectionId === sectionId) {
      const step = steps.find((s) => s.id === selectedStepId);
      const remaining = (step?.sections ?? []).filter((s) => s.id !== sectionId);
      setSelectedSectionId(remaining[0]?.id ?? null);
    }
  };

  const duplicateStep = async (stepId: number) => {
    if (!formId) return;
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    const newSortOrder = step.sort_order + 1;
    const newStepTitle = `${step.title} (Copy)`;
    const { data: newStep } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: Number(formId), title: newStepTitle, subtitle: step.subtitle, sort_order: newSortOrder })
      .select('*')
      .single();
    if (!newStep) return;
    for (const s of steps) {
      if (s.sort_order >= newSortOrder && s.id !== stepId) {
        await supabase.from('skyline_form_steps').update({ sort_order: s.sort_order + 1 }).eq('id', s.id);
      }
    }
    // If this step has task-linked sections, create a new row in the assessment tasks grid and link sections to it
    let newRowId: number | null = null;
    const taskLinkedModes = ['task_instructions', 'task_questions', 'task_results'];
    const firstTaskSec = step.sections.find((sec) => taskLinkedModes.includes(sec.pdf_render_mode));
    const origRowId = firstTaskSec ? (firstTaskSec as FormSection & { assessment_task_row_id?: number | null }).assessment_task_row_id : null;
    if (assessmentTasksGridQuestionId != null && origRowId != null) {
      const { data: origRow } = await supabase.from('skyline_form_question_rows').select('row_help, row_meta').eq('id', origRowId).single();
      const { data: existingRows } = await supabase.from('skyline_form_question_rows').select('sort_order').eq('question_id', assessmentTasksGridQuestionId);
      const maxSort = existingRows?.length ? Math.max(...(existingRows as { sort_order: number }[]).map((r) => r.sort_order)) : -1;
      const nextSort = maxSort + 1;
      const { data: newRow } = await supabase
        .from('skyline_form_question_rows')
        .insert({
          question_id: assessmentTasksGridQuestionId,
          row_label: newStepTitle,
          row_help: origRow ? (origRow as { row_help: string | null }).row_help : null,
          row_meta: origRow ? (origRow as { row_meta: unknown }).row_meta : {},
          sort_order: nextSort,
        })
        .select('id')
        .single();
      if (newRow) newRowId = (newRow as { id: number }).id;
    }
    const newStepWithSections = { ...newStep, sections: [] as (FormSection & { questions: FormQuestion[] })[] };
    for (const sec of step.sections) {
      const secWithRow = sec as FormSection & { assessment_task_row_id?: number | null };
      const isTaskLinked = taskLinkedModes.includes(sec.pdf_render_mode);
      const rowIdForSec = isTaskLinked && newRowId != null ? newRowId : (secWithRow.assessment_task_row_id ?? null);
      const { data: newSec } = await supabase
        .from('skyline_form_sections')
        .insert({
          step_id: (newStep as FormStep).id,
          title: `${sec.title} (Copy)`,
          description: sec.description,
          pdf_render_mode: sec.pdf_render_mode,
          sort_order: sec.sort_order,
          assessment_task_row_id: rowIdForSec,
        })
        .select('*')
        .single();
      if (!newSec) continue;
      const newSecWithQs = { ...newSec, questions: [] as FormQuestion[] };
      const { data: questions } = await supabase.from('skyline_form_questions').select('*').eq('section_id', sec.id).order('sort_order');
      for (const q of (questions as FormQuestion[]) || []) {
        const { data: newQ } = await supabase
          .from('skyline_form_questions')
          .insert({
            section_id: (newSec as FormSection).id,
            type: q.type,
            code: q.code,
            label: q.label,
            help_text: q.help_text,
            required: q.required ?? false,
            sort_order: q.sort_order,
            role_visibility: q.role_visibility ?? {},
            role_editability: q.role_editability ?? {},
            pdf_meta: q.pdf_meta ?? {},
          })
          .select('*')
          .single();
        if (!newQ) continue;
        const { data: opts } = await supabase.from('skyline_form_question_options').select('*').eq('question_id', q.id).order('sort_order');
        if ((opts as { value: string; label: string; sort_order: number }[])?.length) {
          await supabase.from('skyline_form_question_options').insert(
            (opts as { value: string; label: string; sort_order: number }[]).map((o) => ({
              question_id: (newQ as FormQuestion).id,
              value: o.value,
              label: o.label,
              sort_order: o.sort_order,
            }))
          );
        }
        const { data: rows } = await supabase.from('skyline_form_question_rows').select('*').eq('question_id', q.id).order('sort_order');
        for (const r of (rows as { row_label: string; row_help: string | null; row_image_url: string | null; row_meta: unknown; sort_order: number }[]) || []) {
          await supabase.from('skyline_form_question_rows').insert({
            question_id: (newQ as FormQuestion).id,
            row_label: r.row_label,
            row_help: r.row_help,
            row_image_url: r.row_image_url,
            row_meta: r.row_meta,
            sort_order: r.sort_order,
          });
        }
        newSecWithQs.questions.push(newQ as FormQuestion);
      }
      newStepWithSections.sections.push(newSecWithQs);
    }
    const reordered = [...steps];
    reordered.splice(stepIndex + 1, 0, newStepWithSections);
    setSteps(reordered);
    setSelectedStepId((newStep as FormStep).id);
    setSelectedSectionId(newStepWithSections.sections[0]?.id ?? null);
    if (newRowId != null && assessmentTasksGridQuestionId != null) {
      const { data } = await supabase.from('skyline_form_question_rows').select('id, row_label').eq('question_id', assessmentTasksGridQuestionId).order('sort_order');
      setAssessmentTaskRows((data as AssessmentTaskRow[]) || []);
    }
  };

  const duplicateSection = async (sectionId: number) => {
    if (!selectedStepId) return;
    const step = steps.find((s) => s.id === selectedStepId);
    if (!step) return;
    const section = step.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const secIndex = step.sections.findIndex((s) => s.id === sectionId);
    const secWithRow = section as FormSection & { assessment_task_row_id?: number | null };
    // Task-linked sections: do not inherit the original task link when duplicating, so the user explicitly selects the correct task
    const isTaskLinked = ['task_results', 'task_instructions', 'task_questions'].includes(section.pdf_render_mode);
    const newRowId = isTaskLinked ? null : (secWithRow.assessment_task_row_id ?? null);
    const { data: newSec } = await supabase
      .from('skyline_form_sections')
      .insert({
        step_id: selectedStepId,
        title: `${section.title} (Copy)`,
        description: section.description,
        pdf_render_mode: section.pdf_render_mode,
        sort_order: section.sort_order + 1,
        assessment_task_row_id: newRowId,
      })
      .select('*')
      .single();
    if (!newSec) return;
    for (const s of step.sections) {
      if (s.sort_order > section.sort_order) {
        await supabase.from('skyline_form_sections').update({ sort_order: s.sort_order + 1 }).eq('id', s.id);
      }
    }
    const { data: questions } = await supabase.from('skyline_form_questions').select('*').eq('section_id', section.id).order('sort_order');
    const newQuestions: FormQuestion[] = [];
    for (const q of (questions as FormQuestion[]) || []) {
      const { data: newQ } = await supabase
        .from('skyline_form_questions')
        .insert({
          section_id: (newSec as FormSection).id,
          type: q.type,
          code: q.code,
          label: q.label,
          help_text: q.help_text,
          required: q.required ?? false,
          sort_order: q.sort_order,
          role_visibility: q.role_visibility ?? {},
          role_editability: q.role_editability ?? {},
          pdf_meta: q.pdf_meta ?? {},
        })
        .select('*')
        .single();
      if (!newQ) continue;
      const { data: opts } = await supabase.from('skyline_form_question_options').select('*').eq('question_id', q.id).order('sort_order');
      if ((opts as { value: string; label: string; sort_order: number }[])?.length) {
        await supabase.from('skyline_form_question_options').insert(
          (opts as { value: string; label: string; sort_order: number }[]).map((o) => ({
            question_id: (newQ as FormQuestion).id,
            value: o.value,
            label: o.label,
            sort_order: o.sort_order,
          }))
        );
      }
      const { data: rows } = await supabase.from('skyline_form_question_rows').select('*').eq('question_id', q.id).order('sort_order');
      for (const r of (rows as { row_label: string; row_help: string | null; row_image_url: string | null; row_meta: unknown; sort_order: number }[]) || []) {
        await supabase.from('skyline_form_question_rows').insert({
          question_id: (newQ as FormQuestion).id,
          row_label: r.row_label,
          row_help: r.row_help,
          row_image_url: r.row_image_url,
          row_meta: r.row_meta,
          sort_order: r.sort_order,
        });
      }
      newQuestions.push(newQ as FormQuestion);
    }
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== selectedStepId) return s;
        const reordered = [...s.sections];
        const newSecWithQs = { ...newSec, questions: newQuestions };
        reordered.splice(secIndex + 1, 0, newSecWithQs);
        return { ...s, sections: reordered };
      })
    );
    setSelectedSectionId((newSec as FormSection).id);
  };

  const handleStepsDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('step-') || !overId.startsWith('step-')) return;
    const oldIndex = steps.findIndex((s) => `step-${s.id}` === activeId);
    const newIndex = steps.findIndex((s) => `step-${s.id}` === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(steps, oldIndex, newIndex);
    setSteps(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('skyline_form_steps').update({ sort_order: i }).eq('id', reordered[i].id);
    }
  };

  const handleSectionsDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedStepId) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('section-') || !overId.startsWith('section-')) return;
    const step = steps.find((s) => s.id === selectedStepId);
    if (!step) return;
    const oldIndex = step.sections.findIndex((s) => `section-${s.id}` === activeId);
    const newIndex = step.sections.findIndex((s) => `section-${s.id}` === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(step.sections, oldIndex, newIndex);
    setSteps((prev) =>
      prev.map((s) =>
        s.id === selectedStepId ? { ...s, sections: reordered } : s
      )
    );
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('skyline_form_sections').update({ sort_order: i }).eq('id', reordered[i].id);
    }
  };

  const stepSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const questionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const removeQuestion = (questionId: number) => {
    setConfirmRemove({ type: 'question', id: questionId });
  };

  const handleConfirmRemove = async () => {
    if (!confirmRemove) return;
    if (confirmRemove.type === 'step') await executeRemoveStep(confirmRemove.id);
    else if (confirmRemove.type === 'section') await executeRemoveSection(confirmRemove.id);
    else await executeRemoveQuestion(confirmRemove.id);
  };

  const getConfirmDialogConfig = () => {
    if (!confirmRemove) return null;
    if (confirmRemove.type === 'step') {
      return { title: 'Remove Step', message: 'Remove this step? All sections and questions in it will be deleted.', confirmLabel: 'Remove' };
    }
    if (confirmRemove.type === 'section') {
      return { title: 'Remove Section', message: 'Remove this section? All questions in it will be deleted.', confirmLabel: 'Remove' };
    }
    return { title: 'Remove Question', message: 'Remove this question? Options and rows will be deleted.', confirmLabel: 'Remove' };
  };

  const executeRemoveQuestion = async (questionId: number) => {
    await supabase.from('skyline_form_questions').delete().eq('id', questionId);
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        sections: s.sections.map((sec) => ({
          ...sec,
          questions: sec.questions.filter((q) => q.id !== questionId),
        })),
      }))
    );
    if (editingQuestionId === questionId) {
      const remaining = (selectedSection?.questions ?? []).filter((q) => q.id !== questionId);
      setEditingQuestionId(remaining[0]?.id ?? null);
    }
  };

  const handleQuestionsDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedSectionId) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('question-') || !overId.startsWith('question-')) return;
    const questions = selectedSection?.questions ?? [];
    const oldIndex = questions.findIndex((q) => `question-${q.id}` === activeId);
    const newIndex = questions.findIndex((q) => `question-${q.id}` === overId);
    if (oldIndex === -1 || newIndex === -1 || !selectedSection) return;
    const reordered = arrayMove(questions, oldIndex, newIndex);
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        sections: s.sections.map((sec) =>
          sec.id === selectedSectionId ? { ...sec, questions: reordered } : sec
        ),
      }))
    );
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('skyline_form_questions').update({ sort_order: i }).eq('id', reordered[i].id);
    }
  };

  const addQuestion = async () => {
    if (!selectedSectionId) return;
    const { data } = await supabase
      .from('skyline_form_questions')
      .insert({
        section_id: selectedSectionId,
        type: 'short_text',
        label: 'New Question',
        sort_order: selectedSection?.questions.length || 0,
      })
      .select('*')
      .single();
    if (data) {
      setSteps((prev) =>
        prev.map((s) => ({
          ...s,
          sections: s.sections.map((sec) =>
            sec.id === selectedSectionId
              ? { ...sec, questions: [...sec.questions, data] }
              : sec
          ),
        }))
      );
      setEditingQuestionId(data.id);
    }
  };

  const flushQuestionSave = useCallback((questionId: number): Promise<void> => {
    const pending = questionPendingUpdates.current[questionId];
    delete questionPendingUpdates.current[questionId];
    const t = questionSaveTimers.current[questionId];
    if (t) clearTimeout(t);
    delete questionSaveTimers.current[questionId];
    if (pending && Object.keys(pending).length > 0) {
      return Promise.resolve(supabase.from('skyline_form_questions').update(pending).eq('id', questionId)).then(() => {});
    }
    return Promise.resolve();
  }, []);

  /** Flush all debounced saves (questions, options, rows) before preview or navigation. */
  const flushAllPendingSaves = useCallback(async () => {
    if (questionBlurSavePromise.current) {
      await questionBlurSavePromise.current;
      questionBlurSavePromise.current = null;
    }
    const timerIds = Object.keys(questionSaveTimers.current).map(Number);
    const pendingIds = Object.keys(questionPendingUpdates.current).map(Number);
    const allIds = [...new Set([...timerIds, ...pendingIds])];
    allIds.forEach((id) => {
      clearTimeout(questionSaveTimers.current[id]);
      delete questionSaveTimers.current[id];
    });
    const promises: Promise<unknown>[] = [];
    for (const id of allIds) {
      const pending = questionPendingUpdates.current[id];
      delete questionPendingUpdates.current[id];
      if (pending && Object.keys(pending).length > 0) {
        promises.push(Promise.resolve(supabase.from('skyline_form_questions').update(pending).eq('id', id)));
      }
    }
    const childPromises: Promise<unknown>[] = [];
    window.dispatchEvent(
      new CustomEvent(FLUSH_PENDING_EVENT, { detail: { addPromises: (ps: Promise<unknown>[]) => childPromises.push(...ps) } })
    );
    await Promise.all([...promises, ...childPromises]);
  }, []);

  const updateQuestion = useCallback((questionId: number, updates: Partial<FormQuestion>) => {
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        sections: s.sections.map((sec) => ({
          ...sec,
          questions: sec.questions.map((q) =>
            q.id === questionId ? { ...q, ...updates } : q
          ),
        })),
      }))
    );
    questionPendingUpdates.current[questionId] = {
      ...questionPendingUpdates.current[questionId],
      ...updates,
    };
    const existing = questionSaveTimers.current[questionId];
    if (existing) clearTimeout(existing);
    questionSaveTimers.current[questionId] = setTimeout(() => {
      flushQuestionSave(questionId);
    }, QUESTION_SAVE_DEBOUNCE_MS);
  }, [flushQuestionSave]);

  if (loading || !form) {
    return <Loader fullPage variant="dots" size="lg" message="Loading form..." />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20 overflow-x-hidden">
        <div className="w-full px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  await new Promise((r) => setTimeout(r, 0));
                  await flushAllPendingSaves();
                  navigate('/admin/forms');
                }}
                className="text-gray-600 hover:text-gray-900 bg-transparent border-none cursor-pointer font-inherit p-0 shrink-0"
              >
                ← Back
              </button>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, name: e.target.value } : null))}
                onBlur={async (e) => {
                  const newName = (e.target.value || '').trim();
                  if (!newName) {
                    setForm((prev) => (prev ? { ...prev, name: lastSavedFormNameRef.current } : null));
                    return;
                  }
                  if (newName === lastSavedFormNameRef.current) return;
                  const exists = await formNameExists(newName, Number(formId));
                  if (exists) {
                    alert('A form with this name already exists. Please choose a different name.');
                    setForm((prev) => (prev ? { ...prev, name: lastSavedFormNameRef.current } : null));
                    return;
                  }
                  const { error } = await updateForm(Number(formId), { name: newName });
                  if (error) {
                    alert(`Failed to save name: ${error.message}`);
                    setForm((prev) => (prev ? { ...prev, name: lastSavedFormNameRef.current } : null));
                    return;
                  }
                  lastSavedFormNameRef.current = newName;
                  setForm((prev) => (prev ? { ...prev, name: newName } : null));
                }}
                className="text-xl font-bold text-[var(--text)] bg-transparent border-b-2 border-transparent hover:border-[var(--border)] focus:outline-none focus:border-[var(--brand)] py-0.5 px-0 min-w-0 flex-1 max-w-sm"
                placeholder="Form name"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-500 shrink-0">Version:</span>
                <input
                  type="text"
                  value={form.version ?? '1.0.0'}
                  onChange={(e) => setForm((prev) => (prev ? { ...prev, version: e.target.value } : null))}
                  onBlur={async (e) => {
                    const v = (e.target.value || '1.0.0').trim() || '1.0.0';
                    await updateForm(Number(formId), { version: v });
                    setForm((prev) => (prev ? { ...prev, version: v } : null));
                  }}
                  className="text-sm border border-[var(--border)] rounded px-2 py-0.5 w-14 focus:outline-none focus:ring-1 focus:ring-[var(--brand)] focus:border-[var(--brand)] shrink-0"
                  placeholder="1.0.0"
                />
                <span className="text-xs font-medium text-gray-500 shrink-0">Link valid:</span>
                <DatePicker
                  value={form.start_date ?? ''}
                  onChange={(v) => {
                    const val = (v && v.trim()) ? v : null;
                    setForm((prev) => (prev ? { ...prev, start_date: val } : null));
                    void updateForm(Number(formId), { start_date: val });
                  }}
                  compact
                  placement="below"
                  className="w-[150px] max-w-[150px] shrink-0"
                />
                <span className="text-gray-400 shrink-0">–</span>
                <DatePicker
                  value={form.end_date ?? ''}
                  onChange={(v) => {
                    const val = (v && v.trim()) ? v : null;
                    setForm((prev) => (prev ? { ...prev, end_date: val } : null));
                    void updateForm(Number(formId), { end_date: val });
                  }}
                  compact
                  placement="below"
                  className="w-[150px] max-w-[150px] shrink-0"
                />
                <span className="text-xs text-gray-400 shrink-0" title="Sent links expire at end date">(expires end date)</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleCoverUpload}
              />
              {form.cover_asset_url && (
                <div className="w-10 h-10 rounded border border-[var(--border)] overflow-hidden shrink-0">
                  <img src={form.cover_asset_url} alt="Cover" className="w-full h-full object-cover" />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverUploading}
              >
                {coverUploading ? (
                  <Loader variant="dots" size="sm" inline className="mr-1" />
                ) : (
                  <>
                    <ImagePlus className="w-4 h-4 mr-1" />
                    {form.cover_asset_url ? 'Change Cover' : 'Add Cover Image'}
                  </>
                )}
              </Button>
            <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setPreviewing(true);
              try {
                await new Promise((r) => setTimeout(r, 0));
                await flushAllPendingSaves();
                navigate(`/admin/forms/${formId}/preview`);
              } finally {
                setPreviewing(false);
              }
            }}
            disabled={previewing}
          >
            {previewing ? (
              <Loader variant="dots" size="sm" inline className="mr-1" />
            ) : (
              <Eye className="w-4 h-4 mr-1" />
            )}
            {previewing ? 'Loading...' : 'Preview'}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-65px)]">
        {/* Left: Steps */}
        <div className="w-56 border-r border-[var(--border)] bg-white p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm">Steps</h2>
            <Button variant="outline" size="sm" onClick={addStep}>
              + Add
            </Button>
          </div>
          <DndContext sensors={stepSensors} collisionDetection={closestCenter} onDragEnd={handleStepsDragEnd}>
            <SortableContext items={steps.map((s) => `step-${s.id}`)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {steps.map((step) => (
                  <SortableStepItem
                    key={step.id}
                    step={step}
                    isSelected={step.id === selectedStepId}
                    onSelect={() => {
                      setSelectedStepId(step.id);
                      setSelectedSectionId(step.sections[0]?.id ?? null);
                    }}
                    onUpdate={(title) => updateStep(step.id, { title })}
                    onRemove={() => removeStep(step.id)}
                    onDuplicate={() => {
                      setOpenStepMenuId(null);
                      duplicateStep(step.id);
                    }}
                    menuOpen={openStepMenuId === step.id}
                    onMenuToggle={() => setOpenStepMenuId(openStepMenuId === step.id ? null : step.id)}
                    menuRef={stepMenuRef}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Middle: Sections */}
        <div className="w-64 min-w-[14rem] border-r border-[var(--border)] bg-white p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm">Sections</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={addSection}
              disabled={!selectedStepId}
            >
              + Add
            </Button>
          </div>
          {selectedStep ? (
            <DndContext sensors={sectionSensors} collisionDetection={closestCenter} onDragEnd={handleSectionsDragEnd}>
              <SortableContext items={selectedStep.sections.map((s) => `section-${s.id}`)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {selectedStep.sections.map((sec) => (
                    <SortableSectionItem
                      key={sec.id}
                      section={sec}
                      isSelected={sec.id === selectedSectionId}
                      onSelect={() => setSelectedSectionId(sec.id)}
                      onUpdate={(title) => updateSection(sec.id, { title })}
                      onPdfModeChange={(mode) => updateSection(sec.id, { pdf_render_mode: mode })}
                      onAssessmentTaskRowChange={(rowId) => updateSection(sec.id, { assessment_task_row_id: rowId })}
                      assessmentTaskRows={assessmentTaskRows}
                      onRemove={() => removeSection(sec.id)}
                      onDuplicate={() => {
                        setOpenSectionMenuId(null);
                        duplicateSection(sec.id);
                      }}
                      menuOpen={openSectionMenuId === sec.id}
                      onMenuToggle={() => setOpenSectionMenuId(openSectionMenuId === sec.id ? null : sec.id)}
                      menuRef={sectionMenuRef}
                      canDelete={!isPrebuiltSection(sec.title)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="text-sm text-gray-500">Select a step</p>
          )}
        </div>

        {/* Right: Content (Questions or Instructions) + Editor */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-72 border-r border-[var(--border)] bg-white p-4 overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-sm">
                {selectedSection?.pdf_render_mode === 'task_instructions'
                  ? 'Instructions'
                  : selectedSection?.pdf_render_mode === 'task_questions'
                    ? 'Questions to answer'
                    : selectedSection?.pdf_render_mode === 'task_results'
                      ? 'Results'
                      : selectedSection?.pdf_render_mode === 'assessment_summary' || selectedSection?.title === 'Assessment Summary Sheet'
                        ? 'Assessment Summary Sheet'
                        : 'Questions'}
              </h2>
              {(selectedSection?.pdf_render_mode === 'task_questions' || (!['task_instructions', 'task_questions', 'task_results', 'assessment_summary'].includes(selectedSection?.pdf_render_mode || '') && selectedSection?.title !== 'Assessment Summary Sheet')) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addQuestion}
                  disabled={!selectedSectionId}
                >
                  + Add
                </Button>
              )}
            </div>
            {selectedSection ? (
              selectedSection.pdf_render_mode === 'task_instructions' ? (
                <p className="text-sm text-gray-600">
                  Instructions students will read before answering. Use the editor on the right to add content.
                </p>
              ) : selectedSection.pdf_render_mode === 'task_results' ? (
                <p className="text-sm text-gray-600">
                  Results sheet for trainer/assessor to record outcomes.
                </p>
              ) : selectedSection.pdf_render_mode === 'assessment_summary' || selectedSection.title === 'Assessment Summary Sheet' ? (
                <p className="text-sm text-gray-600">
                  Assessment Summary Sheet. Appears as one page in the PDF. Student details, task results, signatures and feedback are completed when the form is filled.
                </p>
              ) : (
                <DndContext sensors={questionSensors} collisionDetection={closestCenter} onDragEnd={handleQuestionsDragEnd}>
                  <SortableContext items={selectedSection.questions.map((q) => `question-${q.id}`)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {selectedSection.questions.map((q) => (
                        <SortableQuestionItem
                          key={q.id}
                          question={q}
                          isSelected={editingQuestionId === q.id}
                          onSelect={() => setEditingQuestionId(q.id)}
                          onRemove={() => removeQuestion(q.id)}
                          canDelete={!isPrebuiltQuestion(q)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )
            ) : (
              <p className="text-sm text-gray-500">Select a section</p>
            )}
          </div>

          <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
            {selectedSection?.pdf_render_mode === 'task_instructions' ? (
              <SectionInstructionsEditor
                section={selectedSection}
                onSaved={loadData}
              />
            ) : editingQuestionId && selectedSection ? (() => {
              const q = selectedSection.questions.find((x) => x.id === editingQuestionId);
              if (!q) return null;
              const rv = (q.role_visibility as Record<string, boolean>) || {};
              const re = (q.role_editability as Record<string, boolean>) || {};
              const pm = (q.pdf_meta as Record<string, unknown>) || {};
              const gridColumnsMeta = getGridColumnsMeta(pm);
              const questionWordLimit = normalizeWordLimit(pm.wordLimit);
              const gridColumnWordLimits = gridColumnsMeta.map((_, idx) =>
                normalizeWordLimit(Array.isArray(pm.columnWordLimits) ? (pm.columnWordLimits as unknown[])[idx] : null)
              );
              const layout = (pm.layout as string) || 'default';
              const isNoImageNoHeader = layout === 'no_image_no_header';
              return (
                <Card>
                  <h3 className="font-bold mb-4">Edit Question</h3>
                  <div className="space-y-4">
                    {q.type === 'page_break' ? (
                      <p className="text-sm text-gray-500 italic">
                        Page Break inserts a new page in the PDF. Label and help text are not displayed. Use the question list order to place it between questions.
                      </p>
                    ) : (
                      <>
                        <Input
                          label="Label"
                          value={q.label}
                          onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                          onBlur={() => { questionBlurSavePromise.current = flushQuestionSave(q.id); }}
                        />
                        <Textarea
                          label="Help Text"
                          value={q.help_text || ''}
                          onChange={(e) => updateQuestion(q.id, { help_text: e.target.value })}
                          onBlur={() => { questionBlurSavePromise.current = flushQuestionSave(q.id); }}
                        />
                        <div className="flex items-center gap-2">
                          <Checkbox
                            label="Required"
                            checked={q.required}
                            onChange={(v) => updateQuestion(q.id, { required: v })}
                          />
                        </div>
                      </>
                    )}
                    <Select
                      label="Type"
                      value={q.type}
                      onChange={(v) => updateQuestion(q.id, { type: v })}
                      options={QUESTION_TYPES}
                    />
                    {(q.type === 'short_text' || q.type === 'long_text') && (
                      <Input
                        label="Word limit (optional)"
                        type="number"
                        min={1}
                        value={questionWordLimit ?? ''}
                        onChange={(e) =>
                          updateQuestion(q.id, {
                            pdf_meta: { ...pm, wordLimit: normalizeWordLimit(e.target.value) },
                          })
                        }
                        placeholder="e.g. 50"
                      />
                    )}
                    {q.type !== 'page_break' && (
                    <>
                      <div>
                        <div className="text-sm font-semibold mb-2">Role Visibility</div>
                        <div className="flex gap-4">
                          {ROLES.map((r) => (
                            <Checkbox
                              key={r.value}
                              label={r.label}
                              checked={rv[r.value] !== false}
                              onChange={(v) =>
                                updateQuestion(q.id, {
                                  role_visibility: { ...rv, [r.value]: v },
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-2">Role Editability</div>
                        <div className="flex gap-4">
                          {ROLES.map((r) => (
                            <Checkbox
                              key={r.value}
                              label={r.label}
                              checked={re[r.value] !== false}
                              onChange={(v) =>
                                updateQuestion(q.id, {
                                  role_editability: { ...re, [r.value]: v },
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </>
                    )}
                    {(q.type === 'single_choice' || q.type === 'multi_choice' || q.type === 'yes_no') && (
                      <QuestionOptionsEditor questionId={q.id} />
                    )}
                    {q.type === 'grid_table' && (
                      <div className="space-y-3 mb-4">
                        <div className="text-sm font-semibold text-gray-700">1. Table layout</div>
                        <div>
                          <Select
                            value={layout}
                            onChange={(v) =>
                              updateQuestion(q.id, {
                                pdf_meta: { ...pm, layout: v },
                              })
                            }
                            options={[
                              { value: 'default', label: 'Default (image + label in first column)' },
                              { value: 'no_image', label: 'No image (header 1st | header 2nd | input columns)' },
                              { value: 'no_image_no_header', label: 'No image (no header)' },
                              { value: 'split', label: 'Layout 1 (name | image | input columns – for polygon, measurement, etc.)' },
                            ]}
                          />
                        </div>
                        {layout === 'split' && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              label="1st column header"
                              value={(pm.firstColumnLabel as string | undefined) ?? 'Name'}
                              onChange={(e) =>
                                updateQuestion(q.id, {
                                  pdf_meta: { ...pm, firstColumnLabel: e.target.value },
                                })
                              }
                              placeholder="e.g. Polygon Name, Measurement"
                            />
                            <Input
                              label="2nd column header"
                              value={(pm.secondColumnLabel as string | undefined) ?? 'Image'}
                              onChange={(e) =>
                                updateQuestion(q.id, {
                                  pdf_meta: { ...pm, secondColumnLabel: e.target.value },
                                })
                              }
                              placeholder="e.g. Polygon Shape, Diagram"
                            />
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-semibold mb-2">{isNoImageNoHeader ? 'Columns (structure only, headers hidden)' : 'Columns'}</div>
                          <div className="space-y-2">
                            {gridColumnsMeta.map((col, colIdx) => (
                              <div key={`col-${colIdx}`} className="grid grid-cols-12 gap-2 items-end">
                                <div className={isNoImageNoHeader ? 'col-span-11' : 'col-span-7'}>
                                  {isNoImageNoHeader ? (
                                    <div className="text-sm text-gray-600 pb-2">Column {colIdx + 1}</div>
                                  ) : (
                                    <Input
                                      label={`Column ${colIdx + 1} header`}
                                      value={col.label}
                                      onChange={(e) => {
                                        const next = [...gridColumnsMeta];
                                        next[colIdx] = { ...next[colIdx], label: e.target.value };
                                        updateQuestion(q.id, { pdf_meta: withGridColumnsMeta(pm, next) });
                                      }}
                                    />
                                  )}
                                </div>
                                <div className={isNoImageNoHeader ? 'col-span-11 -mt-2' : 'col-span-2'}>
                                  <Select
                                    label="Type"
                                    value={col.type}
                                    onChange={(v) => {
                                      const next = [...gridColumnsMeta];
                                      next[colIdx] = { ...next[colIdx], type: normalizeGridColumnType(v) };
                                      updateQuestion(q.id, { pdf_meta: withGridColumnsMeta(pm, next) });
                                    }}
                                    options={GRID_COLUMN_TYPE_OPTIONS}
                                  />
                                </div>
                                <div className={isNoImageNoHeader ? 'col-span-11 -mt-2' : 'col-span-2'}>
                                  <Input
                                    label="Word limit (optional)"
                                    type="number"
                                    min={1}
                                    value={gridColumnWordLimits[colIdx] ?? ''}
                                    disabled={col.type !== 'answer'}
                                    onChange={(e) => {
                                      const nextLimits = [...gridColumnWordLimits];
                                      nextLimits[colIdx] = normalizeWordLimit(e.target.value);
                                      updateQuestion(q.id, {
                                        pdf_meta: { ...(withGridColumnsMeta(pm, gridColumnsMeta) as Record<string, unknown>), columnWordLimits: nextLimits } as Json,
                                      });
                                    }}
                                    placeholder={col.type === 'answer' ? 'e.g. 20' : 'N/A'}
                                  />
                                </div>
                                <div className={isNoImageNoHeader ? 'col-span-12 flex justify-end -mt-2' : 'col-span-1 flex justify-end'}>
                                  <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-700 pb-2"
                                    onClick={() => {
                                      const next = gridColumnsMeta.filter((_, i) => i !== colIdx);
                                      updateQuestion(q.id, { pdf_meta: withGridColumnsMeta(pm, next) });
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const next = [...gridColumnsMeta, { label: `Column ${gridColumnsMeta.length + 1}`, type: 'answer' as GridColumnType }];
                                updateQuestion(q.id, { pdf_meta: withGridColumnsMeta(pm, next) });
                              }}
                            >
                              + Add column
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    {(q.type === 'likert_5' || q.type === 'grid_table' || (q.type === 'single_choice' && q.code === 'written.evidence.checklist')) && (
                      <>
                        {q.type === 'grid_table' && <div className="text-sm font-semibold text-gray-700 mb-2">2. Table rows</div>}
                        {q.type === 'single_choice' && q.code === 'written.evidence.checklist' && <div className="text-sm font-semibold text-gray-700 mb-2">Checklist rows</div>}
                        <QuestionRowsEditor
                          questionId={q.id}
                          sectionPdfMode={selectedSection?.pdf_render_mode}
                          formId={formId ? Number(formId) : null}
                          steps={steps}
                          onStepsCreated={loadData}
                          gridTableLayout={q.type === 'grid_table' ? ((q.pdf_meta as Record<string, unknown>)?.layout as string) : undefined}
                          simpleLabelsOnly={q.type === 'single_choice' && q.code === 'written.evidence.checklist'}
                        />
                      </>
                    )}
                  </div>
                </Card>
              );
            })() : selectedSection?.pdf_render_mode === 'task_results' ? (
              <Card>
                <h3 className="font-bold mb-2">Results sheet</h3>
                <p className="text-sm text-gray-600">
                  This section shows the results template (Satisfactory/Not Satisfactory, feedback, signatures) for the trainer/assessor to complete. No editing needed here.
                </p>
              </Card>
            ) : selectedSection?.pdf_render_mode === 'assessment_summary' || selectedSection?.title === 'Assessment Summary Sheet' ? (
              <Card>
                <h3 className="font-bold mb-2">Assessment Summary Sheet</h3>
                <p className="text-sm text-gray-600 mb-3">
                  This section appears as a single page in the PDF. It includes:
                </p>
                <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 mb-3">
                  <li>Student name, ID, start/end date, unit code & name</li>
                  <li>Evidence table with 1st / 2nd / 3rd attempt (Satisfactory / Not Satisfactory, dates)</li>
                  <li>Final assessment result (Competent / Not Yet Competent)</li>
                  <li>Trainer/assessor and student signatures and dates</li>
                  <li>Student overall feedback</li>
                  <li>Administrative use – initials</li>
                </ul>
                <p className="text-sm text-gray-600">
                  All content is completed when the form is filled (e.g. on the form fill page). No editing needed here in the builder.
                </p>
              </Card>
            ) : selectedSection && !editingQuestionId ? (
              <p className="text-sm text-gray-500">Select a question to edit, or click + Add to create one</p>
            ) : !selectedSection ? (
              <p className="text-sm text-gray-500">Select a section</p>
            ) : null}
          </div>
        </div>
      </div>

      {confirmRemove && (() => {
        const config = getConfirmDialogConfig()!;
        return (
          <ConfirmDialog
            isOpen
            onClose={() => setConfirmRemove(null)}
            onConfirm={handleConfirmRemove}
            title={config.title}
            message={config.message}
            confirmLabel={config.confirmLabel}
            variant="danger"
          />
        );
      })()}
    </div>
  );
};

const OPTION_SAVE_DEBOUNCE_MS = 450;

function QuestionOptionsEditor({ questionId }: { questionId: number }) {
  const [options, setOptions] = useState<{ id: number; value: string; label: string; sort_order: number }[]>([]);
  const optionPendingUpdates = useRef<Record<number, { value?: string; label?: string }>>({});
  const optionSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    supabase
      .from('skyline_form_question_options')
      .select('*')
      .eq('question_id', questionId)
      .order('sort_order')
      .then(({ data }) => setOptions(data || []));
  }, [questionId]);

  useEffect(() => {
    return () => {
      Object.keys(optionSaveTimers.current).forEach((id) => {
        clearTimeout(optionSaveTimers.current[Number(id)]);
        const pending = optionPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          supabase.from('skyline_form_question_options').update(pending).eq('id', Number(id));
        }
      });
      optionSaveTimers.current = {};
      optionPendingUpdates.current = {};
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ addPromises: (ps: Promise<unknown>[]) => void }>).detail;
      const promises: Promise<unknown>[] = [];
      Object.keys(optionSaveTimers.current).forEach((id) => {
        clearTimeout(optionSaveTimers.current[Number(id)]);
        delete optionSaveTimers.current[Number(id)];
      });
      Object.keys(optionPendingUpdates.current).forEach((id) => {
        const pending = optionPendingUpdates.current[Number(id)];
        delete optionPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          promises.push(Promise.resolve(supabase.from('skyline_form_question_options').update(pending).eq('id', Number(id))));
        }
      });
      if (promises.length > 0) detail.addPromises(promises);
    };
    window.addEventListener(FLUSH_PENDING_EVENT, handler);
    return () => window.removeEventListener(FLUSH_PENDING_EVENT, handler);
  }, []);

  const addOption = async () => {
    const { data } = await supabase
      .from('skyline_form_question_options')
      .insert({ question_id: questionId, value: `opt_${Date.now()}`, label: 'New option', sort_order: options.length })
      .select('*')
      .single();
    if (data) setOptions((prev) => [...prev, data]);
  };

  const flushOptionSave = useCallback((id: number) => {
    const pending = optionPendingUpdates.current[id];
    delete optionPendingUpdates.current[id];
    const t = optionSaveTimers.current[id];
    if (t) clearTimeout(t);
    delete optionSaveTimers.current[id];
    if (pending && Object.keys(pending).length > 0) {
      supabase.from('skyline_form_question_options').update(pending).eq('id', id);
    }
  }, []);

  const updateOption = useCallback((id: number, updates: { value?: string; label?: string }) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...updates } : o)));
    optionPendingUpdates.current[id] = { ...optionPendingUpdates.current[id], ...updates };
    const existing = optionSaveTimers.current[id];
    if (existing) clearTimeout(existing);
    optionSaveTimers.current[id] = setTimeout(() => flushOptionSave(id), OPTION_SAVE_DEBOUNCE_MS);
  }, [flushOptionSave]);

  return (
    <div>
      <div className="text-sm font-semibold mb-2">Options</div>
      <div className="space-y-2">
        {options.map((opt) => (
          <div key={opt.id} className="flex gap-2">
            <Input
              value={opt.value}
              onChange={(e) => updateOption(opt.id, { value: e.target.value })}
              placeholder="Value"
              className="w-24"
            />
            <Input
              value={opt.label}
              onChange={(e) => updateOption(opt.id, { label: e.target.value })}
              placeholder="Label"
              className="flex-1"
            />
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addOption} className="mt-2">
        + Add option
      </Button>
    </div>
  );
}

interface QuestionRow {
  id: number;
  row_label: string;
  row_help: string | null;
  row_image_url: string | null;
  row_meta?: Record<string, unknown> | null;
  sort_order: number;
}

const ROW_SAVE_DEBOUNCE_MS = 450;

function QuestionRowsEditor({ questionId, sectionPdfMode, formId, steps, onStepsCreated, gridTableLayout, simpleLabelsOnly = false }: { questionId: number; sectionPdfMode?: string; formId?: number | null; steps?: { sort_order: number }[]; onStepsCreated?: () => void; gridTableLayout?: string; simpleLabelsOnly?: boolean }) {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [instructionsModalRow, setInstructionsModalRow] = useState<QuestionRow | null>(null);
  const [uploadingRowId, setUploadingRowId] = useState<number | null>(null);
  const rowPendingUpdates = useRef<Record<number, Partial<QuestionRow>>>({});
  const rowSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    supabase
      .from('skyline_form_question_rows')
      .select('*')
      .eq('question_id', questionId)
      .order('sort_order')
      .then(({ data }) => setRows(data || []));
  }, [questionId]);

  useEffect(() => {
    return () => {
      Object.keys(rowSaveTimers.current).forEach((id) => {
        clearTimeout(rowSaveTimers.current[Number(id)]);
        const pending = rowPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          supabase.from('skyline_form_question_rows').update(pending).eq('id', Number(id));
        }
      });
      rowSaveTimers.current = {};
      rowPendingUpdates.current = {};
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ addPromises: (ps: Promise<unknown>[]) => void }>).detail;
      const promises: Promise<unknown>[] = [];
      Object.keys(rowSaveTimers.current).forEach((id) => {
        clearTimeout(rowSaveTimers.current[Number(id)]);
        delete rowSaveTimers.current[Number(id)];
      });
      Object.keys(rowPendingUpdates.current).forEach((id) => {
        const pending = rowPendingUpdates.current[Number(id)];
        delete rowPendingUpdates.current[Number(id)];
        if (pending && Object.keys(pending).length > 0) {
          promises.push(Promise.resolve(supabase.from('skyline_form_question_rows').update(pending).eq('id', Number(id))));
        }
      });
      if (promises.length > 0) detail.addPromises(promises);
    };
    window.addEventListener(FLUSH_PENDING_EVENT, handler);
    return () => window.removeEventListener(FLUSH_PENDING_EVENT, handler);
  }, []);

  const addRow = async () => {
    const defaultLabel = '';
    const { data } = await supabase
      .from('skyline_form_question_rows')
      .insert({ question_id: questionId, row_label: defaultLabel, sort_order: rows.length })
      .select('*')
      .single();
    if (data) {
      setRows((prev) => [...prev, data]);
      if (sectionPdfMode === 'assessment_tasks' && formId && onStepsCreated) {
        const row = data as QuestionRow;
        const maxStepOrder = steps?.length ? Math.max(...steps.map((s) => s.sort_order), 0) : 0;
        const { data: taskStep } = await supabase
          .from('skyline_form_steps')
          .insert({ form_id: formId, title: row.row_label, subtitle: 'Instructions, Questions & Results', sort_order: maxStepOrder + 1 })
          .select('id')
          .single();
        if (taskStep) {
          const taskStepId = (taskStep as { id: number }).id;
          await supabase.from('skyline_form_sections').insert([
            { step_id: taskStepId, title: 'Student Instructions', pdf_render_mode: 'task_instructions', assessment_task_row_id: row.id, sort_order: 0 },
            { step_id: taskStepId, title: 'Questions', pdf_render_mode: 'task_questions', assessment_task_row_id: row.id, sort_order: 1 },
            { step_id: taskStepId, title: 'Results', pdf_render_mode: 'task_results', assessment_task_row_id: row.id, sort_order: 2 },
          ]);
          onStepsCreated();
        }
      }
    }
  };

  const flushRowSave = useCallback(async (id: number) => {
    const pending = rowPendingUpdates.current[id];
    delete rowPendingUpdates.current[id];
    const t = rowSaveTimers.current[id];
    if (t) clearTimeout(t);
    delete rowSaveTimers.current[id];
    if (pending && Object.keys(pending).length > 0) {
      const { error } = await supabase.from('skyline_form_question_rows').update(pending).eq('id', id);
      if (error) {
        console.error('Failed to save row changes:', error);
      }
    }
  }, []);

  const updateRow = useCallback((id: number, updates: Partial<QuestionRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    rowPendingUpdates.current[id] = { ...rowPendingUpdates.current[id], ...updates };
    const existing = rowSaveTimers.current[id];
    if (existing) clearTimeout(existing);
    rowSaveTimers.current[id] = setTimeout(() => { void flushRowSave(id); }, ROW_SAVE_DEBOUNCE_MS);
  }, [flushRowSave]);

  const saveInstructions = async (rowId: number, data: TaskInstructionsData) => {
    const row_meta = { instructions: data };
    if (rowSaveTimers.current[rowId]) clearTimeout(rowSaveTimers.current[rowId]);
    delete rowSaveTimers.current[rowId];
    delete rowPendingUpdates.current[rowId];
    await supabase.from('skyline_form_question_rows').update({ row_meta }).eq('id', rowId);
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, row_meta } : r)));
  };

  const isAssessmentTasks = sectionPdfMode === 'assessment_tasks';

  const removeRow = async (r: QuestionRow) => {
    if (!window.confirm('Remove this row? This cannot be undone.')) return;
    delete rowSaveTimers.current[r.id];
    delete rowPendingUpdates.current[r.id];
    if (isAssessmentTasks && formId && onStepsCreated) {
      const { data: sections } = await supabase.from('skyline_form_sections').select('step_id').eq('assessment_task_row_id', r.id);
      const stepIds = [...new Set((sections || []).map((s: { step_id: number }) => s.step_id))];
      for (const stepId of stepIds) {
        await supabase.from('skyline_form_sections').delete().eq('step_id', stepId);
        await supabase.from('skyline_form_steps').delete().eq('id', stepId);
      }
      onStepsCreated();
    }
    await supabase.from('skyline_form_question_rows').delete().eq('id', r.id);
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <div>
      <div className="text-sm font-semibold mb-2">{isAssessmentTasks ? 'Assessment tasks' : 'Table rows'}</div>
      {isAssessmentTasks ? (
        <p className="text-xs text-gray-600 mb-3">
          Each task automatically gets <strong>Instructions</strong>, <strong>Questions</strong>, and <strong>Results</strong> sections. Click <strong>Edit instructions</strong> to add content. Add questions in the task&apos;s Questions section.
        </p>
      ) : gridTableLayout === 'no_image' ? (
        <p className="text-xs text-gray-600 mb-3">
          Each row = one table row. <strong>Row label</strong> → 1st column. <strong>Description</strong> → 2nd column. Add input columns in Table layout below.
        </p>
      ) : gridTableLayout === 'no_image_no_header' ? (
        <p className="text-xs text-gray-600 mb-3">
          Each row = one table row. Header row is hidden in this layout.
        </p>
      ) : (
        <p className="text-xs text-gray-600 mb-3">
          Each row = one table row. <strong>Row label</strong> = first column (e.g. Polygon Name). <strong>Image</strong> = optional (upload or URL). <strong>Description</strong> = for question-type columns.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 p-2 rounded border border-gray-200">
            <div className="flex gap-2 items-center">
              <Input
                value={r.row_label}
                onChange={(e) => updateRow(r.id, { row_label: e.target.value })}
                onBlur={() => { void flushRowSave(r.id); }}
                placeholder={isAssessmentTasks ? 'Evidence number (e.g. Assessment task 1)' : 'Row label'}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={() => removeRow(r)} title="Remove row" className="text-red-600 hover:text-red-700 hover:border-red-300">
                <Trash2 className="w-4 h-4" />
              </Button>
              {!isAssessmentTasks && !simpleLabelsOnly && gridTableLayout !== 'no_image' && (
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id={`row-image-${r.id}`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !formId) return;
                      setUploadingRowId(r.id);
                      const { url, error } = await uploadRowImage(formId, questionId, r.id, file);
                      setUploadingRowId(null);
                      e.target.value = '';
                      if (error) alert(`Upload failed: ${error}`);
                      else if (url) updateRow(r.id, { row_image_url: url });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!formId || uploadingRowId === r.id}
                    onClick={() => document.getElementById(`row-image-${r.id}`)?.click()}
                  >
                    {uploadingRowId === r.id ? 'Uploading…' : <ImagePlus className="w-4 h-4" />}
                  </Button>
                  <Input
                    value={r.row_image_url || ''}
                    onChange={(e) => updateRow(r.id, { row_image_url: e.target.value || null })}
                    onBlur={() => { void flushRowSave(r.id); }}
                    placeholder="Or paste image URL"
                    className="w-40"
                  />
                </div>
              )}
              {isAssessmentTasks && (
                <Button variant="outline" size="sm" onClick={() => setInstructionsModalRow(r)}>
                  Edit instructions
                </Button>
              )}
            </div>
            {!isAssessmentTasks && !simpleLabelsOnly && (
              <Textarea
                value={r.row_help || ''}
                onChange={(e) => updateRow(r.id, { row_help: e.target.value || null })}
                onBlur={() => { void flushRowSave(r.id); }}
                placeholder={gridTableLayout === 'no_image' ? '2nd column content (e.g. question or description)' : 'Description / question text (for 2nd column or question-type columns)'}
                rows={2}
                className="text-sm"
              />
            )}
            {isAssessmentTasks && (
              <Textarea
                value={r.row_help || ''}
                onChange={(e) => updateRow(r.id, { row_help: e.target.value || null })}
                onBlur={() => { void flushRowSave(r.id); }}
                placeholder="Assessment method/ Type of evidence (use new lines for multiple items)"
                rows={2}
                className="text-sm"
              />
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addRow} className="mt-2">
        + Add row
      </Button>
      {instructionsModalRow && (
        <TaskInstructionsModal
          isOpen={!!instructionsModalRow}
          onClose={() => setInstructionsModalRow(null)}
          rowLabel={instructionsModalRow.row_label}
          initialData={(instructionsModalRow.row_meta as { instructions?: TaskInstructionsData })?.instructions}
          onSave={(data) => saveInstructions(instructionsModalRow.id, data)}
        />
      )}
    </div>
  );
}
