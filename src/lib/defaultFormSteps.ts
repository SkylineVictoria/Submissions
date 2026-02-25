/**
 * Default steps 5-19 added when creating a new form (ends at Special needs).
 * Reasonable Adjustment (step 15) is trainer-only editable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const READ_ONLY_VISIBLE = { student: true, trainer: true, office: true };
const TRAINER_ONLY_EDIT = { student: false, trainer: true, office: false };

const STUDENT_ONLY = { student: true, trainer: false, office: true };

interface StepDef {
  title: string;
  subtitle?: string | null;
  sections: { title: string; description?: string | null; pdf_render_mode: string; questions: QuestionDef[] }[];
}

interface QuestionDef {
  type: string;
  code?: string | null;
  label: string;
  help_text?: string | null;
  required?: boolean;
  role_visibility: Record<string, boolean>;
  role_editability: Record<string, boolean>;
  pdf_meta?: Record<string, unknown>;
  options?: { value: string; label: string }[];
}

const DEFAULT_STEPS_5_TO_20: StepDef[] = [
  {
    title: 'Student declaration',
    sections: [
      {
        title: 'Student declaration',
        description: `• I have read and understood the information in the Unit Requirements prior to commencing this Student Pack
• I certify that the work submitted for this assessment pack is my own. I have clearly referenced any sources used in my submission. I understand that a false declaration is a form of malpractice.
• I have kept a copy of this Student Pack and all relevant notes, attachments, and reference material that I used in the production of this Student Pack.
• For the purposes of assessment, I give the trainer/assessor permission to:
  i. Reproduce this assessment and provide a copy to another member of staff; and
  ii. Take steps to authenticate the assessment, including communicating a copy of this assessment to a plagiarism checking service (which may retain a copy of the assessment on its database for future plagiarism checking).`,
        pdf_render_mode: 'declarations',
        questions: [
          {
            type: 'signature',
            code: 'student.declarationSignature',
            label: 'Student signature',
            required: true,
            role_visibility: STUDENT_ONLY,
            role_editability: STUDENT_ONLY,
            pdf_meta: { showNameField: true, showDateField: true },
          },
        ],
      },
    ],
  },
  {
    title: 'Instructions to complete outcomes',
    sections: [
      {
        title: 'Instructions to complete the outcomes of assessment',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Instructions',
            help_text: `Fill out assessment outcome records in the Student Pack when:
• The student has completed all requirements for the assessment tasks for the unit of competency.
• The student's work has been reviewed and assessed by you.
• A satisfactory/unsatisfactory result has been recorded for each assessment task.
• Relevant and detailed feedback has been provided to the student.

Every assessment has a 'Feedback to Student' section where all information must be filled out appropriately, including: results (Satisfactory or Unsatisfactory), student name/signature/date, assessor name/signature/date, and relevant detailed feedback.`,
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Unit Requirements',
    sections: [
      {
        title: 'Unit Requirements',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Unit Requirements',
            help_text: 'The student must read and understand all the information in the Unit Requirements before completing the Student Pack.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Feedback to student',
    sections: [
      {
        title: 'Feedback to student',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Feedback to student',
            help_text: `Feedback on student assessment performance is vital for learning. Purpose: to justify how competency was assessed, identify and reward specific qualities, recommend improvements, and guide students on next steps. Feedback should be provided for each Assessment Task, guide students to adapt learning strategies, and guide trainers/assessors to adapt teaching. It should be constructive, timely, and meaningful. Avoid short one-word comments like 'Fantastic' or 'Great work!'`,
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Plagiarism',
    sections: [
      {
        title: 'Plagiarism',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Plagiarism',
            help_text: 'Plagiarism is presenting another person\'s work as your own. It is a serious act. Activities include copying, not acknowledging sources, and submitting work done by others. Consult your trainer/assessor if you have doubts. If plagiarism is identified, a meeting will be organized and further action taken. For more information, refer to the Training Organisation\'s Student Handbook.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Collusion',
    sections: [
      {
        title: 'Collusion',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Collusion',
            help_text: 'Collusion is unauthorized collaboration. Both parties are subject to disciplinary action and will result in a "0" grade and "NYC" (Not Yet Competent). Assessments must be typed (e.g. MS Office). Handwritten assessments will not be accepted unless prior written confirmation is provided by the trainer/assessor.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Competency outcome',
    sections: [
      {
        title: 'Competency outcome',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Competency outcome',
            help_text: 'Assessment outcomes: S (Satisfactory) and NS (Not Satisfactory). Learners who complete tasks satisfactorily are awarded Competent (C) or Not Yet Competent (NYC). If deemed NYC, feedback will be provided by the assessor and a chance to resubmit given. If still NYC, re-enrolment in the unit is required.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Additional evidence',
    sections: [
      {
        title: 'Additional evidence',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Additional evidence',
            help_text: 'The organisation reserves the right to request additional information or evidence to determine competency, subject to privacy and confidentiality requirements.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Reassessment',
    sections: [
      {
        title: 'Reassessment',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Reassessment',
            help_text: 'Students receiving NS for an assessment can re-submit twice for free. If still unsuccessful after the first re-sit, they must re-sit/resubmit again. If they still don\'t achieve Competent for the Unit, they must enrol in the entire unit and pay a repeat unit fee.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Fail to complete by due date',
    sections: [
      {
        title: 'Fail to complete by due date',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Fail to complete by due date',
            help_text: 'If an assessment is not completed by the due date, the Assessor will record this and the student will be marked NS. Students must either: (a) notify the trainer and/or assessor in writing (including the reason) 24 hours prior to the assessment to extend the due date, or (b) supply a doctor\'s certificate within 24 hours after the initial assessment date to avoid an NS mark.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Reasonable Adjustment',
    sections: [
      {
        title: 'Reasonable Adjustment',
        description: 'Adjustments can be made to the way assessments are conducted to enhance fairness and flexibility. In the case that the tool may need adapting to meet specific needs of students, your trainer may provide extra support, allow extra time and/or provide the student with picture cues to aid with assessment.',
        pdf_render_mode: 'reasonable_adjustment',
        questions: [
          {
            type: 'yes_no',
            code: 'reasonable_adjustment.applied',
            label: 'Was reasonable adjustment applied to any of these assessment tasks?',
            required: false,
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: TRAINER_ONLY_EDIT,
            options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
          },
          {
            type: 'short_text',
            code: 'reasonable_adjustment.task',
            label: 'If yes, which assessment task was this applied to?',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: TRAINER_ONLY_EDIT,
          },
          {
            type: 'long_text',
            code: 'reasonable_adjustment.description',
            label: 'Provide a description of the adjustment applied and explain reasons.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: TRAINER_ONLY_EDIT,
          },
          {
            type: 'signature',
            code: 'trainer.reasonableAdjustmentSignature',
            label: 'Trainer Signature',
            required: false,
            role_visibility: { student: true, trainer: true, office: true },
            role_editability: TRAINER_ONLY_EDIT,
            pdf_meta: { showNameField: true, showDateField: true },
          },
        ],
      },
    ],
  },
  {
    title: 'Confidentiality',
    sections: [
      {
        title: 'Confidentiality',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Confidentiality',
            help_text: 'Information (job, workplace, employer) is treated with strict confidence in accordance with the law. You are responsible for ensuring consent from third parties (employer, colleagues, etc.) before disclosing information and for ensuring privacy rights and confidentiality obligations are not breached.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Assessment appeals process',
    sections: [
      {
        title: 'Assessment appeals process',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Assessment appeals process',
            help_text: 'You have the right to lodge an appeal if you feel unfairly treated or are unhappy with your assessment outcome. The first step is to discuss the issue with your trainer/assessor. If further action is desired, an appeal must be lodged with the training organisation in writing, outlining the reasons.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Recognised prior learning',
    sections: [
      {
        title: 'Recognised prior learning',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Recognised prior learning',
            help_text: 'Candidates will be able to have their previous experience or expertise recognised on request.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
  {
    title: 'Special needs',
    sections: [
      {
        title: 'Special needs',
        pdf_render_mode: 'normal',
        questions: [
          {
            type: 'instruction_block',
            label: 'Special needs',
            help_text: 'Candidates with special needs should notify their trainer/assessor to request any required adjustments as soon as possible. This will enable the trainer/assessor to address the identified needs immediately.',
            role_visibility: READ_ONLY_VISIBLE,
            role_editability: { student: false, trainer: false, office: false },
          },
        ],
      },
    ],
  },
];

/** Add default policy sections (5-20) to an existing Introductory Details step */
export async function createDefaultSectionsToStep(
  stepId: number,
  startSortOrder: number,
  client?: SupabaseClient
): Promise<void> {
  const db = client ?? supabase;
  let sectionSortOrder = startSortOrder;
  for (const stepDef of DEFAULT_STEPS_5_TO_20) {
    // Skip Reasonable Adjustment - it's already added by createCompulsoryFormStructure in Introductory Details
    if (stepDef.title === 'Reasonable Adjustment') continue;
    for (const secDef of stepDef.sections) {
      const { data: sec } = await db
        .from('skyline_form_sections')
        .insert({
          step_id: stepId,
          title: secDef.title,
          description: secDef.description ?? null,
          pdf_render_mode: secDef.pdf_render_mode,
          sort_order: sectionSortOrder++,
        })
        .select('id')
        .single();
      if (!sec) continue;
      const secId = (sec as { id: number }).id;

      for (let k = 0; k < secDef.questions.length; k++) {
        const qDef = secDef.questions[k];
        const insert: Record<string, unknown> = {
          section_id: secId,
          type: qDef.type,
          code: qDef.code ?? null,
          label: qDef.label,
          help_text: qDef.help_text ?? null,
          required: qDef.required ?? false,
          sort_order: k,
          role_visibility: qDef.role_visibility,
          role_editability: qDef.role_editability,
          pdf_meta: qDef.pdf_meta ?? {},
        };
        const { data: q } = await db
          .from('skyline_form_questions')
          .insert(insert)
          .select('id')
          .single();
        if (q && qDef.options) {
          const qid = (q as { id: number }).id;
          for (let o = 0; o < qDef.options.length; o++) {
            await db
              .from('skyline_form_question_options')
              .insert({ question_id: qid, value: qDef.options[o].value, label: qDef.options[o].label, sort_order: o });
          }
        }
      }
    }
  }
}

/** @deprecated Use createDefaultSectionsToStep(stepId, 4) instead */
export async function createDefaultSteps5To20(formId: number, client?: SupabaseClient): Promise<void> {
  const db = client ?? supabase;
  const { data: step } = await db
    .from('skyline_form_steps')
    .select('id')
    .eq('form_id', formId)
    .eq('title', 'Introductory Details')
    .order('sort_order', { ascending: true })
    .limit(1)
    .single();
  if (step) {
    await createDefaultSectionsToStep((step as { id: number }).id, 4, client);
  }
}
