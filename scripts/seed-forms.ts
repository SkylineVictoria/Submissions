/**
 * Seed script for SignFlow forms.
 * Run after migration: npm run seed
 * Loads .env from project root. Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createDefaultSectionsToStep } from '../src/lib/defaultFormSteps';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  // 1. Create Training Evaluation Form
  const { data: form, error: formErr } = await supabase
    .from('skyline_forms')
    .insert({
      name: 'Training Evaluation Form',
      version: '1.0.0',
      status: 'published',
      unit_code: 'BSB40120',
      header_asset_url: null,
    })
    .select('id')
    .single();

  if (formErr || !form) {
    console.error('Failed to create form', formErr);
    process.exit(1);
  }

  const formId = form.id as number;

  // Helper to create steps and get IDs
  const createStep = async (fid: number, title: string, subtitle: string | null, sortOrder: number) => {
    const { data, error } = await supabase
      .from('skyline_form_steps')
      .insert({ form_id: fid, title, subtitle, sort_order: sortOrder })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const createSection = async (
    stepId: number,
    title: string,
    description: string | null,
    pdfRenderMode: string,
    sortOrder: number
  ) => {
    const { data, error } = await supabase
      .from('skyline_form_sections')
      .insert({ step_id: stepId, title, description, pdf_render_mode: pdfRenderMode, sort_order: sortOrder })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const createQuestion = async (
    sectionId: number,
    type: string,
    code: string | null,
    label: string,
    helpText: string | null,
    required: boolean,
    sortOrder: number,
    roleVisibility: Record<string, boolean>,
    roleEditability: Record<string, boolean>,
    pdfMeta: Record<string, unknown>
  ) => {
    const { data, error } = await supabase
      .from('skyline_form_questions')
      .insert({
        section_id: sectionId,
        type,
        code,
        label,
        help_text: helpText,
        required,
        sort_order: sortOrder,
        role_visibility: roleVisibility,
        role_editability: roleEditability,
        pdf_meta: pdfMeta,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const createOption = async (questionId: number, value: string, label: string, sortOrder: number) => {
    await supabase.from('skyline_form_question_options').insert({ question_id: questionId, value, label, sort_order: sortOrder });
  };

  const createRow = async (
    questionId: number,
    rowLabel: string,
    rowHelp: string | null,
    rowImageUrl: string | null,
    sortOrder: number
  ) => {
    const { data, error } = await supabase
      .from('skyline_form_question_rows')
      .insert({ question_id: questionId, row_label: rowLabel, row_help: rowHelp, row_image_url: rowImageUrl, sort_order: sortOrder })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const defaultRoles = { student: true, trainer: true, office: true };
  const readOnlyRoles = { student: true, trainer: true, office: true }; // visible to all, editable by none
  const trainerOnlyEdit = { student: false, trainer: true, office: false };
  const studentTrainerEdit = { student: true, trainer: true, office: false }; // assessment submission: student & trainer
  const studentOnly = { student: true, trainer: false, office: true };
  const trainerOnly = { student: false, trainer: true, office: true };
  const officeOnly = { student: false, trainer: false, office: true };

  // Single compulsory step: Student, Trainer, Qualification, Assessment Tasks, Assessment Submission
  const stepComp = await createStep(formId, 'Introductory Details', 'Student, trainer, qualification & assessment', 0);
  const sec1_1 = await createSection(stepComp, 'Student and trainer details', null, 'normal', 0);
  await createQuestion(sec1_1, 'short_text', 'student.fullName', 'Student Full Name', null, true, 0, defaultRoles, defaultRoles, {});
  await createQuestion(sec1_1, 'short_text', 'student.id', 'Student ID', null, true, 1, defaultRoles, defaultRoles, {});
  await createQuestion(sec1_1, 'short_text', 'student.email', 'Student Email', null, true, 2, defaultRoles, defaultRoles, {});
  await createQuestion(sec1_1, 'short_text', 'trainer.fullName', 'Trainer Full Name', null, true, 3, defaultRoles, defaultRoles, {});

  const sec2 = await createSection(stepComp, 'Qualification and unit of competency', null, 'normal', 1);
  await createQuestion(sec2, 'short_text', 'qualification.code', 'Qualification Code', null, false, 0, defaultRoles, defaultRoles, {});
  await createQuestion(sec2, 'short_text', 'qualification.name', 'Qualification Name', null, false, 1, defaultRoles, defaultRoles, {});
  await createQuestion(sec2, 'short_text', 'unit.code', 'Unit Code', null, false, 2, defaultRoles, defaultRoles, {});
  await createQuestion(sec2, 'short_text', 'unit.name', 'Unit Name', null, false, 3, defaultRoles, defaultRoles, {});

  const sec2Assessment = await createSection(
    stepComp,
    'Assessment Tasks',
    'The student must be assessed as satisfactory in each of the following assessment tasks in order to demonstrate competence.',
    'assessment_tasks',
    2
  );
  const qAssessment = await createQuestion(sec2Assessment, 'grid_table', 'assessment.tasks', 'Assessment Tasks', null, false, 0, readOnlyRoles, { student: false, trainer: false, office: false }, { columns: ['Evidence number', 'Assessment method/ Type of evidence'] });
  await createRow(qAssessment, 'Assessment task 1', 'Written Assessment (WA)', null, 0);
  await createRow(qAssessment, 'Assessment task 2', 'Practical Task 2.1\nPractical Task 2.2\nPractical Task 2.3', null, 1);

  const sec2Submission = await createSection(stepComp, 'Assessment Submission Method', null, 'assessment_submission', 3);
  const qSub = await createQuestion(sec2Submission, 'multi_choice', 'assessment.submission', 'Assessment Submission Method', null, false, 0, readOnlyRoles, studentTrainerEdit, {});
  await createOption(qSub, 'hand', 'By hand to trainer/assessor', 0);
  await createOption(qSub, 'email', 'By email to trainer/assessor', 1);
  await createOption(qSub, 'lms', 'Online submission via Learning Management System (LMS)', 2);
  await createOption(qSub, 'other', 'Any other method', 3);
  await createQuestion(sec2Submission, 'short_text', 'assessment.otherDesc', 'Please describe other method', null, false, 1, readOnlyRoles, studentTrainerEdit, {});

  // Step 2: Logistics & Support (likert_table)
  const step3 = await createStep(formId, 'Logistics & Support', 'Evaluate logistics and support services', 1);
  const sec3 = await createSection(step3, 'Logistics and Support Evaluation', null, 'likert_table', 0);
  const q3_1 = await createQuestion(sec3, 'likert_5', 'logistics.q1', 'The communication regarding the required attendance and time to study to pass this unit was correct', null, true, 0, studentOnly, studentOnly, {});
  await createRow(q3_1, 'The communication regarding the required attendance and time to study to pass this unit was correct', null, null, 0);
  const q3_2 = await createQuestion(sec3, 'likert_5', 'logistics.q2', 'The staff were efficient and helpful.', null, true, 1, studentOnly, studentOnly, {});
  await createRow(q3_2, 'The staff were efficient and helpful.', null, null, 0);
  const q3_3 = await createQuestion(sec3, 'likert_5', 'logistics.q3', 'The training equipment and material used was effective and prepared.', null, true, 2, studentOnly, studentOnly, {});
  await createRow(q3_3, 'The training equipment and material used was effective and prepared.', null, null, 0);
  const q3_4 = await createQuestion(sec3, 'likert_5', 'logistics.q4', 'The training venue was conducive to learning', null, true, 3, studentOnly, studentOnly, {});
  await createRow(q3_4, 'The training venue was conducive to learning (set-up for convenience of students, comfortable in terms of temperature, etc.)', null, null, 0);
  const sec3_comments = await createSection(step3, 'Comments', 'Additional comments on logistics', 'normal', 1);
  await createQuestion(sec3_comments, 'long_text', 'logistics.comments', 'Additional Comments on Logistics and Support', null, false, 0, studentOnly, studentOnly, {});

  // Step 3: Trainer/Assessor (likert_table)
  const step4 = await createStep(formId, 'Trainer/Assessor', 'Evaluate trainer/assessor performance', 2);
  const sec4 = await createSection(step4, 'Trainer/Assessor Evaluation', null, 'likert_table', 0);
  const trainerQs = [
    'The student demonstrated understanding of key concepts',
    'The student actively participated in activities',
    'The student completed assignments on time',
    'The student showed improvement throughout the course',
    'The student met the assessment requirements',
    'The student demonstrated practical skills effectively',
    'Overall, the student performed satisfactorily',
  ];
  for (let i = 0; i < trainerQs.length; i++) {
    const qid = await createQuestion(sec4, 'likert_5', `trainer.q${i + 1}`, trainerQs[i], null, true, i, trainerOnly, trainerOnly, {});
    await createRow(qid, trainerQs[i], null, null, 0);
  }
  const sec4_comments = await createSection(step4, 'Comments', null, 'normal', 1);
  await createQuestion(sec4_comments, 'long_text', 'trainer.comments', 'Additional Comments on Training', null, false, 0, trainerOnly, trainerOnly, {});

  // Step 4: Learning (likert_table)
  const step5 = await createStep(formId, 'Learning', 'Evaluate learning experience', 3);
  const sec5 = await createSection(step5, 'Learning Evaluation', null, 'likert_table', 0);
  const learningQs = [
    'The learning materials were clear and well-organized',
    'The trainer explained concepts effectively',
    'The pace of instruction was appropriate',
    'I had sufficient opportunities to practice',
    'The assessment criteria were clear',
    'I feel confident in applying what I learned',
    'Overall, I am satisfied with the training',
  ];
  for (let i = 0; i < learningQs.length; i++) {
    const qid = await createQuestion(sec5, 'likert_5', `learning.q${i + 1}`, learningQs[i], null, true, i, studentOnly, studentOnly, {});
    await createRow(qid, learningQs[i], null, null, 0);
  }
  const sec5_comments = await createSection(step5, 'Comments', null, 'normal', 1);
  await createQuestion(sec5_comments, 'long_text', 'learning.comments', 'Additional Comments on Learning Evaluation', null, false, 0, studentOnly, studentOnly, {});

  // Step 5: Declarations & Signature (declarations)
  const step6 = await createStep(formId, 'Declarations & Signature', 'Final declarations and signatures', 4);
  const sec6_decl = await createSection(step6, 'Final Declarations', null, 'declarations', 0);
  const q_ack = await createQuestion(sec6_decl, 'yes_no', 'declaration.acknowledged', 'I acknowledge that I have read and understood the assessment requirements', null, true, 0, defaultRoles, defaultRoles, {});
  await createOption(q_ack, 'yes', 'Yes', 0);
  await createOption(q_ack, 'no', 'No', 1);
  const q_acc = await createQuestion(sec6_decl, 'yes_no', 'declaration.accurate', 'I confirm that the information provided is accurate and complete', null, true, 1, defaultRoles, defaultRoles, {});
  await createOption(q_acc, 'yes', 'Yes', 0);
  await createOption(q_acc, 'no', 'No', 1);

  const sec6_sig = await createSection(step6, 'Signatures', null, 'declarations', 1);
  await createQuestion(sec6_sig, 'signature', 'student.signature', 'Student Signature', null, true, 0, studentOnly, studentOnly, { showNameField: true, showDateField: true });
  await createQuestion(sec6_sig, 'signature', 'trainer.signature', 'Trainer/Assessor Signature', null, true, 1, trainerOnly, trainerOnly, { showNameField: true, showDateField: true });

  const sec6_office = await createSection(step6, 'Office Use Only', null, 'declarations', 2);
  await createQuestion(sec6_office, 'short_text', 'office.approved', 'Approved By', null, false, 0, officeOnly, officeOnly, {});
  await createQuestion(sec6_office, 'date', 'office.date', 'Approval Date', null, false, 1, officeOnly, officeOnly, {});
  await createQuestion(sec6_office, 'long_text', 'office.notes', 'Office Notes', null, false, 2, officeOnly, officeOnly, {});

  await createDefaultSectionsToStep(stepComp, 4, supabase);

  // 2. Create Shapes Perimeter form (grid_table)
  const { data: form2, error: form2Err } = await supabase
    .from('skyline_forms')
    .insert({
      name: 'Shapes Perimeter Assessment',
      version: '1.0.0',
      status: 'published',
      unit_code: 'MATH101',
      header_asset_url: null,
    })
    .select('id')
    .single();

  if (form2Err || !form2) {
    console.error('Failed to create form 2', form2Err);
    process.exit(1);
  }

  const form2Id = form2.id as number;

  // Single compulsory step: Student, Trainer, Qualification, Assessment Tasks, Assessment Submission
  const step2Comp = await createStep(form2Id, 'Introductory Details', 'Student, trainer, qualification & assessment', 0);
  const sec2_1 = await createSection(step2Comp, 'Student and trainer details', null, 'normal', 0);
  await createQuestion(sec2_1, 'short_text', 'student.fullName', 'Student Full Name', null, true, 0, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_1, 'short_text', 'student.id', 'Student ID', null, true, 1, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_1, 'short_text', 'student.email', 'Student Email', null, true, 2, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_1, 'short_text', 'trainer.fullName', 'Trainer Full Name', null, true, 3, defaultRoles, defaultRoles, {});

  const sec2_2a = await createSection(step2Comp, 'Qualification and unit of competency', null, 'normal', 1);
  await createQuestion(sec2_2a, 'short_text', 'qualification.code', 'Qualification Code', null, false, 0, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_2a, 'short_text', 'qualification.name', 'Qualification Name', null, false, 1, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_2a, 'short_text', 'unit.code', 'Unit Code', null, false, 2, defaultRoles, defaultRoles, {});
  await createQuestion(sec2_2a, 'short_text', 'unit.name', 'Unit Name', null, false, 3, defaultRoles, defaultRoles, {});
  const sec2_2b = await createSection(step2Comp, 'Assessment Tasks', 'The student must be assessed as satisfactory in each of the following assessment tasks in order to demonstrate competence.', 'assessment_tasks', 2);
  const q2Assessment = await createQuestion(sec2_2b, 'grid_table', 'assessment.tasks', 'Assessment Tasks', null, false, 0, readOnlyRoles, { student: false, trainer: false, office: false }, { columns: ['Evidence number', 'Assessment method/ Type of evidence'] });
  await createRow(q2Assessment, 'Assessment task 1', 'Written Assessment (WA)', null, 0);
  await createRow(q2Assessment, 'Assessment task 2', 'Practical Task 2.1\nPractical Task 2.2\nPractical Task 2.3', null, 1);
  const sec2_2c = await createSection(step2Comp, 'Assessment Submission Method', null, 'assessment_submission', 3);
  const q2Sub = await createQuestion(sec2_2c, 'multi_choice', 'assessment.submission', 'Assessment Submission Method', null, false, 0, readOnlyRoles, studentTrainerEdit, {});
  await createOption(q2Sub, 'hand', 'By hand to trainer/assessor', 0);
  await createOption(q2Sub, 'email', 'By email to trainer/assessor', 1);
  await createOption(q2Sub, 'lms', 'Online submission via Learning Management System (LMS)', 2);
  await createOption(q2Sub, 'other', 'Any other method', 3);
  await createQuestion(sec2_2c, 'short_text', 'assessment.otherDesc', 'Please describe other method', null, false, 1, readOnlyRoles, studentTrainerEdit, {});

  await createDefaultSectionsToStep(step2Comp, 4, supabase);

  // Form-specific: Shapes Perimeter step
  const stepShape = await createStep(form2Id, 'Shapes Perimeter', 'Calculate perimeter formulas', 1);
  const secShape = await createSection(stepShape, 'Shapes Perimeter', 'Identify perimeter formula and example for each shape', 'grid_table', 0);

  const shapeRows = [
    { label: 'Equilateral Triangle', imageUrl: 'https://placehold.co/80x60/eee/999?text=Tri' },
    { label: 'Scalene Triangle', imageUrl: 'https://placehold.co/80x60/eee/999?text=Tri' },
    { label: 'Square', imageUrl: 'https://placehold.co/80x60/eee/999?text=Sq' },
    { label: 'Rectangle', imageUrl: 'https://placehold.co/80x60/eee/999?text=Rect' },
    { label: 'Quadrilateral', imageUrl: 'https://placehold.co/80x60/eee/999?text=Quad' },
    { label: 'Regular Pentagon', imageUrl: 'https://placehold.co/80x60/eee/999?text=Pent' },
  ];

  const qShape = await createQuestion(
    secShape,
    'grid_table',
    'shapes.perimeter',
    'Shapes Perimeter',
    'Enter the perimeter formula and an example for each shape',
    true,
    0,
    defaultRoles,
    defaultRoles,
    { columns: ['Perimeter Formula', 'Example'] }
  );

  for (let i = 0; i < shapeRows.length; i++) {
    await createRow(qShape, shapeRows[i].label, null, shapeRows[i].imageUrl, i);
  }

  // 3. Add sample students
  try {
    await supabase.from('skyline_students').insert([
      { name: 'Alice Johnson', email: 'alice@example.com' },
      { name: 'Bob Smith', email: 'bob@example.com' },
      { name: 'Carol Williams', email: 'carol@example.com' },
    ]);
    console.log('Added 3 sample students.');
  } catch (e) {
    console.warn('Could not add students (run migration 20250211000001_add_students.sql first):', e);
  }

  console.log('Seed completed successfully.');
  console.log('Created Training Evaluation Form (id:', formId, ') and Shapes Perimeter Assessment (id:', form2Id, ')');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
