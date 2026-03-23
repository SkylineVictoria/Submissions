-- Remove Candidate Name, Assessor Name, and Assessment date/s questions from
-- Assessment Marking Checklist sections. Answers are cascade-deleted via FK.

DELETE FROM skyline_form_questions
WHERE code IN (
  'assessment.marking.candidateName',
  'assessment.marking.assessorName',
  'assessment.marking.assessmentDate'
);
