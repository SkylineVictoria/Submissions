-- Update Written Evidence Checklist and Assessment Marking Checklist questions so both
-- trainer and office can edit. Default role_editability: trainer + office.

UPDATE skyline_form_questions
SET role_editability = '{"student": false, "trainer": true, "office": true}'::jsonb
WHERE code IN (
  'written.evidence.checklist',
  'assessment.marking.candidateName',
  'assessment.marking.assessorName',
  'assessment.marking.assessmentDate',
  'assessment.marking.evidence_outcome',
  'assessment.marking.performance_outcome'
);
