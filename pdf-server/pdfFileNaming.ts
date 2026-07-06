export type PdfFilenameQuestionStep = {
  sections: Array<{
    questions: Array<{ question: { code: string | null; id: number } }>;
  }>;
};

export function sanitizePdfFilenameSegment(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

export function sanitizeSharePointFolderSegment(value: string): string {
  return sanitizePdfFilenameSegment(value).replace(/\.+$/, '');
}

export function extractStudentFieldsFromAnswers(
  steps: PdfFilenameQuestionStep[],
  answerMap: Map<string, unknown>,
): { studentId: string; studentName: string } {
  let studentId = '';
  let studentName = '';

  for (const step of steps) {
    for (const { questions } of step.sections) {
      for (const { question } of questions) {
        const code = String(question.code ?? '').trim();
        if (!code) continue;
        const raw = answerMap.get(`q-${question.id}`);
        if (raw == null) continue;
        const value = String(raw).trim();
        if (!value) continue;
        if (code === 'student.id') studentId = value;
        if (code === 'student.fullName') studentName = value;
      }
    }
  }

  return { studentId, studentName };
}

/** Assessment PDF file name: "{unitCode}_{studentId}_{studentName}.pdf" */
export function buildInstancePdfFileName(input: {
  unitCode: string;
  studentId: string;
  studentName: string;
  instanceId: number;
}): string {
  const parts = [input.unitCode, input.studentId, input.studentName]
    .map(sanitizePdfFilenameSegment)
    .filter(Boolean);
  if (parts.length === 0) return `form-${input.instanceId}.pdf`;
  return `${parts.join('_')}.pdf`;
}

/** SharePoint relative path: optional base folder + unit code folder + file name. */
export function buildSharePointStoragePath(input: {
  baseFolderPath?: string;
  unitCode?: string;
  fileName: string;
}): string {
  const parts: string[] = [];
  const base = String(input.baseFolderPath ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (base) parts.push(base);

  const unitFolder = sanitizeSharePointFolderSegment(String(input.unitCode ?? ''));
  if (unitFolder) parts.push(unitFolder);

  parts.push(input.fileName);
  return parts.join('/');
}
