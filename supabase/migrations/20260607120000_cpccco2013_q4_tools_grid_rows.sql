-- CPCCCO2013 Q4 (question 8019): student answers were saved as 12 "Tool : Use" lines
-- but the template only had 1 grid row after rows were added. Expand to 12 rows.

INSERT INTO skyline_form_question_rows (question_id, row_label, sort_order)
SELECT 8019, '', gs.n
FROM generate_series(1, 11) AS gs(n)
WHERE EXISTS (SELECT 1 FROM skyline_form_questions WHERE id = 8019)
  AND (SELECT count(*) FROM skyline_form_question_rows WHERE question_id = 8019) < 12;
