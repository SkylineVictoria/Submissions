-- Add task_marking_checklist (and reasonable_adjustment_indicator) to pdf_render_mode constraint.
-- task_marking_checklist: Assessment Marking Checklist section between Written Evidence Checklist and Results.
-- reasonable_adjustment_indicator: Used when Appendix A exists (20260310000003).
ALTER TABLE skyline_form_sections DROP CONSTRAINT IF EXISTS skyline_form_sections_pdf_render_mode_check;
ALTER TABLE skyline_form_sections ADD CONSTRAINT skyline_form_sections_pdf_render_mode_check
  CHECK (pdf_render_mode IN (
    'normal', 'likert_table', 'grid_table', 'declarations',
    'assessment_tasks', 'assessment_submission', 'reasonable_adjustment',
    'reasonable_adjustment_indicator',
    'task_instructions', 'task_questions', 'task_written_evidence_checklist',
    'task_marking_checklist',
    'task_results', 'assessment_summary'
  ));
