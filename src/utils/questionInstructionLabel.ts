import type { TaskInstructionsData } from '../components/form-fill/TaskInstructionsModal';

export function getQuestionInstructionsData(pdfMeta: unknown): TaskInstructionsData | null {
  const pm = (pdfMeta as Record<string, unknown>) || {};
  const instr = pm.instructions as TaskInstructionsData | undefined;
  return instr && typeof instr === 'object' ? instr : null;
}

export function isRichTaskQuestionInstruction(question: { type: string; pdf_meta?: unknown }): boolean {
  if (question.type !== 'instruction_block') return false;
  const instr = getQuestionInstructionsData(question.pdf_meta);
  if (!instr) return false;
  if (Array.isArray(instr.blocks) && instr.blocks.length > 0) return true;
  return Boolean(
    instr.assessment_type ||
      instr.task_description ||
      instr.applicable_conditions ||
      instr.resubmissions ||
      instr.location_intro ||
      instr.answering_instructions ||
      instr.purpose_intro ||
      instr.task_instructions
  );
}

export function getQuestionInstructionListLabel(question: {
  type: string;
  label?: string | null;
  help_text?: string | null;
  pdf_meta?: unknown;
}): string {
  if (question.type !== 'instruction_block') return question.label || question.type || 'Question';
  const instr = getQuestionInstructionsData(question.pdf_meta);
  const firstBlock = instr?.blocks?.[0];
  const fromHeading = String(firstBlock?.heading || '').trim();
  if (fromHeading) return fromHeading;
  const fromContent = String(firstBlock?.content || '')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (fromContent) return fromContent.length > 48 ? `${fromContent.slice(0, 48)}…` : fromContent;
  if (question.label?.trim()) return question.label.trim();
  if (question.help_text?.trim()) {
    const t = question.help_text.trim();
    return t.length > 48 ? `${t.slice(0, 48)}…` : t;
  }
  return 'Instruction';
}
