/**
 * Matches pdf-server task_questions numbering (htmlGenerator / index buildHtml):
 * top-level questions only, excluding instruction_block and isAdditionalBlockOf;
 * page_break entries do not consume a Q number.
 */
export function getTaskQuestionDisplayNumbers(
  questions: Array<{ id: number; type: string; pdf_meta?: unknown }>
): Map<number, number> {
  const renderable = questions.filter(
    (q) => q.type !== 'instruction_block' && !((q.pdf_meta as Record<string, unknown>)?.isAdditionalBlockOf)
  );
  const map = new Map<number, number>();
  let qNum = 0;
  for (const q of renderable) {
    if (q.type === 'page_break') continue;
    qNum++;
    map.set(q.id, qNum);
  }
  return map;
}
