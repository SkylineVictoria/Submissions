import { pdf } from '@react-pdf/renderer';
import { EnrolmentPdfDocument } from '../components/enrolment/EnrolmentPdfDocument';
import { FALLBACK_COURSE_OPTIONS } from '../constants/enrolmentOptions';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';
import { mergeEnrolmentPayload } from './enrolmentDefaults';
import { registerPdfFonts } from '../utils/fontLoader';

export const ENROLMENT_ATTACHMENT_LABELS: Record<string, string> = {
  'vet.passport': 'Passport',
  'vet.visa': 'Visa',
  'vet.english': 'English results',
  'disability.document': 'Disability support',
  'credit.evidence': 'RPL / credit evidence',
  'oshc.document': 'OSHC',
};

export function attachmentLabel(ref: EnrolmentFileRef): string {
  if (ref.field === 'application_pdf' || ref.section === 'package') return 'Application PDF (legacy)';
  const key = `${ref.section}.${ref.field}`;
  return ENROLMENT_ATTACHMENT_LABELS[key] ?? `${ref.section} — ${ref.field}`;
}

export function attachmentFilesOnly(files: EnrolmentFileRef[]): EnrolmentFileRef[] {
  return files.filter((f) => f.field !== 'application_pdf' && f.section !== 'package');
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export function resolveCourseLabels(courseIds: string[]): string[] {
  return courseIds.map((id) => {
    const hit = FALLBACK_COURSE_OPTIONS.find((c) => c.id === id);
    return hit?.label ?? id;
  });
}

export function enrolmentPdfFilename(
  applicationNo: string | null,
  values: EnrolmentFormValues
): string {
  const slug = applicationNo
    ? safeFilename(applicationNo)
    : safeFilename(
        [values.personal.firstName, values.personal.lastName].filter(Boolean).join('_') || 'application'
      );
  return `${slug}_application_form.pdf`;
}

/** Generate application PDF in the browser (no storage upload). */
export async function generateEnrolmentPdfBlob(
  values: EnrolmentFormValues,
  applicationNo: string | null,
  fileRefs: EnrolmentFileRef[],
  courseLabels?: string[]
): Promise<Blob> {
  await registerPdfFonts();
  const labels =
    courseLabels && courseLabels.length > 0
      ? courseLabels
      : resolveCourseLabels(values.course.courseIds);
  const doc = (
    <EnrolmentPdfDocument
      values={values}
      applicationNo={applicationNo}
      fileRefs={attachmentFilesOnly(fileRefs)}
      courseLabels={labels}
    />
  );
  return pdf(doc).toBlob();
}

export async function downloadEnrolmentPdf(
  values: EnrolmentFormValues,
  applicationNo: string | null,
  fileRefs: EnrolmentFileRef[],
  courseLabels?: string[]
): Promise<void> {
  const blob = await generateEnrolmentPdfBlob(values, applicationNo, fileRefs, courseLabels);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = enrolmentPdfFilename(applicationNo, values);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function valuesFromEnrolmentRow(payload: unknown): EnrolmentFormValues {
  return mergeEnrolmentPayload(payload);
}
