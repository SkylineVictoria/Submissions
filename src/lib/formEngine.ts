import { supabase } from './supabase';
import { createDefaultSectionsToStep } from './defaultFormSteps';
import type {
  Form,
  FormStep,
  FormSection,
  FormQuestion,
  FormQuestionOption,
  FormQuestionRow,
  FormInstance,
  FormAnswer,
} from '../types/database';

export interface FormStepWithSections extends FormStep {
  sections: FormSectionWithQuestions[];
}

export interface FormSectionWithQuestions extends FormSection {
  questions: FormQuestionWithOptionsAndRows[];
  taskRow?: FormQuestionRow | null;
}

export interface FormQuestionWithOptionsAndRows extends FormQuestion {
  options: FormQuestionOption[];
  rows: FormQuestionRow[];
}

export interface FormTemplate {
  form: Form;
  steps: FormStepWithSections[];
}

export interface InstanceWithAnswers {
  instance: FormInstance;
  answers: FormAnswer[];
}


export async function fetchForm(formId: number): Promise<Form | null> {
  const { data, error } = await supabase.from('skyline_forms').select('*').eq('id', formId).single();
  if (error) {
    console.error('fetchForm error', error);
    return null;
  }
  return data as Form;
}

export async function updateForm(formId: number, updates: Partial<Pick<Form, 'name' | 'version' | 'unit_code' | 'unit_name' | 'qualification_code' | 'qualification_name' | 'header_asset_url' | 'cover_asset_url'>>): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('skyline_forms').update(updates).eq('id', formId);
  return { error: error ? new Error(error.message) : null };
}

/** Migrate task sections from intro step to their own steps (for forms created with old structure). */
async function migrateTaskSectionsToSteps(formId: number, introStepId: number): Promise<number> {
  const { data: taskSections } = await supabase
    .from('skyline_form_sections')
    .select('id, assessment_task_row_id, pdf_render_mode, sort_order')
    .eq('step_id', introStepId)
    .not('assessment_task_row_id', 'is', null);
  if (!taskSections || taskSections.length === 0) return 0;

  const byRow = new Map<number, { id: number; pdf_render_mode: string; sort_order: number }[]>();
  for (const s of taskSections as { id: number; assessment_task_row_id: number; pdf_render_mode: string; sort_order: number }[]) {
    if (!byRow.has(s.assessment_task_row_id)) byRow.set(s.assessment_task_row_id, []);
    byRow.get(s.assessment_task_row_id)!.push({ id: s.id, pdf_render_mode: s.pdf_render_mode, sort_order: s.sort_order });
  }

  const { data: rows } = await supabase
    .from('skyline_form_question_rows')
    .select('id, row_label')
    .in('id', Array.from(byRow.keys()));
  const rowMap = new Map((rows as { id: number; row_label: string }[])?.map((r) => [r.id, r]) || []);

  const { data: steps } = await supabase.from('skyline_form_steps').select('sort_order').eq('form_id', formId);
  const maxOrder = steps?.length ? Math.max(...(steps as { sort_order: number }[]).map((s) => s.sort_order), 0) : 0;
  let nextOrder = maxOrder + 1;
  let migrated = 0;

  for (const [rowId, secs] of byRow) {
    const row = rowMap.get(rowId);
    if (!row || secs.length < 3) continue;
    const { data: taskStep } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: formId, title: row.row_label, subtitle: 'Instructions, Questions & Results', sort_order: nextOrder++ })
      .select('id')
      .single();
    if (!taskStep) continue;
    const taskStepId = (taskStep as { id: number }).id;
    const orderMap: Record<string, number> = { task_instructions: 0, task_questions: 1, task_results: 2 };
    for (const sec of secs) {
      await supabase.from('skyline_form_sections').update({ step_id: taskStepId, sort_order: orderMap[sec.pdf_render_mode] ?? sec.sort_order }).eq('id', sec.id);
    }
    migrated++;
  }
  return migrated;
}

/** Create a separate step (Instructions, Questions, Results) for each assessment task row that doesn't have one. Call for existing forms. */
export async function ensureTaskSectionsForForm(formId: number): Promise<{ created: number }> {
  const steps = await fetchFormSteps(formId);
  const introStep = steps.find((s) => s.title === 'Introductory Details' || s.subtitle?.includes('Student'));
  if (!introStep) return { created: 0 };

  const migrated = await migrateTaskSectionsToSteps(formId, introStep.id);
  if (migrated > 0) return { created: migrated };

  const { data: sections } = await supabase
    .from('skyline_form_sections')
    .select('*')
    .eq('step_id', introStep.id)
    .order('sort_order');
  const assessmentTasksSection = (sections as { id: number; pdf_render_mode: string }[])?.find((s) => s.pdf_render_mode === 'assessment_tasks');
  if (!assessmentTasksSection) return { created: 0 };

  const { data: taskQuestion } = await supabase
    .from('skyline_form_questions')
    .select('id')
    .eq('section_id', assessmentTasksSection.id)
    .eq('type', 'grid_table')
    .single();
  if (!taskQuestion) return { created: 0 };

  const { data: rows } = await supabase
    .from('skyline_form_question_rows')
    .select('id, row_label')
    .eq('question_id', (taskQuestion as { id: number }).id)
    .order('sort_order');
  const taskRows = (rows as { id: number; row_label: string }[]) || [];
  if (taskRows.length === 0) return { created: 0 };

  const { data: existingSections } = await supabase
    .from('skyline_form_sections')
    .select('step_id, assessment_task_row_id')
    .not('assessment_task_row_id', 'is', null);
  const stepIds = new Set((steps as { id: number }[]).map((s) => s.id));
  const linkedRowIds = new Set(
    ((existingSections as { step_id: number; assessment_task_row_id: number }[]) || [])
      .filter((s) => stepIds.has(s.step_id))
      .map((s) => s.assessment_task_row_id)
  );

  let created = 0;
  const maxStepOrder = steps.length > 0 ? Math.max(...(steps as { sort_order: number }[]).map((s) => s.sort_order), 0) : 0;
  let nextStepOrder = maxStepOrder + 1;

  for (const row of taskRows) {
    if (linkedRowIds.has(row.id)) continue;
    const { data: taskStep } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: formId, title: row.row_label, subtitle: 'Instructions, Questions & Results', sort_order: nextStepOrder++ })
      .select('id')
      .single();
    if (taskStep) {
      const taskStepId = (taskStep as { id: number }).id;
      await supabase.from('skyline_form_sections').insert([
        { step_id: taskStepId, title: 'Student Instructions', pdf_render_mode: 'task_instructions', assessment_task_row_id: row.id, sort_order: 0 },
        { step_id: taskStepId, title: 'Questions', pdf_render_mode: 'task_questions', assessment_task_row_id: row.id, sort_order: 1 },
        { step_id: taskStepId, title: 'Results', pdf_render_mode: 'task_results', assessment_task_row_id: row.id, sort_order: 2 },
      ]);
      created += 1;
    }
  }
  return { created };
}

export async function fetchFormSteps(formId: number): Promise<FormStep[]> {
  const { data, error } = await supabase
    .from('skyline_form_steps')
    .select('*')
    .eq('form_id', formId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('fetchFormSteps error', error);
    return [];
  }
  return (data as FormStep[]) || [];
}

export async function fetchInstance(instanceId: number): Promise<FormInstance | null> {
  const { data, error } = await supabase.from('skyline_form_instances').select('*').eq('id', instanceId).single();
  if (error) {
    console.error('fetchInstance error', error);
    return null;
  }
  return data as FormInstance;
}

export async function fetchTemplateForInstance(instanceId: number): Promise<FormTemplate | null> {
  const instance = await fetchInstance(instanceId);
  if (!instance) return null;

  const form = await fetchForm(instance.form_id);
  if (!form) return null;

  const steps = await fetchFormSteps(instance.form_id);
  const stepsWithSections: FormStepWithSections[] = [];

  for (const step of steps) {
    const { data: sections } = await supabase
      .from('skyline_form_sections')
      .select('*')
      .eq('step_id', step.id)
      .order('sort_order', { ascending: true });
    const sectionsList = (sections as FormSection[]) || [];

    const sectionsWithQuestions: FormSectionWithQuestions[] = [];
    for (const section of sectionsList) {
      const sec = section as FormSection & { assessment_task_row_id?: number | null };
      let taskRow: FormQuestionRow | null = null;
      if (sec.assessment_task_row_id) {
        const { data: row } = await supabase
          .from('skyline_form_question_rows')
          .select('*')
          .eq('id', sec.assessment_task_row_id)
          .single();
        taskRow = (row as FormQuestionRow) || null;
      }

      const { data: questions } = await supabase
        .from('skyline_form_questions')
        .select('*')
        .eq('section_id', section.id)
        .order('sort_order', { ascending: true });
      const questionsList = (questions as FormQuestion[]) || [];

      const questionsWithExtras: FormQuestionWithOptionsAndRows[] = [];
      for (const q of questionsList) {
        const { data: options } = await supabase
          .from('skyline_form_question_options')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order', { ascending: true });
        const { data: rows } = await supabase
          .from('skyline_form_question_rows')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order', { ascending: true });
        questionsWithExtras.push({
          ...q,
          options: (options as FormQuestionOption[]) || [],
          rows: (rows as FormQuestionRow[]) || [],
        });
      }
      sectionsWithQuestions.push({ ...section, questions: questionsWithExtras, taskRow: taskRow ?? undefined });
    }
    stepsWithSections.push({ ...step, sections: sectionsWithQuestions });
  }

  return { form, steps: stepsWithSections };
}

export async function fetchAnswersForInstance(instanceId: number): Promise<FormAnswer[]> {
  const { data, error } = await supabase
    .from('skyline_form_answers')
    .select('*')
    .eq('instance_id', instanceId);
  if (error) {
    console.error('fetchAnswersForInstance error', error);
    return [];
  }
  return (data as FormAnswer[]) || [];
}

export interface ResultsOfficeEntry {
  section_id: number;
  entered_date: string | null;
  entered_by: string | null;
}

export interface ResultsDataEntry {
  section_id: number;
  first_attempt_satisfactory: string | null;
  first_attempt_date: string | null;
  first_attempt_feedback: string | null;
  second_attempt_satisfactory: string | null;
  second_attempt_date: string | null;
  second_attempt_feedback: string | null;
  student_name: string | null;
  student_signature: string | null;
  trainer_name: string | null;
  trainer_signature: string | null;
  trainer_date: string | null;
}

export async function fetchResultsData(instanceId: number): Promise<Record<number, ResultsDataEntry>> {
  const { data, error } = await supabase
    .from('skyline_form_results_data')
    .select('section_id, first_attempt_satisfactory, first_attempt_date, first_attempt_feedback, second_attempt_satisfactory, second_attempt_date, second_attempt_feedback, student_name, student_signature, trainer_name, trainer_signature, trainer_date')
    .eq('instance_id', instanceId);
  if (error) {
    console.error('fetchResultsData error', error);
    return {};
  }
  const out: Record<number, ResultsDataEntry> = {};
  for (const row of (data as Record<string, unknown>[]) || []) {
    const sid = row.section_id as number;
    out[sid] = {
      section_id: sid,
      first_attempt_satisfactory: (row.first_attempt_satisfactory as string) ?? null,
      first_attempt_date: (row.first_attempt_date as string) ?? null,
      first_attempt_feedback: (row.first_attempt_feedback as string) ?? null,
      second_attempt_satisfactory: (row.second_attempt_satisfactory as string) ?? null,
      second_attempt_date: (row.second_attempt_date as string) ?? null,
      second_attempt_feedback: (row.second_attempt_feedback as string) ?? null,
      student_name: (row.student_name as string) ?? null,
      student_signature: (row.student_signature as string) ?? null,
      trainer_name: (row.trainer_name as string) ?? null,
      trainer_signature: (row.trainer_signature as string) ?? null,
      trainer_date: (row.trainer_date as string) ?? null,
    };
  }
  return out;
}

export async function saveResultsData(
  instanceId: number,
  sectionId: number,
  data: Partial<Omit<ResultsDataEntry, 'section_id'>>
): Promise<void> {
  const { error } = await supabase.from('skyline_form_results_data').upsert(
    {
      instance_id: instanceId,
      section_id: sectionId,
      ...data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instance_id,section_id' }
  );
  if (error) console.error('saveResultsData error', error);
}

export async function fetchResultsOffice(instanceId: number): Promise<Record<number, ResultsOfficeEntry>> {
  const { data, error } = await supabase
    .from('skyline_form_results_office')
    .select('section_id, entered_date, entered_by')
    .eq('instance_id', instanceId);
  if (error) {
    console.error('fetchResultsOffice error', error);
    return {};
  }
  const out: Record<number, ResultsOfficeEntry> = {};
  for (const row of (data as { section_id: number; entered_date: string | null; entered_by: string | null }[]) || []) {
    out[row.section_id] = {
      section_id: row.section_id,
      entered_date: row.entered_date,
      entered_by: row.entered_by,
    };
  }
  return out;
}

export async function saveResultsOffice(
  instanceId: number,
  sectionId: number,
  enteredDate: string | null,
  enteredBy: string | null
): Promise<void> {
  const { error } = await supabase.from('skyline_form_results_office').upsert(
    {
      instance_id: instanceId,
      section_id: sectionId,
      entered_date: enteredDate,
      entered_by: enteredBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instance_id,section_id' }
  );
  if (error) console.error('saveResultsOffice error', error);
}

export interface AssessmentSummaryDataEntry {
  start_date: string | null;
  end_date: string | null;
  final_attempt_1_result: string | null;
  final_attempt_2_result: string | null;
  final_attempt_3_result: string | null;
  trainer_sig_1: string | null;
  trainer_date_1: string | null;
  trainer_sig_2: string | null;
  trainer_date_2: string | null;
  trainer_sig_3: string | null;
  trainer_date_3: string | null;
  student_sig_1: string | null;
  student_date_1: string | null;
  student_sig_2: string | null;
  student_date_2: string | null;
  student_sig_3: string | null;
  student_date_3: string | null;
  student_overall_feedback: string | null;
  admin_initials: string | null;
}

export async function fetchAssessmentSummaryData(instanceId: number): Promise<AssessmentSummaryDataEntry | null> {
  const { data, error } = await supabase
    .from('skyline_form_assessment_summary_data')
    .select('*')
    .eq('instance_id', instanceId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    start_date: (r.start_date as string) ?? null,
    end_date: (r.end_date as string) ?? null,
    final_attempt_1_result: (r.final_attempt_1_result as string) ?? null,
    final_attempt_2_result: (r.final_attempt_2_result as string) ?? null,
    final_attempt_3_result: (r.final_attempt_3_result as string) ?? null,
    trainer_sig_1: (r.trainer_sig_1 as string) ?? null,
    trainer_date_1: (r.trainer_date_1 as string) ?? null,
    trainer_sig_2: (r.trainer_sig_2 as string) ?? null,
    trainer_date_2: (r.trainer_date_2 as string) ?? null,
    trainer_sig_3: (r.trainer_sig_3 as string) ?? null,
    trainer_date_3: (r.trainer_date_3 as string) ?? null,
    student_sig_1: (r.student_sig_1 as string) ?? null,
    student_date_1: (r.student_date_1 as string) ?? null,
    student_sig_2: (r.student_sig_2 as string) ?? null,
    student_date_2: (r.student_date_2 as string) ?? null,
    student_sig_3: (r.student_sig_3 as string) ?? null,
    student_date_3: (r.student_date_3 as string) ?? null,
    student_overall_feedback: (r.student_overall_feedback as string) ?? null,
    admin_initials: (r.admin_initials as string) ?? null,
  };
}

export async function saveAssessmentSummaryData(
  instanceId: number,
  data: Partial<AssessmentSummaryDataEntry>
): Promise<void> {
  const { error } = await supabase.from('skyline_form_assessment_summary_data').upsert(
    {
      instance_id: instanceId,
      ...data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instance_id' }
  );
  if (error) console.error('saveAssessmentSummaryData error', error);
}

export async function fetchTrainerAssessments(instanceId: number): Promise<Record<number, string>> {
  const { data, error } = await supabase
    .from('skyline_form_trainer_assessments')
    .select('question_id, satisfactory')
    .eq('instance_id', instanceId);
  if (error) {
    console.error('fetchTrainerAssessments error', error);
    return {};
  }
  const out: Record<number, string> = {};
  for (const row of (data as { question_id: number; satisfactory: string | null }[]) || []) {
    if (row.satisfactory) out[row.question_id] = row.satisfactory;
  }
  return out;
}

export async function saveTrainerAssessment(
  instanceId: number,
  questionId: number,
  satisfactory: 'yes' | 'no'
): Promise<void> {
  const { error } = await supabase.from('skyline_form_trainer_assessments').upsert(
    { instance_id: instanceId, question_id: questionId, satisfactory, updated_at: new Date().toISOString() },
    { onConflict: 'instance_id,question_id' }
  );
  if (error) console.error('saveTrainerAssessment error', error);
}

export async function saveAnswer(
  instanceId: number,
  questionId: number,
  rowId: number | null,
  value: { text?: string; number?: number; json?: unknown }
): Promise<void> {
  const q = supabase
    .from('skyline_form_answers')
    .select('id')
    .eq('instance_id', instanceId)
    .eq('question_id', questionId);

  const { data: existing } = rowId === null
    ? await q.is('row_id', null).maybeSingle()
    : await q.eq('row_id', rowId).maybeSingle();

  const payload = {
    value_text: value.text ?? null,
    value_number: value.number ?? null,
    value_json: value.json ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from('skyline_form_answers').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('skyline_form_answers').insert({
      instance_id: instanceId,
      question_id: questionId,
      row_id: rowId,
      ...payload,
    });
  }
}

export async function createFormInstance(
  formId: number,
  roleContext: string,
  studentId?: number | null
): Promise<FormInstance | null> {
  const insert: Record<string, unknown> = { form_id: formId, role_context: roleContext };
  if (studentId != null) insert.student_id = studentId;
  const { data, error } = await supabase
    .from('skyline_form_instances')
    .insert(insert)
    .select('*')
    .single();
  if (error) {
    console.error('createFormInstance error', error);
    return null;
  }
  return data as FormInstance;
}

export interface Student {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

export async function listStudents(): Promise<Student[]> {
  const { data, error } = await supabase
    .from('skyline_students')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listStudents error', error);
    return [];
  }
  return (data as Student[]) || [];
}

export async function createStudent(name: string, email: string): Promise<Student | null> {
  const { data, error } = await supabase
    .from('skyline_students')
    .insert({ name, email })
    .select('*')
    .single();
  if (error) {
    console.error('createStudent error', error);
    return null;
  }
  return data as Student;
}

const DEFAULT_ROLES = { student: true, trainer: true, office: true };
const READ_ONLY_VISIBLE = { student: true, trainer: true, office: true };
const READ_ONLY_EDIT = { student: false, trainer: false, office: false };
const TRAINER_ONLY_EDIT = { student: false, trainer: true, office: false };
const TRAINER_OFFICE_EDIT = { student: false, trainer: true, office: true };

interface AssessmentTaskInput {
  task1_label: string;
  task1_method: string;
  task2_label: string;
  task2_method: string;
}

interface AssessmentTask {
  label: string;
  method: string;
}

async function createCompulsoryFormStructure(formId: number, assessmentTasks?: AssessmentTaskInput | AssessmentTask[]): Promise<void> {
  // Single compulsory step: Student & Trainer, Qualification, Assessment Tasks, Assessment Submission
  // Subtitle "Student, trainer, qualification & assessment" is used only for this step; other steps keep their own titles/subtitles
  const { data: step } = await supabase
    .from('skyline_form_steps')
    .insert({ form_id: formId, title: 'Introductory Details', subtitle: 'Student, trainer, qualification & assessment', sort_order: 0 })
    .select('id')
    .single();
  if (!step) return;
  const stepId = (step as { id: number }).id;

  const { data: sec1 } = await supabase
    .from('skyline_form_sections')
    .insert({ step_id: stepId, title: 'Student and trainer details', pdf_render_mode: 'normal', sort_order: 0 })
    .select('id')
    .single();
  if (sec1) {
    const s = sec1 as { id: number };
    await supabase.from('skyline_form_questions').insert([
      { section_id: s.id, type: 'short_text', code: 'student.fullName', label: 'Student Full Name', required: true, sort_order: 0, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES },
      { section_id: s.id, type: 'short_text', code: 'student.id', label: 'Student ID', required: true, sort_order: 1, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES },
      { section_id: s.id, type: 'short_text', code: 'student.email', label: 'Student Email', required: true, sort_order: 2, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES },
      { section_id: s.id, type: 'short_text', code: 'trainer.fullName', label: 'Trainer Full Name', required: true, sort_order: 3, role_visibility: DEFAULT_ROLES, role_editability: TRAINER_OFFICE_EDIT },
    ]);
  }

  const { data: sec2a } = await supabase
    .from('skyline_form_sections')
    .insert({ step_id: stepId, title: 'Qualification and unit of competency', pdf_render_mode: 'normal', sort_order: 1 })
    .select('id')
    .single();
  if (sec2a) {
    const s = sec2a as { id: number };
    await supabase.from('skyline_form_questions').insert([
      { section_id: s.id, type: 'short_text', code: 'qualification.code', label: 'Qualification Code', sort_order: 0, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
      { section_id: s.id, type: 'short_text', code: 'qualification.name', label: 'Qualification Name', sort_order: 1, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
      { section_id: s.id, type: 'short_text', code: 'unit.code', label: 'Unit Code', sort_order: 2, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
      { section_id: s.id, type: 'short_text', code: 'unit.name', label: 'Unit Name', sort_order: 3, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
    ]);
  }

  const { data: sec2b } = await supabase
    .from('skyline_form_sections')
    .insert({ step_id: stepId, title: 'Assessment Tasks', description: 'The student must be assessed as satisfactory in each of the following assessment tasks in order to demonstrate competence.', pdf_render_mode: 'assessment_tasks', sort_order: 2 })
    .select('id')
    .single();
  let taskRowIds: number[] = [];
  if (sec2b) {
    const s = sec2b as { id: number };
    const { data: q } = await supabase
      .from('skyline_form_questions')
      .insert({ section_id: s.id, type: 'grid_table', code: 'assessment.tasks', label: 'Assessment Tasks', sort_order: 0, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT, pdf_meta: { columns: ['Evidence number', 'Assessment method/ Type of evidence'] } })
      .select('id')
      .single();
    if (q) {
      const qid = (q as { id: number }).id;
      let rowsToInsert: Array<{ question_id: number; row_label: string; row_help: string; sort_order: number }> = [];
      
      if (Array.isArray(assessmentTasks)) {
        // New format: array of tasks
        rowsToInsert = assessmentTasks.map((task, index) => ({
          question_id: qid,
          row_label: task.label,
          row_help: task.method,
          sort_order: index,
        }));
      } else if (assessmentTasks) {
        // Legacy format: object with task1/task2
        rowsToInsert = [
          { question_id: qid, row_label: assessmentTasks.task1_label, row_help: assessmentTasks.task1_method, sort_order: 0 },
          { question_id: qid, row_label: assessmentTasks.task2_label, row_help: assessmentTasks.task2_method, sort_order: 1 },
        ];
      } else {
        // Default fallback
        rowsToInsert = [
          { question_id: qid, row_label: 'Assessment task 1', row_help: 'Written Assessment (WA)', sort_order: 0 },
          { question_id: qid, row_label: 'Assessment task 2', row_help: 'Practical Task 2.1\nPractical Task 2.2\nPractical Task 2.3', sort_order: 1 },
        ];
      }
      
      for (const row of rowsToInsert) {
        const { data: inserted } = await supabase.from('skyline_form_question_rows').insert(row).select('id').single();
        if (inserted) taskRowIds.push((inserted as { id: number }).id);
      }
    }
  }

  const { data: sec2c } = await supabase
    .from('skyline_form_sections')
    .insert({ step_id: stepId, title: 'Assessment Submission Method', pdf_render_mode: 'assessment_submission', sort_order: 3 })
    .select('id')
    .single();
  if (sec2c) {
    const s = sec2c as { id: number };
    const { data: qSub } = await supabase
      .from('skyline_form_questions')
      .insert({ section_id: s.id, type: 'multi_choice', code: 'assessment.submission', label: 'Assessment Submission Method', sort_order: 0, role_visibility: READ_ONLY_VISIBLE, role_editability: DEFAULT_ROLES })
      .select('id')
      .single();
    if (qSub) {
      const qid = (qSub as { id: number }).id;
      await supabase.from('skyline_form_question_options').insert([
        { question_id: qid, value: 'hand', label: 'By hand to trainer/assessor', sort_order: 0 },
        { question_id: qid, value: 'email', label: 'By email to trainer/assessor', sort_order: 1 },
        { question_id: qid, value: 'lms', label: 'Online submission via Learning Management System (LMS)', sort_order: 2 },
        { question_id: qid, value: 'other', label: 'Any other method', sort_order: 3 },
      ]);
    }
    await supabase.from('skyline_form_questions').insert({ section_id: s.id, type: 'short_text', code: 'assessment.otherDesc', label: 'Please describe other method', sort_order: 1, role_visibility: READ_ONLY_VISIBLE, role_editability: DEFAULT_ROLES });
  }

  await createDefaultSectionsToStep(stepId, 4);

  const { data: taskRows } = taskRowIds.length > 0
    ? await supabase.from('skyline_form_question_rows').select('id, row_label').in('id', taskRowIds).order('sort_order')
    : { data: [] };
  const rows = (taskRows as { id: number; row_label: string }[]) || [];
  let taskStepOrder = 1;
  for (const row of rows) {
    const { data: taskStep } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: formId, title: row.row_label, subtitle: 'Instructions, Questions & Results', sort_order: taskStepOrder++ })
      .select('id')
      .single();
    if (taskStep) {
      const taskStepId = (taskStep as { id: number }).id;
      await supabase.from('skyline_form_sections').insert([
        { step_id: taskStepId, title: 'Student Instructions', pdf_render_mode: 'task_instructions', assessment_task_row_id: row.id, sort_order: 0 },
        { step_id: taskStepId, title: 'Questions', pdf_render_mode: 'task_questions', assessment_task_row_id: row.id, sort_order: 1 },
        { step_id: taskStepId, title: 'Results', pdf_render_mode: 'task_results', assessment_task_row_id: row.id, sort_order: 2 },
      ]);
    }
  }

  // Assessment Summary Sheet (common, always after last assessment)
  const { data: summaryStep } = await supabase
    .from('skyline_form_steps')
    .insert({ form_id: formId, title: 'Assessment Summary', subtitle: 'Final record of student competency', sort_order: taskStepOrder++ })
    .select('id')
    .single();
  if (summaryStep) {
    await supabase
      .from('skyline_form_sections')
      .insert({ step_id: (summaryStep as { id: number }).id, title: 'Assessment Summary Sheet', pdf_render_mode: 'assessment_summary', sort_order: 0 });
  }

  // Appendix A - Reasonable Adjustments (after Assessment Summary, required on every form)
  const { data: reasonableStep } = await supabase
    .from('skyline_form_steps')
    .insert({ form_id: formId, title: 'Appendix A - Reasonable Adjustments', subtitle: 'Reasonable adjustment strategies and declaration', sort_order: taskStepOrder++ })
    .select('id')
    .single();
  if (reasonableStep) {
    const raStepId = (reasonableStep as { id: number }).id;
    const { data: raSection } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: raStepId, title: 'Reasonable Adjustment', description: 'Students with carer responsibilities, cultural or religious obligations, English as an additional language, disability etc., can request reasonable adjustments. Academic standards will not be lowered; flexibility in delivery or assessment is required.', pdf_render_mode: 'reasonable_adjustment', sort_order: 0 })
      .select('id')
      .single();
    if (raSection) {
      const raSecId = (raSection as { id: number }).id;
      await supabase.from('skyline_form_questions').insert([
        { section_id: raSecId, type: 'yes_no', code: 'reasonable_adjustment.applied', label: 'Was reasonable adjustment applied to any of these assessment tasks?', sort_order: 0, role_visibility: READ_ONLY_VISIBLE, role_editability: TRAINER_ONLY_EDIT },
        { section_id: raSecId, type: 'short_text', code: 'reasonable_adjustment.task', label: 'Write (task name and number) where reasonable adjustments have been applied', sort_order: 1, role_visibility: READ_ONLY_VISIBLE, role_editability: TRAINER_ONLY_EDIT },
        { section_id: raSecId, type: 'long_text', code: 'reasonable_adjustment.description', label: 'Provide a description of the adjustment applied and explain reasons.', sort_order: 2, role_visibility: READ_ONLY_VISIBLE, role_editability: TRAINER_ONLY_EDIT },
        { section_id: raSecId, type: 'signature', code: 'trainer.reasonableAdjustmentSignature', label: 'Trainer/Assessor Signature', sort_order: 3, role_visibility: READ_ONLY_VISIBLE, role_editability: TRAINER_ONLY_EDIT, pdf_meta: { showNameField: true, showDateField: true } },
      ]);
    }
  }

  // Learner Evaluation (after Appendix A, required on every form)
  const { data: learnerEvalStep } = await supabase
    .from('skyline_form_steps')
    .insert({ form_id: formId, title: 'Learner Evaluation', subtitle: 'Training evaluation and feedback', sort_order: taskStepOrder++ })
    .select('id')
    .single();
  if (learnerEvalStep) {
    const leStepId = (learnerEvalStep as { id: number }).id;
    
    // Participant Information Section
    const { data: participantSec } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: leStepId, title: 'Participant Information', pdf_render_mode: 'normal', sort_order: 0 })
      .select('id')
      .single();
    if (participantSec) {
      const pSecId = (participantSec as { id: number }).id;
      await supabase.from('skyline_form_questions').insert([
        { section_id: pSecId, type: 'short_text', code: 'evaluation.unitName', label: 'Unit of Competency Name', sort_order: 0, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
        { section_id: pSecId, type: 'short_text', code: 'evaluation.studentName', label: 'Student Name (Optional)', sort_order: 1, role_visibility: READ_ONLY_VISIBLE, role_editability: DEFAULT_ROLES },
        { section_id: pSecId, type: 'short_text', code: 'evaluation.trainerName', label: 'Trainer/Assessor Name', sort_order: 2, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
        { section_id: pSecId, type: 'short_text', code: 'evaluation.employer', label: 'Employer/Work site (if applicable)', sort_order: 3, role_visibility: READ_ONLY_VISIBLE, role_editability: DEFAULT_ROLES },
        { section_id: pSecId, type: 'short_text', code: 'evaluation.trainingDates', label: 'Dates of Training', sort_order: 4, role_visibility: READ_ONLY_VISIBLE, role_editability: READ_ONLY_EDIT },
        { section_id: pSecId, type: 'short_text', code: 'evaluation.evaluationDate', label: 'Date of Evaluation', sort_order: 5, role_visibility: READ_ONLY_VISIBLE, role_editability: DEFAULT_ROLES },
      ]);
    }

    // Logistics and Support Evaluation Section
    const { data: logisticsSec } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: leStepId, title: 'Logistics and Support Evaluation', pdf_render_mode: 'likert_table', sort_order: 1 })
      .select('id')
      .single();
    if (logisticsSec) {
      const lSecId = (logisticsSec as { id: number }).id;
      const logisticsQ = await supabase.from('skyline_form_questions')
        .insert({ section_id: lSecId, type: 'likert_5', code: 'evaluation.logistics', label: 'Logistics and Support Evaluation', sort_order: 0, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES })
        .select('id')
        .single();
      if (logisticsQ.data) {
        const qId = (logisticsQ.data as { id: number }).id;
        await supabase.from('skyline_form_question_rows').insert([
          { question_id: qId, row_label: 'The communication regarding the required attendance and time to study to pass this unit was correct', sort_order: 0 },
          { question_id: qId, row_label: 'The staff were efficient and helpful.', sort_order: 1 },
          { question_id: qId, row_label: 'The training equipment and material used was effective and prepared.', sort_order: 2 },
          { question_id: qId, row_label: 'The training venue was conducive to learning (set-up for convenience of students, comfortable in terms of temperature, etc.)', sort_order: 3 },
        ]);
      }
      await supabase.from('skyline_form_questions').insert({
        section_id: lSecId, type: 'long_text', code: 'evaluation.logisticsComments', label: 'Additional Comments on Logistics and Support', sort_order: 1, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES
      });
    }

    // Trainer/Assessor Evaluation Section
    const { data: trainerSec } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: leStepId, title: 'Trainer/Assessor Evaluation', pdf_render_mode: 'likert_table', sort_order: 2 })
      .select('id')
      .single();
    if (trainerSec) {
      const tSecId = (trainerSec as { id: number }).id;
      const trainerQ = await supabase.from('skyline_form_questions')
        .insert({ section_id: tSecId, type: 'likert_5', code: 'evaluation.trainer', label: 'Trainer/Assessor Evaluation', sort_order: 0, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES })
        .select('id')
        .single();
      if (trainerQ.data) {
        const qId = (trainerQ.data as { id: number }).id;
        await supabase.from('skyline_form_question_rows').insert([
          { question_id: qId, row_label: 'The trainer/assessor was prepared and knowledgeable on the subject of the program', sort_order: 0 },
          { question_id: qId, row_label: 'The trainer/assessor encouraged student participation and input', sort_order: 1 },
          { question_id: qId, row_label: 'The trainer/assessor made use of a variety of methods, exercises, activities and discussions', sort_order: 2 },
          { question_id: qId, row_label: 'The trainer/assessor used the material in a structured and effective manner', sort_order: 3 },
          { question_id: qId, row_label: 'The trainer/assessor was approachable and respectful of the learners', sort_order: 4 },
          { question_id: qId, row_label: 'The trainer/assessor was punctual and kept to the schedule', sort_order: 5 },
          { question_id: qId, row_label: 'The trainer/assessor was easy to understand and used the correct language', sort_order: 6 },
        ]);
      }
      await supabase.from('skyline_form_questions').insert({
        section_id: tSecId, type: 'long_text', code: 'evaluation.trainerComments', label: 'Additional Comments on Training', sort_order: 1, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES
      });
    }

    // Learning Evaluation Section
    const { data: learningSec } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: leStepId, title: 'Learning Evaluation', pdf_render_mode: 'likert_table', sort_order: 3 })
      .select('id')
      .single();
    if (learningSec) {
      const learnSecId = (learningSec as { id: number }).id;
      const learningQ = await supabase.from('skyline_form_questions')
        .insert({ section_id: learnSecId, type: 'likert_5', code: 'evaluation.learning', label: 'Learning Evaluation', sort_order: 0, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES })
        .select('id')
        .single();
      if (learningQ.data) {
        const qId = (learningQ.data as { id: number }).id;
        await supabase.from('skyline_form_question_rows').insert([
          { question_id: qId, row_label: 'The learning outcomes of the unit are relevant and suitable.', sort_order: 0 },
          { question_id: qId, row_label: 'The content of the unit was relevant and suitable for the target group.', sort_order: 1 },
          { question_id: qId, row_label: 'The length of the training was suitable for the unit.', sort_order: 2 },
          { question_id: qId, row_label: 'The learning material assisted in the learning of new knowledge and skills to apply in a practical manner.', sort_order: 3 },
          { question_id: qId, row_label: 'The learning material was free from spelling and grammar errors', sort_order: 4 },
          { question_id: qId, row_label: 'Handouts and exercises were clear, concise and relevant to the outcomes and content.', sort_order: 5 },
          { question_id: qId, row_label: 'Learning material was generally of a high standard, and user-friendly', sort_order: 6 },
        ]);
      }
      await supabase.from('skyline_form_questions').insert({
        section_id: learnSecId, type: 'long_text', code: 'evaluation.learningComments', label: 'Additional Comments on Learning Evaluation', sort_order: 1, role_visibility: DEFAULT_ROLES, role_editability: DEFAULT_ROLES
      });
    }
  }
}

export interface CreateFormInput {
  name: string;
  version?: string;
  qualification_code: string;
  qualification_name: string;
  unit_code: string;
  unit_name: string;
  assessment_tasks: AssessmentTask[];
  // Legacy fields for backward compatibility
  assessment_task_1_label?: string;
  assessment_task_1_method?: string;
  assessment_task_2_label?: string;
  assessment_task_2_method?: string;
}

export async function createForm(input: CreateFormInput): Promise<Form | null> {
  const { name, version, qualification_code, qualification_name, unit_code, unit_name, assessment_tasks, assessment_task_1_label, assessment_task_1_method, assessment_task_2_label, assessment_task_2_method } = input;
  const { data, error } = await supabase
    .from('skyline_forms')
    .insert({ name, qualification_code, qualification_name, unit_code, unit_name, version: (version || '1.0.0').trim() || '1.0.0' })
    .select('*')
    .single();
  if (error) {
    console.error('createForm error', error);
    return null;
  }
  const form = data as Form;
  
  // Use new array format if provided, otherwise fall back to legacy format
  if (assessment_tasks && assessment_tasks.length > 0) {
    await createCompulsoryFormStructure(form.id, assessment_tasks);
  } else if (assessment_task_1_label && assessment_task_1_method && assessment_task_2_label && assessment_task_2_method) {
    // Legacy format
    await createCompulsoryFormStructure(form.id, {
      task1_label: assessment_task_1_label,
      task1_method: assessment_task_1_method,
      task2_label: assessment_task_2_label,
      task2_method: assessment_task_2_method,
    });
  } else {
    // Default fallback
    await createCompulsoryFormStructure(form.id);
  }
  return form;
}

export async function listForms(status?: string): Promise<Form[]> {
  let query = supabase.from('skyline_forms').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    console.error('listForms error', error);
    return [];
  }
  return (data as Form[]) || [];
}

/** Returns true if another form (excluding excludeFormId) already has this name (case-insensitive trim). */
export async function formNameExists(name: string, excludeFormId?: number): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const forms = await listForms();
  return forms.some((f) => f.id !== excludeFormId && f.name.trim().toLowerCase() === trimmed.toLowerCase());
}

function nextVersion(version: string | null): string {
  if (!version || typeof version !== 'string') return '1.1.0';
  const parts = version.trim().split('.').map((s) => parseInt(s, 10) || 0);
  const [major = 1, minor = 0] = parts;
  return `${major}.${minor + 1}.0`;
}

export async function duplicateForm(formId: number): Promise<Form | null> {
  const form = await fetchForm(formId);
  if (!form) return null;

  const newVersion = nextVersion(form.version);
  const newName = `${form.name} (Copy)`;

  const { data: newFormData, error: formErr } = await supabase
    .from('skyline_forms')
    .insert({
      name: newName,
      version: newVersion,
      status: form.status ?? 'draft',
      unit_code: form.unit_code,
      unit_name: form.unit_name,
      qualification_code: form.qualification_code,
      qualification_name: form.qualification_name,
      header_asset_url: form.header_asset_url,
      cover_asset_url: form.cover_asset_url,
    })
    .select('*')
    .single();
  if (formErr || !newFormData) {
    console.error('duplicateForm: failed to insert form', formErr);
    return null;
  }
  const newForm = newFormData as Form;
  const newFormId = newForm.id;

  const steps = await fetchFormSteps(formId);
  const rowIdMap = new Map<number, number>();

  for (const step of steps) {
    const { data: newStepData, error: stepErr } = await supabase
      .from('skyline_form_steps')
      .insert({
        form_id: newFormId,
        title: step.title,
        subtitle: step.subtitle,
        sort_order: step.sort_order,
      })
      .select('id')
      .single();
    if (stepErr || !newStepData) {
      console.error('duplicateForm: failed to insert step', stepErr);
      continue;
    }
    const newStepId = (newStepData as { id: number }).id;

    const { data: sections } = await supabase
      .from('skyline_form_sections')
      .select('*')
      .eq('step_id', step.id)
      .order('sort_order', { ascending: true });
    const sectionsList = (sections as (FormSection & { assessment_task_row_id?: number | null })[]) || [];

    for (const section of sectionsList) {
      const mappedRowId = section.assessment_task_row_id != null ? rowIdMap.get(section.assessment_task_row_id) ?? null : null;
      const { data: newSectionData, error: sectionErr } = await supabase
        .from('skyline_form_sections')
        .insert({
          step_id: newStepId,
          title: section.title,
          description: section.description ?? null,
          pdf_render_mode: section.pdf_render_mode,
          sort_order: section.sort_order,
          assessment_task_row_id: mappedRowId,
        })
        .select('id')
        .single();
      if (sectionErr || !newSectionData) {
        console.error('duplicateForm: failed to insert section', sectionErr);
        continue;
      }
      const newSectionId = (newSectionData as { id: number }).id;

      const { data: questions } = await supabase
        .from('skyline_form_questions')
        .select('*')
        .eq('section_id', section.id)
        .order('sort_order', { ascending: true });
      const questionsList = (questions as FormQuestion[]) || [];

      for (const q of questionsList) {
        const { data: newQData, error: qErr } = await supabase
          .from('skyline_form_questions')
          .insert({
            section_id: newSectionId,
            type: q.type,
            code: q.code,
            label: q.label,
            help_text: q.help_text ?? null,
            required: q.required ?? false,
            sort_order: q.sort_order,
            role_visibility: q.role_visibility ?? {},
            role_editability: q.role_editability ?? {},
            pdf_meta: q.pdf_meta ?? {},
          })
          .select('id')
          .single();
        if (qErr || !newQData) {
          console.error('duplicateForm: failed to insert question', qErr);
          continue;
        }
        const newQuestionId = (newQData as { id: number }).id;

        const { data: options } = await supabase
          .from('skyline_form_question_options')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order', { ascending: true });
        const optionsList = (options as FormQuestionOption[]) || [];
        if (optionsList.length > 0) {
          await supabase.from('skyline_form_question_options').insert(
            optionsList.map((o) => ({
              question_id: newQuestionId,
              value: o.value,
              label: o.label,
              sort_order: o.sort_order,
            }))
          );
        }

        const { data: rows } = await supabase
          .from('skyline_form_question_rows')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order', { ascending: true });
        const rowsList = (rows as FormQuestionRow[]) || [];
        for (const row of rowsList) {
          const { data: newRowData, error: rowErr } = await supabase
            .from('skyline_form_question_rows')
            .insert({
              question_id: newQuestionId,
              row_label: row.row_label,
              row_help: row.row_help ?? null,
              row_image_url: row.row_image_url ?? null,
              row_meta: row.row_meta ?? null,
              sort_order: row.sort_order,
            })
            .select('id')
            .single();
          if (!rowErr && newRowData) {
            rowIdMap.set(row.id, (newRowData as { id: number }).id);
          }
        }
      }
    }
  }

  return newForm;
}

export async function updateInstanceRole(instanceId: number, roleContext: string): Promise<void> {
  await supabase.from('skyline_form_instances').update({ role_context: roleContext }).eq('id', instanceId);
}
