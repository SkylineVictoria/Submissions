-- Allow additional_instructions in skyline_form_sections.pdf_render_mode
ALTER TABLE skyline_form_sections DROP CONSTRAINT IF EXISTS skyline_form_sections_pdf_render_mode_check;
ALTER TABLE skyline_form_sections ADD CONSTRAINT skyline_form_sections_pdf_render_mode_check
  CHECK (pdf_render_mode IN (
    'normal', 'likert_table', 'grid_table', 'declarations',
    'assessment_tasks', 'assessment_submission', 'reasonable_adjustment',
    'reasonable_adjustment_indicator',
    'additional_instructions',
    'task_instructions', 'task_questions', 'task_written_evidence_checklist',
    'task_marking_checklist',
    'task_results', 'assessment_summary'
  ));

