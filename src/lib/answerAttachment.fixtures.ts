/** Test fixtures: one sample answer value per answerable question type, as each renderer emits it. */
export const SAMPLE_INNER_BY_TYPE: Record<string, unknown> = {
  short_text: 'A short answer',
  long_text: 'A long answer\nwith two lines',
  yes_no: 'yes',
  single_choice: 'option_b',
  multi_choice: ['option_a', 'option_c'],
  likert_5: '4',
  grid_table: { r1_c0: 'cell' },
  image: { url: 'https://example.supabase.co/storage/v1/object/public/photomedia/skyline/answers/7/11/answer.png' },
  date: '2026-11-11',
  signature: { signature: 'data:image/png;base64,AAAA', date: '2026-11-11' },
};

/** Every question type in the skyline_form_questions.type check constraint that holds an answer. */
export const ANSWERABLE_TYPES = Object.keys(SAMPLE_INNER_BY_TYPE);
