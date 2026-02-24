import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchTemplateForInstance,
  fetchAnswersForInstance,
  fetchInstance,
  saveAnswer,
  saveTrainerAssessment,
  fetchTrainerAssessments,
  fetchResultsOffice,
  saveResultsOffice,
  fetchResultsData,
  saveResultsData,
  fetchAssessmentSummaryData,
  saveAssessmentSummaryData,
  updateInstanceRole,
} from '../lib/formEngine';
import type { FormTemplate } from '../lib/formEngine';
import type { FormAnswer } from '../types/database';
import type { FormRole } from '../utils/roleGuard';
import { isRoleVisible, isRoleEditable } from '../utils/roleGuard';
import { Card } from '../components/ui/Card';
import { Loader } from '../components/ui/Loader';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Stepper } from '../components/ui/Stepper';
import { QuestionRenderer } from '../components/form-fill/QuestionRenderer';
import { SectionLikertTable } from '../components/form-fill/SectionLikertTable';
import { SignatureField } from '../components/form-fill/SignatureField';
import { DatePicker } from '../components/ui/DatePicker';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

function getAnswerKey(questionId: number, rowId: number | null): string {
  if (rowId === null) return `q-${questionId}`;
  return `q-${questionId}-${rowId}`;
}

function parseAnswerValue(a: FormAnswer): string | number | boolean | Record<string, unknown> | string[] | null {
  if (a.value_text) return a.value_text;
  if (a.value_number != null) return a.value_number;
  if (a.value_json != null) return a.value_json as Record<string, unknown> | string[];
  return null;
}

export const InstanceFillPage: React.FC = () => {
  const { instanceId } = useParams<{ instanceId: string }>();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | Record<string, unknown> | string[]>>({});
  const [trainerAssessments, setTrainerAssessments] = useState<Record<number, string>>({});
  const [resultsOffice, setResultsOffice] = useState<Record<number, { entered_date: string | null; entered_by: string | null }>>({});
  const [resultsData, setResultsData] = useState<Record<number, import('../lib/formEngine').ResultsDataEntry>>({});
  const [assessmentSummary, setAssessmentSummary] = useState<import('../lib/formEngine').AssessmentSummaryDataEntry | null>(null);
  const [role, setRole] = useState<FormRole>('student');
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const id = instanceId ? Number(instanceId) : 0;
  const [pdfRefresh, setPdfRefresh] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(true);
  const pdfCacheBust = useMemo(() => Date.now(), [id, pdfRefresh]);
  useEffect(() => {
    setPdfLoading(true);
  }, [pdfCacheBust]);

  const loadData = useCallback(async () => {
    if (!id) return;
    const [tpl, ans, inst, assessments, officeData, resultsDataRes, summaryData] = await Promise.all([
      fetchTemplateForInstance(id),
      fetchAnswersForInstance(id),
      fetchInstance(id),
      fetchTrainerAssessments(id).catch(() => ({})),
      fetchResultsOffice(id).catch(() => ({})),
      fetchResultsData(id).catch(() => ({})),
      fetchAssessmentSummaryData(id).catch(() => null),
    ]);
    setTemplate(tpl || null);
    const roleCtx = (inst?.role_context as FormRole) || 'student';
    setRole(roleCtx);
    const ansMap: Record<string, string | number | boolean | Record<string, unknown> | string[]> = {};
    for (const a of ans) {
      const key = getAnswerKey(a.question_id, a.row_id);
      ansMap[key] = parseAnswerValue(a) as string | number | boolean | Record<string, unknown> | string[];
    }
    setAnswers(ansMap);
    setTrainerAssessments(assessments || {});
    const officeMap: Record<number, { entered_date: string | null; entered_by: string | null }> = {};
    for (const [secId, entry] of Object.entries(officeData || {})) {
      const e = entry as { entered_date: string | null; entered_by: string | null };
      officeMap[Number(secId)] = { entered_date: e.entered_date, entered_by: e.entered_by };
    }
    setResultsOffice(officeMap);
    setResultsData(resultsDataRes || {});
    setAssessmentSummary(summaryData || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleResultsDataChange = useCallback(
    (sectionId: number, field: keyof import('../lib/formEngine').ResultsDataEntry, value: string | null) => {
      setResultsData((prev) => {
        const next = { ...prev };
        if (!next[sectionId]) next[sectionId] = { section_id: sectionId } as import('../lib/formEngine').ResultsDataEntry;
        (next[sectionId] as unknown as Record<string, unknown>)[field] = value;
        saveResultsData(id, sectionId, { [field]: value });
        setPdfRefresh((r) => r + 1);
        return next;
      });
    },
    [id]
  );

  useEffect(() => {
    if (!template || !id) return;
    const studentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
    const trainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
    const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '').trim() : '';
    const trainerName = trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '').trim() : '';
    if (!studentName && !trainerName) return;
    const taskResultSections = template.steps?.flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results') ?? [];
    const updates: { sectionId: number; field: 'student_name' | 'trainer_name'; value: string }[] = [];
    for (const sec of taskResultSections) {
      const rd = resultsData[sec.id];
      if (studentName && (!rd?.student_name || !String(rd.student_name).trim())) {
        updates.push({ sectionId: sec.id, field: 'student_name', value: studentName });
      }
      if (trainerName && (!rd?.trainer_name || !String(rd.trainer_name).trim())) {
        updates.push({ sectionId: sec.id, field: 'trainer_name', value: trainerName });
      }
    }
    if (updates.length === 0) return;
    setResultsData((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        if (!next[u.sectionId]) next[u.sectionId] = { section_id: u.sectionId } as import('../lib/formEngine').ResultsDataEntry;
        (next[u.sectionId] as unknown as Record<string, unknown>)[u.field] = u.value;
        saveResultsData(id, u.sectionId, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, id]);

  useEffect(() => {
    if (!template || !id) return;
    const studentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
    const trainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
    const evalStudentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'evaluation.studentName');
    const evalTrainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'evaluation.trainerName');
    const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '').trim() : '';
    const trainerName = trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '').trim() : '';
    if (!studentName && !trainerName) return;
    const updates: { questionId: number; value: string }[] = [];
    if (evalStudentNameQ && studentName) {
      const current = String(answers[getAnswerKey(evalStudentNameQ.id, null)] ?? '').trim();
      if (!current) updates.push({ questionId: evalStudentNameQ.id, value: studentName });
    }
    if (evalTrainerNameQ && trainerName) {
      const current = String(answers[getAnswerKey(evalTrainerNameQ.id, null)] ?? '').trim();
      if (!current) updates.push({ questionId: evalTrainerNameQ.id, value: trainerName });
    }
    if (updates.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        next[getAnswerKey(u.questionId, null)] = u.value;
      }
      return next;
    });
    for (const u of updates) {
      saveAnswer(id, u.questionId, null, { text: u.value });
    }
    setPdfRefresh((r) => r + 1);
  }, [template, answers, id]);

  useEffect(() => {
    if (!template || !id) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
    const raDateSource = firstTaskRd?.trainer_date ?? assessmentSummary?.trainer_date_1;
    if (!raDateSource) return;
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    if (!raTrainerQ) return;
    const raVal = answers[getAnswerKey(raTrainerQ.id, null)];
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    if (raDate) return;
    const base = raSigObj && typeof raSigObj === 'object' ? { ...raSigObj } : (typeof raVal === 'string' ? { signature: raVal } : {});
    const newVal = { ...base, date: raDateSource };
    setAnswers((prev) => {
      const next = { ...prev };
      next[getAnswerKey(raTrainerQ.id, null)] = newVal as string | number | boolean | Record<string, unknown> | string[];
      return next;
    });
    saveAnswer(id, raTrainerQ.id, null, { json: newVal });
    setPdfRefresh((r) => r + 1);
  }, [template, answers, resultsData, assessmentSummary, id]);

  useEffect(() => {
    if (!template || !id) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    const today = new Date().toISOString().split('T')[0];
    const updates: { sectionId: number; field: 'trainer_date' | 'first_attempt_date' | 'second_attempt_date'; value: string }[] = [];
    for (const sectionId of taskResultSectionIds) {
      const rd = resultsData[sectionId];
      const firstTaskData = firstTaskSectionId && firstTaskSectionId !== sectionId ? resultsData[firstTaskSectionId] : null;
      const trainerDateVal = raTrainerDate || (firstTaskData?.trainer_date ?? today);
      const firstAttemptVal = raTrainerDate || (firstTaskData?.first_attempt_date ?? today);
      const secondAttemptVal = rd?.first_attempt_date || (firstTaskData?.second_attempt_date ?? today);
      if (!rd?.trainer_date && trainerDateVal) updates.push({ sectionId, field: 'trainer_date', value: trainerDateVal });
      if (!rd?.first_attempt_date && firstAttemptVal) updates.push({ sectionId, field: 'first_attempt_date', value: firstAttemptVal });
      if (!rd?.second_attempt_date && secondAttemptVal) updates.push({ sectionId, field: 'second_attempt_date', value: secondAttemptVal });
    }
    if (updates.length === 0) return;
    setResultsData((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        if (!next[u.sectionId]) next[u.sectionId] = { section_id: u.sectionId } as import('../lib/formEngine').ResultsDataEntry;
        (next[u.sectionId] as unknown as Record<string, unknown>)[u.field] = u.value;
        saveResultsData(id, u.sectionId, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, id]);

  useEffect(() => {
    if (!template || !id || !assessmentSummary) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    const today = new Date().toISOString().split('T')[0];
    const trainerRefDate = raTrainerDate || (firstTaskRd?.trainer_date ?? today);
    const studentDeclQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
    const studentDeclVal = studentDeclQ ? answers[getAnswerKey(studentDeclQ.id, null)] : undefined;
    const studentDeclSigObj = studentDeclVal && typeof studentDeclVal === 'object' && !Array.isArray(studentDeclVal) ? (studentDeclVal as Record<string, unknown>) : null;
    const studentDeclDate = studentDeclSigObj ? String(studentDeclSigObj.date ?? studentDeclSigObj.signedAtDate ?? '') : '';
    const sum = assessmentSummary;
    const updates: { field: keyof import('../lib/formEngine').AssessmentSummaryDataEntry; value: string }[] = [];
    if (!sum.trainer_date_1 && trainerRefDate) updates.push({ field: 'trainer_date_1', value: trainerRefDate });
    if (!sum.trainer_date_2 && sum.trainer_date_1) updates.push({ field: 'trainer_date_2', value: sum.trainer_date_1 });
    if (!sum.trainer_date_3 && sum.trainer_date_1) updates.push({ field: 'trainer_date_3', value: sum.trainer_date_1 });
    if (!sum.student_date_1 && studentDeclDate) updates.push({ field: 'student_date_1', value: studentDeclDate });
    if (!sum.student_date_2 && (studentDeclDate || sum.student_date_1)) updates.push({ field: 'student_date_2', value: studentDeclDate || sum.student_date_1! });
    if (!sum.student_date_3 && (studentDeclDate || sum.student_date_1)) updates.push({ field: 'student_date_3', value: studentDeclDate || sum.student_date_1! });
    if (updates.length === 0) return;
    setAssessmentSummary((prev) => {
      const next = prev ? { ...prev } : ({} as import('../lib/formEngine').AssessmentSummaryDataEntry);
      for (const u of updates) {
        (next as unknown as Record<string, unknown>)[u.field] = u.value;
        saveAssessmentSummaryData(id, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, assessmentSummary, id]);

  const debouncedSave = useCallback(
    (questionId: number, rowId: number | null, value: string | number | boolean | Record<string, unknown> | string[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        let text: string | undefined;
        let num: number | undefined;
        let json: unknown;
        if (typeof value === 'string') text = value;
        else if (typeof value === 'number') num = value;
        else if (typeof value === 'boolean') text = value ? 'true' : 'false';
        else if (Array.isArray(value)) json = value;
        else if (value && typeof value === 'object') json = value;
        await saveAnswer(id, questionId, rowId, { text, number: num, json });
      }, 300);
    },
    [id]
  );

  const handleAnswerChange = useCallback(
    (questionId: number, rowId: number | null, value: string | number | boolean | Record<string, unknown> | string[]) => {
      const key = getAnswerKey(questionId, rowId);
      setAnswers((prev) => ({ ...prev, [key]: value }));
      debouncedSave(questionId, rowId, value);
    },
    [debouncedSave]
  );

  const handleTrainerAssessmentChange = useCallback(
    (questionId: number, satisfactory: 'yes' | 'no') => {
      setTrainerAssessments((prev) => ({ ...prev, [questionId]: satisfactory }));
      saveTrainerAssessment(id, questionId, satisfactory);
      setPdfRefresh((r) => r + 1);
    },
    [id]
  );

  const handleResultsOfficeChange = useCallback(
    (sectionId: number, field: 'entered_date' | 'entered_by', value: string | null) => {
      setResultsOffice((prev) => {
        const next = { ...prev };
        if (!next[sectionId]) next[sectionId] = { entered_date: null, entered_by: null };
        next[sectionId] = { ...next[sectionId], [field]: value };
        saveResultsOffice(id, sectionId, next[sectionId].entered_date, next[sectionId].entered_by);
        setPdfRefresh((r) => r + 1);
        return next;
      });
    },
    [id]
  );

  const handleAssessmentSummaryChange = useCallback(
    (field: keyof import('../lib/formEngine').AssessmentSummaryDataEntry, value: string | null) => {
      setAssessmentSummary((prev) => {
        const next: import('../lib/formEngine').AssessmentSummaryDataEntry = prev ? { ...prev, [field]: value } : ({ [field]: value } as unknown as import('../lib/formEngine').AssessmentSummaryDataEntry);
        saveAssessmentSummaryData(id, { [field]: value });
        setPdfRefresh((r) => r + 1);
        return next;
      });
    },
    [id]
  );

  const handleRoleChange = useCallback(
    (newRole: FormRole) => {
      setRole(newRole);
      updateInstanceRole(id, newRole);
    },
    [id]
  );

  const validateStep = useCallback(
    (stepNumber: number): boolean => {
      if (!template || stepNumber <= 1) return true;
      const stepData = template.steps[stepNumber - 2];
      if (!stepData) return true;
      const stepErrors: Record<string, string> = {};
      for (const section of stepData.sections) {
        for (const q of section.questions) {
          if (q.type === 'instruction_block' || q.type === 'page_break') continue;
          if (!isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role)) continue;
          const editable = isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role);
          if (!q.required || !editable) continue;
          const key = getAnswerKey(q.id, null);
          const val = answers[key];
          const strVal = val != null ? String(val).trim() : '';
          if (!strVal) {
            stepErrors[`q-${q.id}`] = `${q.label} is required`;
          }
        }
      }
      setErrors(stepErrors);
      return Object.keys(stepErrors).length === 0;
    },
    [template, role, answers]
  );

  if (loading || !template) {
    return <Loader fullPage variant="dots" size="lg" message="Loading..." />;
  }

  // Introduction step is always first, then form steps
  const steps = [
    { number: 1, label: 'Introduction', description: 'Student Pack overview' },
    ...template.steps.map((s, i) => ({
      number: i + 2,
      label: s.title,
      description: s.subtitle || '',
    })),
  ];

  const isIntroductionStep = currentStep === 1;
  const currentStepData = isIntroductionStep ? null : template.steps[currentStep - 2];
  const visibleQuestions: { q: typeof template.steps[0]['sections'][0]['questions'][0]; section: typeof template.steps[0]['sections'][0] }[] = [];

  if (currentStepData) {
    for (const section of currentStepData.sections) {
      for (const q of section.questions) {
        const rv = (q.role_visibility as Record<string, boolean>) || {};
        if (isRoleVisible(rv, role)) {
          visibleQuestions.push({ q, section });
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
        <div className="w-full px-4 md:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h1 className="text-xl font-bold text-[var(--text)]">{template.form.name}</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">Role:</span>
              <Select
                value={role}
                onChange={(v) => handleRoleChange(v as FormRole)}
                options={[
                  { value: 'student', label: 'Student' },
                  { value: 'trainer', label: 'Trainer' },
                  { value: 'office', label: 'Office' },
                ]}
                className="w-32"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-9 space-y-6 overflow-y-auto max-h-[calc(100vh-8rem)] pr-2">
            <Card>
              <Stepper steps={steps} currentStep={currentStep} />
            </Card>

            {isIntroductionStep ? (
              <Card>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">Student Pack</h2>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">What is the purpose of this document?</h3>
                <p className="text-gray-700 mb-4">
                  The Student Pack is the document you, the student, needs to complete to demonstrate competency. This document includes the context and conditions of your assessment, the tasks to be completed by you and an outline of the evidence to be gathered.
                </p>
                <h4 className="font-semibold text-gray-700 mb-2">The information includes the following:</h4>
                <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                  <li>Information related to the unit of competency.</li>
                  <li>Guidelines and instructions to complete each task and activity.</li>
                  <li>A student evaluation form</li>
                </ul>
                <h4 className="font-semibold text-gray-700 mb-2">Student Evaluation Form</h4>
                <p className="text-gray-700 mb-4">
                  These documents are designed after conducting thorough industry consultation. Students are encouraged to evaluate this document and provide constructive feedback to their training organisation if they feel that this document can be improved.
                </p>
                <h4 className="font-semibold text-gray-700 mb-2">Link to other unit documents</h4>
                <ul className="list-disc list-inside text-gray-700 space-y-2">
                  <li>The Student Pack is a document for students to complete to demonstrate their competency. This document includes context and conditions of assessment, tasks to be administered to the student, and an outline of the evidence to be gathered from the student.</li>
                  <li>The Unit Mapping is a document that contains information and comprehensive mapping with the training package requirements.</li>
                </ul>
              </Card>
            ) : currentStepData ? (
              <Card>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">
                  Step {currentStep}: {currentStepData.title}
                </h2>
                {currentStepData.sections
                  .filter((section) => {
                    const hasInteractive = section.questions.some(
                      (q) => q.type !== 'instruction_block' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role)
                    );
                    return hasInteractive || section.pdf_render_mode === 'assessment_tasks' || section.pdf_render_mode === 'assessment_submission' || section.pdf_render_mode === 'reasonable_adjustment' || section.pdf_render_mode === 'task_instructions' || section.pdf_render_mode === 'task_questions' || section.pdf_render_mode === 'task_results' || section.pdf_render_mode === 'assessment_summary';
                  })
                  .map((section) => (
                  <div key={section.id} className="mb-8 last:mb-0">
                    {section.pdf_render_mode !== 'likert_table' && section.pdf_render_mode !== 'reasonable_adjustment' && section.pdf_render_mode !== 'task_instructions' && section.pdf_render_mode !== 'task_questions' && section.pdf_render_mode !== 'task_results' && section.pdf_render_mode !== 'assessment_summary' && (
                      <h3 className="text-lg font-semibold text-gray-700 mb-2">{section.title}</h3>
                    )}
                    <div className={section.pdf_render_mode === 'declarations' || section.pdf_render_mode === 'assessment_submission' ? 'border border-gray-200 rounded-lg p-4 bg-white space-y-4' : 'space-y-4'}>
                      {section.pdf_render_mode === 'reasonable_adjustment' ? (
                        (() => {
                          const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskRdForRA = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                          const sumForRA = assessmentSummary;
                          const raSigSuggestion = firstTaskRdForRA?.trainer_signature ?? sumForRA?.trainer_sig_1 ?? null;
                          const raDateSuggestion = firstTaskRdForRA?.trainer_date ?? sumForRA?.trainer_date_1 ?? new Date().toISOString().split('T')[0];
                          return (
                        <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3 flex items-center gap-2">
                            <span className="text-sm">&#9654;</span>
                            <span>Reasonable Adjustment</span>
                          </div>
                          <div className="p-4 space-y-4">
                            {section.questions
                              .filter((q) => isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                              .map((q) => {
                                const re = (q.role_editability as Record<string, boolean>) || {};
                                const editable = isRoleEditable(re, role);
                                const key = getAnswerKey(q.id, null);
                                const val = answers[key];
                                if (q.type === 'yes_no') {
                                  return (
                                    <QuestionRenderer
                                      key={q.id}
                                      question={q}
                                      value={(val as string | number | boolean) ?? null}
                                      onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean)}
                                      disabled={!editable}
                                      error={errors[`q-${q.id}`]}
                                    />
                                  );
                                }
                                if (q.code === 'reasonable_adjustment.task') {
                                  return (
                                    <QuestionRenderer
                                      key={q.id}
                                      question={q}
                                      value={(val as string) ?? null}
                                      onChange={(v) => handleAnswerChange(q.id, null, v as string)}
                                      disabled={!editable}
                                      error={errors[`q-${q.id}`]}
                                    />
                                  );
                                }
                                if (q.type === 'long_text') {
                                  return (
                                    <QuestionRenderer
                                      key={q.id}
                                      question={q}
                                      value={(val as string) ?? null}
                                      onChange={(v) => handleAnswerChange(q.id, null, v as string)}
                                      disabled={!editable}
                                      error={errors[`q-${q.id}`]}
                                    />
                                  );
                                }
                                if (q.type === 'signature') {
                                  const sigVal = val;
                                  const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                                  const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                                  const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                                  return (
                                    <div key={q.id} className="flex items-center gap-4 flex-wrap pt-2">
                                      <div className="flex-1 min-w-[200px]">
                                        <div className="text-sm font-semibold text-gray-700 mb-1">{q.label}</div>
                                        <SignatureField
                                          value={(imgVal as string | null) ?? null}
                                          onChange={(v) => {
                                            const img = typeof v === 'string' ? v : null;
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                            handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!editable}
                                          suggestionFrom={raSigSuggestion}
                                          onSuggestionClick={raSigSuggestion && editable ? () => {
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            handleAnswerChange(q.id, null, { ...base, signature: raSigSuggestion, date: raDateSuggestion } as string | number | boolean | Record<string, unknown> | string[]);
                                          } : undefined}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2 min-w-[140px]">
                                        <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                        <DatePicker
                                          value={dateVal}
                                          onChange={(newDate) => {
                                            const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                            handleAnswerChange(q.id, null, { ...base, date: newDate } as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!editable}
                                          compact
                                          placement="above"
                                          className="flex-1 min-w-0"
                                        />
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                          </div>
                        </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_tasks' ? (
                        (() => {
                          const taskQ = section.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
                          if (!taskQ) return null;
                          return (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border border-black text-sm">
                                <thead>
                                  <tr>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-3 text-left border border-black">Evidence number</th>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-3 text-left border border-black">Assessment method/ Type of evidence</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {taskQ.rows.map((row, i) => (
                                    <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F0F4FA]'}>
                                      <td className="p-3 font-semibold border border-black">{row.row_label}</td>
                                      <td className="p-3 border border-black whitespace-pre-line">{row.row_help || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_submission' ? (
                        <div className="border border-black p-4 bg-white">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                            {section.questions
                              .filter((q) => isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                              .map((q) =>
                                q.type === 'multi_choice' ? (
                                  <React.Fragment key={q.id}>
                                    {q.options?.map((opt) => {
                                      const isLms = /lms|learning management/i.test(opt.label);
                                      const isOther = opt.value === 'other';
                                      const spanFull = isLms || isOther;
                                      const rawVal = answers[getAnswerKey(q.id, null)];
                                      const currentArr = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' ? rawVal.split(',').map((s) => s.trim()).filter(Boolean) : []);
                                      const selected = currentArr.includes(opt.value);
                                      const submissionEditable = section.pdf_render_mode === 'assessment_submission' || isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role);
                                      return (
                                        <label
                                          key={opt.id}
                                          className={`flex items-center gap-2 cursor-pointer ${spanFull ? 'col-span-2' : ''} ${!submissionEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => {
                                              const next = selected
                                                ? currentArr.filter((v) => v !== opt.value)
                                                : [...currentArr, opt.value];
                                              handleAnswerChange(q.id, null, next);
                                            }}
                                            disabled={!submissionEditable}
                                            className="w-[18px] h-[18px] flex-shrink-0 cursor-pointer accent-gray-800"
                                          />
                                          <span className="text-gray-700">{opt.label}</span>
                                          {isOther && (
                                            <span className="flex-1 border-b border-gray-600 min-w-[120px] min-h-[18px]" />
                                          )}
                                        </label>
                                      );
                                    })}
                                  </React.Fragment>
                                ) : q.type === 'short_text' ? (
                                  <div key={q.id} className="col-span-2 mt-2 text-center">
                                    <input
                                      type="text"
                                      value={(answers[getAnswerKey(q.id, null)] as string) ?? ''}
                                      onChange={(e) => handleAnswerChange(q.id, null, e.target.value)}
                                      disabled={!(section.pdf_render_mode === 'assessment_submission' || isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role))}
                                      className="w-full max-w-[300px] mx-auto border-0 border-b border-gray-600 bg-transparent px-2 py-1 text-center focus:outline-none focus:ring-0"
                                      placeholder=""
                                    />
                                    <div className="text-xs italic text-gray-500 mt-1">(Please describe here)</div>
                                  </div>
                                ) : null
                              )}
                          </div>
                        </div>
                      ) : section.pdf_render_mode === 'task_instructions' ? (
                        (() => {
                          const taskRow = (section as { taskRow?: { row_label: string; row_help: string | null; row_meta?: { instructions?: Record<string, string | string[]> } } }).taskRow;
                          const instr = taskRow?.row_meta?.instructions;
                          if (!instr) return <div className="text-gray-500 italic">No instructions configured for this task.</div>;
                          const blocks: { title: string; content: string }[] = [
                            { title: 'Assessment type', content: String(instr.assessment_type || '') },
                            { title: 'Instructions provided to the student:', content: String(instr.task_description || '') },
                            { title: 'Applicable conditions:', content: String(instr.applicable_conditions || '') },
                            { title: 'Resubmissions and reattempts:', content: String(instr.resubmissions || '') },
                            { title: 'Location:', content: String(instr.location_intro || '') + (Array.isArray(instr.location_options) ? '<ul><li>' + instr.location_options.join('</li><li>') + '</li></ul>' : '') + String(instr.location_note || '') },
                            { title: 'Instructions for answering the written questions:', content: String(instr.answering_instructions || '') },
                            { title: 'Purpose of the assessment', content: String(instr.purpose_intro || '') + String(instr.purpose_bullets || '') },
                            { title: 'Task instructions', content: String(instr.task_instructions || '') },
                          ];
                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                              <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                                Student Instructions: {taskRow?.row_label || section.title}
                              </div>
                              <div className="p-4 space-y-4">
                                {blocks.filter((b) => b.content.replace(/<[^>]*>/g, '').trim()).map((b, i) => (
                                  <div key={i}>
                                    <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">{b.title}</div>
                                    <div className="border border-gray-200 border-t-0 rounded-b p-3 bg-gray-50 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: b.content }} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'task_questions' ? (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                            {section.title}
                          </div>
                          <div className="bg-[#6b7280] text-white text-sm px-4 py-2">
                            Provide your response to each question in the box below.
                          </div>
                          <div className="w-full overflow-x-auto">
                            <table className="w-full border-collapse text-sm table-fixed">
                              <thead>
                                <tr>
                                  <th className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 text-left align-top" style={{ width: 'calc(100% - 9rem)' }}>
                                    Question
                                  </th>
                                  <th className="bg-gray-200 font-semibold text-gray-700 p-2 border border-gray-300 text-center align-top break-words" style={{ width: '9rem', minWidth: 0 }}>
                                    Satisfactory response
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {section.questions
                                  .filter((q) => q.type !== 'instruction_block' && q.type !== 'page_break' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                                  .map((q, qIdx) => {
                                    const re = (q.role_editability as Record<string, boolean>) || {};
                                    const editable = isRoleEditable(re, role);
                                    const trainerEditable = role === 'trainer' || role === 'office';
                                    const sat = trainerAssessments[q.id];
                                    const satYes = sat === 'yes';
                                    const satNo = sat === 'no';
                                    return (
                                      <tr key={q.id} className={qIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="p-3 border border-gray-300 align-top">
                                          {q.type === 'grid_table' && q.rows.length > 0 ? (
                                            (() => {
                                              const merged: Record<string, string> = {};
                                              for (const r of q.rows) {
                                                const v = answers[getAnswerKey(q.id, r.id)];
                                                if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                                              }
                                              const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                                                const byRow = new Map<number, Record<string, string>>();
                                                const o = v as Record<string, string>;
                                                if (!o || typeof o !== 'object') return;
                                                for (const [k, val] of Object.entries(o)) {
                                                  const match = /^r(\d+)_c/.exec(k);
                                                  if (match) {
                                                    const rowId = Number(match[1]);
                                                    if (!byRow.has(rowId)) byRow.set(rowId, {});
                                                    byRow.get(rowId)![k] = String(val);
                                                  }
                                                }
                                                for (const [rowId, rowData] of byRow.entries()) {
                                                  handleAnswerChange(q.id, rowId, rowData);
                                                }
                                              };
                                              return (
                                                <QuestionRenderer
                                                  question={q}
                                                  value={Object.keys(merged).length ? merged : null}
                                                  onChange={onGridChange}
                                                  disabled={!editable}
                                                  error={errors[`q-${q.id}`]}
                                                />
                                              );
                                            })()
                                          ) : (
                                            <QuestionRenderer
                                              question={q}
                                              value={(answers[getAnswerKey(q.id, null)] as string | number | boolean | Record<string, unknown> | string[] | undefined) ?? null}
                                              onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])}
                                              disabled={!editable}
                                              error={errors[`q-${q.id}`]}
                                            />
                                          )}
                                        </td>
                                        <td className="p-2 border border-gray-300 align-top" style={{ width: '9.5rem' }}>
                                          <div className="flex flex-row items-center justify-center gap-3">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`trainer-sat-${q.id}`}
                                                checked={satYes}
                                                onChange={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'yes')}
                                                disabled={!trainerEditable}
                                                className="w-4 h-4 border-gray-600"
                                              />
                                              <span>Yes</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`trainer-sat-${q.id}`}
                                                checked={satNo}
                                                onChange={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'no')}
                                                disabled={!trainerEditable}
                                                className="w-4 h-4 border-gray-600"
                                              />
                                              <span>No</span>
                                            </label>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : section.pdf_render_mode === 'task_results' ? (
                        (() => {
                          const rd = resultsData[section.id];
                          const trainerCanEdit = role === 'trainer' || role === 'office';
                          const studentCanEdit = role === 'student' || role === 'office';
                          const taskResultSectionIds = (template?.steps || []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskData = firstTaskSectionId && firstTaskSectionId !== section.id ? resultsData[firstTaskSectionId] : null;
                          const raTrainerQForResults = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
                          const raValForResults = raTrainerQForResults ? answers[getAnswerKey(raTrainerQForResults.id, null)] : undefined;
                          const raSigObjForResults = raValForResults && typeof raValForResults === 'object' && !Array.isArray(raValForResults) ? (raValForResults as Record<string, unknown>) : null;
                          const raTrainerSigForResults = raSigObjForResults ? (String(raSigObjForResults.signature ?? raSigObjForResults.imageDataUrl ?? '') || null) : (typeof raValForResults === 'string' ? raValForResults : null);
                          const raTrainerDateForResults = raSigObjForResults ? String(raSigObjForResults.date ?? raSigObjForResults.signedAtDate ?? '') : '';
                          const trainerSuggestionSig = raTrainerSigForResults ?? firstTaskData?.trainer_signature ?? null;
                          const todayForResults = new Date().toISOString().split('T')[0];
                          const trainerSuggestionDate = raTrainerDateForResults || (firstTaskData?.trainer_date ?? todayForResults);
                          const studentDeclQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
                          const studentDeclVal = studentDeclQ ? answers[getAnswerKey(studentDeclQ.id, null)] : undefined;
                          const studentDeclSigObj = studentDeclVal && typeof studentDeclVal === 'object' && !Array.isArray(studentDeclVal) ? (studentDeclVal as Record<string, unknown>) : null;
                          const studentDeclSig = studentDeclSigObj ? (String(studentDeclSigObj.signature ?? studentDeclSigObj.imageDataUrl ?? '') || null) : (typeof studentDeclVal === 'string' ? studentDeclVal : null);
                          const studentSuggestionSig = studentDeclSig ?? firstTaskData?.student_signature ?? null;
                          const studentNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
                          const trainerNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
                          const suggestedStudentName = !rd?.student_name && studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '') : null;
                          const suggestedTrainerName = !rd?.trainer_name && trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '') : null;
                          return (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                            {((section as { taskRow?: { row_label: string } }).taskRow?.row_label || section.title) + ' – Results Sheet'}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                <tr>
                                  <td className="w-1/4 bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 align-top" rowSpan={2}>
                                    Outcome
                                  </td>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <div className="font-semibold mb-2">First attempt:</div>
                                    <div className="mb-2">Outcome (make sure to tick the correct checkbox):</div>
                                    <div className="flex gap-4 mb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-first`}
                                          checked={rd?.first_attempt_satisfactory === 's'}
                                          onChange={() => trainerCanEdit && handleResultsDataChange(section.id, 'first_attempt_satisfactory', 's')}
                                          disabled={!trainerCanEdit}
                                          className="w-4 h-4"
                                        />
                                        <span>Satisfactory (S)</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-first`}
                                          checked={rd?.first_attempt_satisfactory === 'ns'}
                                          onChange={() => trainerCanEdit && handleResultsDataChange(section.id, 'first_attempt_satisfactory', 'ns')}
                                          disabled={!trainerCanEdit}
                                          className="w-4 h-4"
                                        />
                                        <span>Not Satisfactory (NS)</span>
                                      </label>
                                    </div>
                                    <div className="mb-2"><span className="font-medium">Date:</span>{' '}
                                      <DatePicker
                                        value={rd?.first_attempt_date ?? ''}
                                        onChange={(v) => handleResultsDataChange(section.id, 'first_attempt_date', v || null)}
                                        disabled={!trainerCanEdit}
                                        compact
                                        placement="above"
                                        className="inline-block min-w-[120px]"
                                      />
                                    </div>
                                    <div><span className="font-medium">Feedback:</span>
                                      <textarea
                                        value={rd?.first_attempt_feedback ?? ''}
                                        onChange={(e) => handleResultsDataChange(section.id, 'first_attempt_feedback', e.target.value || null)}
                                        disabled={!trainerCanEdit}
                                        className="block w-full border border-gray-300 min-h-[60px] p-2 mt-1 bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <div className="font-semibold mb-2">Second attempt:</div>
                                    <div className="mb-2">Outcome (make sure to tick the correct checkbox):</div>
                                    <div className="flex gap-4 mb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-second`}
                                          checked={rd?.second_attempt_satisfactory === 's'}
                                          onChange={() => trainerCanEdit && handleResultsDataChange(section.id, 'second_attempt_satisfactory', 's')}
                                          disabled={!trainerCanEdit}
                                          className="w-4 h-4"
                                        />
                                        <span>Satisfactory (S)</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-second`}
                                          checked={rd?.second_attempt_satisfactory === 'ns'}
                                          onChange={() => trainerCanEdit && handleResultsDataChange(section.id, 'second_attempt_satisfactory', 'ns')}
                                          disabled={!trainerCanEdit}
                                          className="w-4 h-4"
                                        />
                                        <span>Not Satisfactory (NS)</span>
                                      </label>
                                    </div>
                                    <div className="mb-2"><span className="font-medium">Date:</span>{' '}
                                      <DatePicker
                                        value={rd?.second_attempt_date ?? ''}
                                        onChange={(v) => handleResultsDataChange(section.id, 'second_attempt_date', v || null)}
                                        disabled={!trainerCanEdit}
                                        compact
                                        placement="above"
                                        className="inline-block min-w-[120px]"
                                      />
                                    </div>
                                    <div><span className="font-medium">Feedback:</span>
                                      <textarea
                                        value={rd?.second_attempt_feedback ?? ''}
                                        onChange={(e) => handleResultsDataChange(section.id, 'second_attempt_feedback', e.target.value || null)}
                                        disabled={!trainerCanEdit}
                                        className="block w-full border border-gray-300 min-h-[60px] p-2 mt-1 bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 align-top">
                                    Student Declaration
                                  </td>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <ul className="list-disc pl-5 space-y-1 text-sm">
                                      <li>I declare that the answers I have provided are my own work.</li>
                                      <li>I have kept a copy of all relevant notes and reference material.</li>
                                      <li>I have provided references for all sources where the information is not my own.</li>
                                      <li>For the purposes of assessment, I give the trainer/assessor permission to:
                                        <ul className="list-disc pl-5 mt-1 space-y-1">
                                          <li>i. Reproduce this assessment and provide a copy to another member of the RTO for the purposes of assessment.</li>
                                          <li>ii. Take steps to authenticate the assessment, including conducting a plagiarism check.</li>
                                        </ul>
                                      </li>
                                    </ul>
                                    <p className="mt-3 font-semibold text-sm">I understand that if I disagree with the assessment outcome, I can appeal the assessment process, and either re-submit additional evidence undertake gap training and or have my submission re-assessed.</p>
                                    <p className="font-semibold text-sm">All appeal options have been explained to me.</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Student Name</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <input
                                      type="text"
                                      value={rd?.student_name ?? ''}
                                      onChange={(e) => handleResultsDataChange(section.id, 'student_name', e.target.value || null)}
                                      disabled={!studentCanEdit}
                                      placeholder="Enter student name"
                                      className="w-full border-b border-gray-400 min-h-[18px] px-1 py-0.5 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    />
                                    {suggestedStudentName && !rd?.student_name && studentCanEdit && (
                                      <button type="button" onClick={() => handleResultsDataChange(section.id, 'student_name', suggestedStudentName)} className="text-xs text-blue-600 hover:underline mt-0.5">Use {suggestedStudentName}</button>
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Student Signature</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <SignatureField
                                      value={rd?.student_signature ?? null}
                                      onChange={(v) => handleResultsDataChange(section.id, 'student_signature', v)}
                                      disabled={!studentCanEdit}
                                      suggestionFrom={studentSuggestionSig}
                                      onSuggestionClick={studentSuggestionSig ? () => handleResultsDataChange(section.id, 'student_signature', studentSuggestionSig) : undefined}
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Trainer/Assessor Name</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <input
                                      type="text"
                                      value={rd?.trainer_name ?? ''}
                                      onChange={(e) => handleResultsDataChange(section.id, 'trainer_name', e.target.value || null)}
                                      disabled={!trainerCanEdit}
                                      placeholder="Enter trainer name"
                                      className="w-full border-b border-gray-400 min-h-[18px] px-1 py-0.5 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    />
                                    {suggestedTrainerName && !rd?.trainer_name && trainerCanEdit && (
                                      <button type="button" onClick={() => handleResultsDataChange(section.id, 'trainer_name', suggestedTrainerName)} className="text-xs text-blue-600 hover:underline mt-0.5">Use {suggestedTrainerName}</button>
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Trainer/Assessor Signature</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <SignatureField
                                      value={rd?.trainer_signature ?? null}
                                      onChange={(v) => handleResultsDataChange(section.id, 'trainer_signature', v)}
                                      disabled={!trainerCanEdit}
                                      suggestionFrom={trainerSuggestionSig}
                                      onSuggestionClick={trainerSuggestionSig ? () => { handleResultsDataChange(section.id, 'trainer_signature', trainerSuggestionSig); handleResultsDataChange(section.id, 'trainer_date', trainerSuggestionDate || null); } : undefined}
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Date</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <DatePicker
                                      value={rd?.trainer_date ?? ''}
                                      onChange={(v) => handleResultsDataChange(section.id, 'trainer_date', v || null)}
                                      disabled={!trainerCanEdit}
                                      compact
                                      placement="above"
                                      className="min-w-[120px]"
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-[#f5f0e6] font-semibold italic text-gray-700 p-3 border border-gray-300">Office Use Only</td>
                                  <td className="bg-white p-3 border border-gray-300 text-sm">
                                    The outcome of this assessment has been entered into the Student Management System on{' '}
                                    <DatePicker
                                      value={resultsOffice[section.id]?.entered_date ?? ''}
                                      onChange={(v) => handleResultsOfficeChange(section.id, 'entered_date', v || null)}
                                      disabled={role !== 'office'}
                                      compact
                                      placement="above"
                                      className="inline-block min-w-[120px]"
                                    />{' '}
                                    (insert date) by{' '}
                                    <input
                                      type="text"
                                      value={resultsOffice[section.id]?.entered_by ?? ''}
                                      onChange={(e) => handleResultsOfficeChange(section.id, 'entered_by', e.target.value || null)}
                                      disabled={role !== 'office'}
                                      placeholder="Name"
                                      className="inline-block border-b border-gray-400 min-w-[140px] px-1 py-0.5 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    />{' '}
                                    (insert Name)
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_summary' ? (
                        (() => {
                          const sum = assessmentSummary || ({} as import('../lib/formEngine').AssessmentSummaryDataEntry);
                          const trainerCanEdit = role === 'trainer' || role === 'office';
                          const studentCanEdit = role === 'student' || role === 'office';
                          const officeCanEdit = role === 'office';
                          const taskRowsOrdered: { id: number; row_label: string }[] = [];
                          const taskRowToSectionId = new Map<number, number>();
                          for (const step of template?.steps || []) {
                            for (const sec of step.sections) {
                              if (sec.pdf_render_mode === 'assessment_tasks') {
                                const taskQ = sec.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
                                if (taskQ) for (const r of taskQ.rows) taskRowsOrdered.push({ id: r.id, row_label: r.row_label });
                              }
                              if (sec.pdf_render_mode === 'task_results' && (sec as { assessment_task_row_id?: number }).assessment_task_row_id) {
                                taskRowToSectionId.set((sec as { assessment_task_row_id: number }).assessment_task_row_id, sec.id);
                              }
                            }
                          }
                          const taskResultSectionIds = (template?.steps || []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                          const todayIso = new Date().toISOString().split('T')[0];
                          const raTrainerQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
                          const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
                          const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
                          const raTrainerSig = raSigObj ? (String(raSigObj.signature ?? raSigObj.imageDataUrl ?? '') || null) : (typeof raVal === 'string' ? raVal : null);
                          const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
                          const trainerRefSig = raTrainerSig ?? firstTaskRd?.trainer_signature ?? undefined;
                          const trainerRefDate = raTrainerSig ? (raTrainerDate || firstTaskRd?.trainer_date || todayIso) : (firstTaskRd?.trainer_date || todayIso);
                          const studentDeclQForSum = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
                          const studentDeclValForSum = studentDeclQForSum ? answers[getAnswerKey(studentDeclQForSum.id, null)] : undefined;
                          const studentDeclSigObjForSum = studentDeclValForSum && typeof studentDeclValForSum === 'object' && !Array.isArray(studentDeclValForSum) ? (studentDeclValForSum as Record<string, unknown>) : null;
                          const studentDeclSigForSum = studentDeclSigObjForSum ? (String(studentDeclSigObjForSum.signature ?? studentDeclSigObjForSum.imageDataUrl ?? '') || null) : (typeof studentDeclValForSum === 'string' ? studentDeclValForSum : null);
                          const studentDeclDateForSum = studentDeclSigObjForSum ? String(studentDeclSigObjForSum.date ?? studentDeclSigObjForSum.signedAtDate ?? '') : '';
                          const studentRefSig = studentDeclSigForSum ?? firstTaskRd?.student_signature ?? undefined;
                          const studentRefDate = studentDeclSigForSum ? (studentDeclDateForSum || todayIso) : todayIso;
                          const studentNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
                          const studentIdQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.id');
                          const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '') : '';
                          const studentId = studentIdQ ? String(answers[getAnswerKey(studentIdQ.id, null)] ?? '') : '';
                          const unitCode = String(template?.form?.unit_code ?? '');
                          const unitName = String(template?.form?.unit_name ?? '');
                          const unitCodeName = [unitCode, unitName].filter(Boolean).join(' ');
                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                              <div className="bg-[#374151] text-white font-bold text-center px-4 py-4 text-lg">
                                ASSESSMENT SUMMARY SHEET
                              </div>
                              <div className="bg-[#6b7280] text-white text-sm px-4 py-3 space-y-1">
                                <p className="font-medium">This form is to be completed by the assessor and used as a final record of student competency.</p>
                                <p className="text-sm">All student submissions including any associated checklists (outlined below) are to be attached to this cover sheet before placing on the student&apos;s file.</p>
                                <p className="text-sm">Student results are not to be entered onto the Student Database unless all relevant paperwork is completed and attached to this form.</p>
                              </div>
                              <div className="p-4 space-y-4">
                                <table className="w-full border-collapse border border-gray-400 text-xs">
                                  <tbody>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 w-1/4 text-xs">Student Name:</td><td className="border border-gray-400 p-1.5 text-xs">{studentName || '—'}</td></tr>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student ID:</td><td className="border border-gray-400 p-1.5 text-xs">{studentId || '—'}</td></tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Start date:</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <DatePicker value={sum.start_date ?? ''} onChange={(v) => handleAssessmentSummaryChange('start_date', v || null)} disabled={!trainerCanEdit} compact placement="above" className="max-w-[120px]" />
                                      </td>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-right text-xs">End Date:</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <DatePicker value={sum.end_date ?? ''} onChange={(v) => handleAssessmentSummaryChange('end_date', v || null)} disabled={!trainerCanEdit} compact placement="above" className="max-w-[120px]" />
                                      </td>
                                    </tr>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Unit Code & Name:</td><td className="border border-gray-400 p-1.5 text-xs" colSpan={3}>{unitCodeName || '—'}</td></tr>
                                  </tbody>
                                </table>
                                <div className="bg-gray-200 font-semibold text-gray-700 px-4 py-1.5 text-xs">Please attach the following evidence to this form</div>
                                <table className="w-full border-collapse border border-gray-400 text-xs">
                                  <thead>
                                    <tr><th className="border border-gray-400 bg-gray-200 p-1.5 text-left w-1/4 text-xs"></th><th colSpan={3} className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">Result</th></tr>
                                    <tr><th className="border border-gray-400 bg-gray-200 p-1.5"></th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">1st Attempt</th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">2nd Attempt</th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">3rd Attempt</th></tr>
                                  </thead>
                                  <tbody>
                                    {taskRowsOrdered.length === 0 ? (
                                      <tr>
                                        <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Assessment Task 1</td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                      </tr>
                                    ) : (
                                      taskRowsOrdered.map((tr) => {
                                        const secId = taskRowToSectionId.get(tr.id);
                                        const rd = secId ? resultsData[secId] : null;
                                        return (
                                          <tr key={tr.id}>
                                            <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">{tr.row_label}</td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">{rd?.first_attempt_satisfactory === 's' ? '✓ Satisfactory' : rd?.first_attempt_satisfactory === 'ns' ? '✓ Not Satisfactory' : '—'}</span><span className="text-[10px]">Date: {rd?.first_attempt_date ?? '—'}</span></div>
                                            </td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">{rd?.second_attempt_satisfactory === 's' ? '✓ Satisfactory' : rd?.second_attempt_satisfactory === 'ns' ? '✓ Not Satisfactory' : '—'}</span><span className="text-[10px]">Date: {rd?.second_attempt_date ?? '—'}</span></div>
                                            </td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                    <tr className="border-t-2 border-gray-500">
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Final Assessment result for this unit</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-1" checked={sum.final_attempt_1_result === 'competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_1_result', 'competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-1" checked={sum.final_attempt_1_result === 'not_yet_competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_1_result', 'not_yet_competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-2" checked={sum.final_attempt_2_result === 'competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_2_result', 'competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-2" checked={sum.final_attempt_2_result === 'not_yet_competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_2_result', 'not_yet_competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-3" checked={sum.final_attempt_3_result === 'competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_3_result', 'competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-3" checked={sum.final_attempt_3_result === 'not_yet_competent'} onChange={() => trainerCanEdit && handleAssessmentSummaryChange('final_attempt_3_result', 'not_yet_competent')} disabled={!trainerCanEdit} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Trainer/Assessor Signature</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <p className="text-[10px] text-gray-600 mb-1.5">I declare that I have conducted a fair, valid, reliable, and flexible assessment with this student, and I have provided appropriate feedback</p>
                                        <div className="grid grid-cols-3 gap-4">
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_1 ?? null} onChange={(v) => handleAssessmentSummaryChange('trainer_sig_1', v)} disabled={!trainerCanEdit} className="mt-0.5" suggestionFrom={trainerRefSig} onSuggestionClick={trainerRefSig ? () => { handleAssessmentSummaryChange('trainer_sig_1', trainerRefSig); handleAssessmentSummaryChange('trainer_date_1', trainerRefDate || todayIso); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_2 ?? null} onChange={(v) => handleAssessmentSummaryChange('trainer_sig_2', v)} disabled={!trainerCanEdit} className="mt-0.5" suggestionFrom={sum.trainer_sig_1 ?? undefined} onSuggestionClick={sum.trainer_sig_1 ? () => { handleAssessmentSummaryChange('trainer_sig_2', sum.trainer_sig_1); handleAssessmentSummaryChange('trainer_date_2', sum.trainer_date_1 ?? null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_3 ?? null} onChange={(v) => handleAssessmentSummaryChange('trainer_sig_3', v)} disabled={!trainerCanEdit} className="mt-0.5" suggestionFrom={sum.trainer_sig_1 ?? undefined} onSuggestionClick={sum.trainer_sig_1 ? () => { handleAssessmentSummaryChange('trainer_sig_3', sum.trainer_sig_1); handleAssessmentSummaryChange('trainer_date_3', sum.trainer_date_1 ?? null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_1 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_1', v || null)} disabled={!trainerCanEdit} compact placement="above" className="w-full" /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_2 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_2', v || null)} disabled={!trainerCanEdit} compact placement="above" className="w-full" /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_3 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_3', v || null)} disabled={!trainerCanEdit} compact placement="above" className="w-full" /></div>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student:</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <p className="text-[10px] text-gray-600 mb-1.5">I declare that I have been assessed in this unit, and I have been advised of my result. I also am aware of my appeal rights.</p>
                                        <div className="grid grid-cols-3 gap-4">
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_1 ?? null} onChange={(v) => handleAssessmentSummaryChange('student_sig_1', v)} disabled={!studentCanEdit} className="mt-0.5" suggestionFrom={studentRefSig} onSuggestionClick={studentRefSig ? () => { handleAssessmentSummaryChange('student_sig_1', studentRefSig); handleAssessmentSummaryChange('student_date_1', studentRefDate); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_2 ?? null} onChange={(v) => handleAssessmentSummaryChange('student_sig_2', v)} disabled={!studentCanEdit} className="mt-0.5" suggestionFrom={sum.student_sig_1 ?? undefined} onSuggestionClick={sum.student_sig_1 ? () => { handleAssessmentSummaryChange('student_sig_2', sum.student_sig_1); handleAssessmentSummaryChange('student_date_2', sum.student_date_1 ?? null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_3 ?? null} onChange={(v) => handleAssessmentSummaryChange('student_sig_3', v)} disabled={!studentCanEdit} className="mt-0.5" suggestionFrom={sum.student_sig_1 ?? undefined} onSuggestionClick={sum.student_sig_1 ? () => { handleAssessmentSummaryChange('student_sig_3', sum.student_sig_1); handleAssessmentSummaryChange('student_date_3', sum.student_date_1 ?? null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_1 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_1', v || null)} disabled={!studentCanEdit} compact placement="above" className="w-full" /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_2 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_2', v || null)} disabled={!studentCanEdit} compact placement="above" className="w-full" /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_3 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_3', v || null)} disabled={!studentCanEdit} compact placement="above" className="w-full" /></div>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student overall Feedback:</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <textarea value={sum.student_overall_feedback ?? ''} onChange={(e) => handleAssessmentSummaryChange('student_overall_feedback', e.target.value || null)} disabled={!trainerCanEdit} className="w-full border border-gray-400 min-h-[60px] p-1.5 text-xs" />
                                      </td>
                                    </tr>
                                    <tr>
                                      <td colSpan={2} className="border border-gray-400 bg-[#f5f0e6] font-semibold italic p-1.5 text-xs">Administrative use only - Entered onto Student Management Database</td>
                                      <td className="border border-gray-400 bg-[#f5f0e6] font-semibold italic p-1.5 text-xs">Initials</td>
                                      <td className="border border-gray-400 bg-[#f5f0e6] p-1.5">
                                        <input type="text" value={sum.admin_initials ?? ''} onChange={(e) => handleAssessmentSummaryChange('admin_initials', e.target.value || null)} disabled={!officeCanEdit} className="border-0 border-b border-gray-400 px-1 py-0.5 text-xs w-full max-w-[60px] bg-transparent disabled:bg-gray-100" />
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'likert_table' ? (
                        <>
                          <SectionLikertTable
                            section={section}
                            getAnswer={(qId, rId) => {
                              const v = answers[getAnswerKey(qId, rId)];
                              return v != null ? String(v) : null;
                            }}
                            onChange={(qId, rId, val) => handleAnswerChange(qId, rId, val)}
                            disabled={!section.questions.some((q) =>
                              isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role)
                            )}
                          />
                          {section.questions
                            .filter((q) => q.type !== 'likert_5' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                            .map((q) => {
                              const re = (q.role_editability as Record<string, boolean>) || {};
                              const editable = isRoleEditable(re, role);
                              const key = getAnswerKey(q.id, null);
                              const val = answers[key];
                              if (q.type === 'signature' && (q.code === 'student.declarationSignature' || String(q.code || '').startsWith('student.'))) {
                                const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                                const firstTaskSectionId = taskResultSectionIds[0];
                                const firstTaskRdForDecl = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                                const studentSigSuggestion = firstTaskRdForDecl?.student_signature ?? null;
                                const sigVal = val;
                                const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                                const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                                const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                                const todayIsoDecl = new Date().toISOString().split('T')[0];
                                const hasDateField = (q.pdf_meta as { showDateField?: boolean } | undefined)?.showDateField;
                                return (
                                  <div key={q.id} className="space-y-2">
                                    <div className="text-sm font-semibold text-gray-700">{q.label}{q.required ? ' *' : ''}</div>
                                    <div className="flex items-center gap-4 flex-wrap">
                                      <div className="flex-1 min-w-[200px]">
                                        <SignatureField
                                          value={(imgVal as string | null) ?? null}
                                          onChange={(v) => {
                                            const img = typeof v === 'string' ? v : null;
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                            handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!editable}
                                          suggestionFrom={studentSigSuggestion}
                                          onSuggestionClick={studentSigSuggestion && editable ? () => {
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            handleAnswerChange(q.id, null, { ...base, signature: studentSigSuggestion, date: todayIsoDecl } as string | number | boolean | Record<string, unknown> | string[]);
                                          } : undefined}
                                        />
                                      </div>
                                      {hasDateField && (
                                        <div className="flex items-center gap-2 min-w-[140px]">
                                          <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                          <DatePicker
                                            value={dateVal}
                                            onChange={(newDate) => {
                                              const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                              handleAnswerChange(q.id, null, { ...base, date: newDate } as string | number | boolean | Record<string, unknown> | string[]);
                                            }}
                                            disabled={!editable}
                                            compact
                                            placement="above"
                                            className="flex-1 min-w-0"
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {errors[`q-${q.id}`] && <p className="text-sm text-red-600">{errors[`q-${q.id}`]}</p>}
                                  </div>
                                );
                              }
                              return (
                                <QuestionRenderer
                                  key={q.id}
                                  question={q}
                                  value={(val as string | number | boolean | Record<string, unknown> | string[]) ?? null}
                                  onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])}
                                  disabled={!editable}
                                  error={errors[`q-${q.id}`]}
                                  declarationStyle={section.pdf_render_mode === 'declarations'}
                                />
                              );
                            })}
                        </>
                      ) : (
                        section.questions
                        .filter((q) => q.type !== 'instruction_block' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                        .map((q) => {
                          const re = (q.role_editability as Record<string, boolean>) || {};
                          const isQualUnitField = q.code === 'qualification.code' || q.code === 'qualification.name' || q.code === 'unit.code' || q.code === 'unit.name';
                          const editable = isQualUnitField ? false : isRoleEditable(re, role);
                          if (q.type === 'likert_5' && q.rows.length > 0) {
                            const val =
                              q.rows.length === 1
                                ? (answers[getAnswerKey(q.id, q.rows[0].id)] as string) ?? null
                                : (() => {
                                    const m: Record<string, string> = {};
                                    for (const r of q.rows) {
                                      const v = answers[getAnswerKey(q.id, r.id)];
                                      if (v != null) m[`row-${r.id}`] = String(v);
                                    }
                                    return Object.keys(m).length ? m : null;
                                  })();
                            const onLikertChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                              if (q.rows.length === 1) {
                                handleAnswerChange(q.id, q.rows[0].id, typeof v === 'string' ? v : String(v));
                              } else {
                                const o = v as Record<string, string>;
                                if (o && typeof o === 'object') {
                                  for (const r of q.rows) {
                                    const rv = o[`row-${r.id}`];
                                    if (rv != null) handleAnswerChange(q.id, r.id, rv);
                                  }
                                }
                              }
                            };
                            return (
                              <QuestionRenderer
                                key={q.id}
                                question={q}
                                value={val}
                                onChange={onLikertChange}
                                disabled={!editable}
                                error={errors[`q-${q.id}`]}
                              />
                            );
                          }
                          if (q.type === 'grid_table' && q.rows.length > 0) {
                            const merged: Record<string, string> = {};
                            for (const r of q.rows) {
                              const v = answers[getAnswerKey(q.id, r.id)];
                              if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                            }
                            const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                              const byRow = new Map<number, Record<string, string>>();
                              const o = v as Record<string, string>;
                              if (!o || typeof o !== 'object') return;
                              for (const [k, val] of Object.entries(o)) {
                                const match = /^r(\d+)_c/.exec(k);
                                if (match) {
                                  const rowId = Number(match[1]);
                                  if (!byRow.has(rowId)) byRow.set(rowId, {});
                                  byRow.get(rowId)![k] = String(val);
                                }
                              }
                              for (const [rowId, rowData] of byRow.entries()) {
                                handleAnswerChange(q.id, rowId, rowData);
                              }
                            };
                            return (
                              <QuestionRenderer
                                key={q.id}
                                question={q}
                                value={Object.keys(merged).length ? merged : null}
                                onChange={onGridChange}
                                disabled={!editable}
                                error={errors[`q-${q.id}`]}
                              />
                            );
                          }
                          const key = getAnswerKey(q.id, null);
                          let val = answers[key];
                          if (q.type === 'signature' && (q.code === 'student.declarationSignature' || String(q.code || '').startsWith('student.'))) {
                            const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                            const firstTaskSectionId = taskResultSectionIds[0];
                            const firstTaskRdForDecl = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                            const studentSigSuggestion = firstTaskRdForDecl?.student_signature ?? null;
                            const sigVal = val;
                            const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                            const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                            const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                            const todayIsoDecl = new Date().toISOString().split('T')[0];
                            const hasDateField = (q.pdf_meta as { showDateField?: boolean } | undefined)?.showDateField;
                            return (
                              <div key={q.id} className="space-y-2">
                                <div className="text-sm font-semibold text-gray-700">{q.label}{q.required ? ' *' : ''}</div>
                                <div className="flex items-center gap-4 flex-wrap">
                                  <div className="flex-1 min-w-[200px]">
                                    <SignatureField
                                      value={(imgVal as string | null) ?? null}
                                      onChange={(v) => {
                                        const img = typeof v === 'string' ? v : null;
                                        const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                        const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                        handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                      }}
                                      disabled={!editable}
                                      suggestionFrom={studentSigSuggestion}
                                      onSuggestionClick={studentSigSuggestion && editable ? () => {
                                        const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                        handleAnswerChange(q.id, null, { ...base, signature: studentSigSuggestion, date: todayIsoDecl } as string | number | boolean | Record<string, unknown> | string[]);
                                      } : undefined}
                                    />
                                  </div>
                                  {hasDateField && (
                                    <div className="flex items-center gap-2 min-w-[140px]">
                                      <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                      <DatePicker
                                        value={dateVal}
                                        onChange={(newDate) => {
                                          const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                          handleAnswerChange(q.id, null, { ...base, date: newDate } as string | number | boolean | Record<string, unknown> | string[]);
                                        }}
                                        disabled={!editable}
                                        compact
                                        placement="above"
                                        className="flex-1 min-w-0"
                                      />
                                    </div>
                                  )}
                                </div>
                                {errors[`q-${q.id}`] && <p className="text-sm text-red-600">{errors[`q-${q.id}`]}</p>}
                              </div>
                            );
                          }
                          const formExt = template?.form as { qualification_code?: string | null; qualification_name?: string | null; unit_code?: string | null; unit_name?: string | null } | undefined;
                          if (isQualUnitField && (val == null || val === '') && formExt) {
                            const fallback =
                              q.code === 'qualification.code' ? formExt.qualification_code
                              : q.code === 'qualification.name' ? formExt.qualification_name
                              : q.code === 'unit.code' ? formExt.unit_code
                              : q.code === 'unit.name' ? formExt.unit_name
                              : null;
                            val = fallback ?? '';
                          }
                          return (
                            <QuestionRenderer
                              key={q.id}
                              question={q}
                              value={(val as string | number | boolean | Record<string, unknown> | string[]) ?? null}
                              onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])}
                              disabled={!editable}
                              error={errors[`q-${q.id}`]}
                              declarationStyle={section.pdf_render_mode === 'declarations'}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            ) : null}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setErrors({});
                  setCurrentStep((s) => Math.max(1, s - 1));
                }}
                disabled={currentStep <= 1}
              >
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (validateStep(currentStep)) {
                    setErrors({});
                    setCurrentStep((s) => Math.min(steps.length, s + 1));
                  }
                }}
                disabled={currentStep >= steps.length}
              >
                Next
              </Button>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="lg:sticky lg:top-3">
              <Card>
                <h3 className="font-bold text-[var(--text)] mb-4">PDF Preview</h3>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      window.open(`${PDF_BASE}/pdf/${id}?t=${pdfCacheBust}`, '_blank', 'width=800,height=600');
                    }}
                  >
                    Preview PDF
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setPdfLoading(true);
                      setPdfRefresh((r) => r + 1);
                    }}
                  >
                    Refresh PDF
                  </Button>
                  <a
                    href={`${PDF_BASE}/pdf/${id}?download=1&t=${pdfCacheBust}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button variant="outline" size="sm" className="w-full">
                      Download PDF
                    </Button>
                  </a>
                </div>
                <div className="mt-4 relative min-h-96 bg-gray-50 border border-[var(--border)] rounded-lg overflow-hidden">
                  {pdfLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/90 z-10">
                      <Loader variant="spinner" size="lg" />
                      <p className="text-sm font-medium text-gray-600 animate-pulse">Loading PDF...</p>
                    </div>
                  )}
                  <iframe
                    key={pdfCacheBust}
                    src={`${PDF_BASE}/pdf/${id}?t=${pdfCacheBust}`}
                    title="PDF Preview"
                    className="w-full h-96 border-0 rounded-lg"
                    onLoad={() => setPdfLoading(false)}
                  />
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
