-- READ-ONLY diagnostic: duplicated form questions that share content-block child IDs.
-- Do not rewrite production data from this report without a content-safety review.
--
-- Issue pattern: after a bad Duplicate, two parents may reference the same
-- pdf_meta.contentBlocks[].questionId, so editing one child/table affects both.

WITH parents AS (
  SELECT
    q.id AS parent_id,
    q.section_id,
    s.step_id,
    st.form_id,
    q.label AS parent_label,
    q.sort_order,
    (block->>'questionId')::bigint AS child_id,
    ord.ordinality AS block_index
  FROM skyline_form_questions q
  JOIN skyline_form_sections s ON s.id = q.section_id
  JOIN skyline_form_steps st ON st.id = s.step_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(q.pdf_meta->'contentBlocks') = 'array' THEN q.pdf_meta->'contentBlocks'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS ord(block, ordinality)
  WHERE (block->>'questionId') ~ '^[0-9]+$'
),
shared AS (
  SELECT
    child_id,
    array_agg(parent_id ORDER BY parent_id) AS parent_ids,
    COUNT(*) AS parent_count
  FROM parents
  GROUP BY child_id
  HAVING COUNT(*) > 1
)
SELECT
  p.form_id,
  p.step_id,
  p.section_id,
  p.parent_id AS question_id,
  p.sort_order AS display_order,
  p.parent_label AS label,
  s.child_id AS shared_child_question_id,
  s.parent_ids AS parents_sharing_child,
  s.parent_count,
  'shared contentBlocks.questionId across parents' AS issue
FROM shared s
JOIN parents p ON p.child_id = s.child_id
ORDER BY s.parent_count DESC, s.child_id, p.parent_id;
