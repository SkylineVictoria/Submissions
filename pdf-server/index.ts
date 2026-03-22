import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { renderAppendixAMatrixHtml } from './appendixAMatrixData.js';

// Load .env from project root (parent of pdf-server)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Allow cross-origin requests (frontend may be on different domain, e.g. Vercel)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Lightweight health check for Render: ping this every 5–14 min to avoid cold starts (e.g. UptimeRobot)
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

interface FormAnswer {
  question_id: number;
  row_id: number | null;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
}

interface FormQuestion {
  id: number;
  section_id: number;
  type: string;
  code: string | null;
  label: string;
  help_text: string | null;
  required: boolean;
  sort_order: number;
  role_visibility: unknown;
  role_editability: unknown;
  pdf_meta: { columns?: string[] } & Record<string, unknown>;
}

interface FormSection {
  id: number;
  step_id: number;
  title: string;
  description: string | null;
  pdf_render_mode: string;
  sort_order: number;
  assessment_task_row_id?: number | null;
}

interface FormQuestionRow {
  id: number;
  question_id: number;
  row_label: string;
  row_help: string | null;
  row_image_url: string | null;
  row_meta?: { instructions?: Record<string, unknown> } | null;
  sort_order: number;
}

interface FormQuestionOption {
  id: number;
  question_id: number;
  value: string;
  label: string;
  sort_order: number;
}

/** Renders signature value: image (data:...) as img, plain text as red italic span. Accepts string or object with signature/imageDataUrl. */
function renderSignatureHtml(val: string | null | undefined | Record<string, unknown>): string {
  let s: string | null = null;
  if (val == null) s = null;
  else if (typeof val === 'string') s = val.trim() || null;
  else if (typeof val === 'object' && !Array.isArray(val)) {
    const v = val as Record<string, unknown>;
    s = String(v.signature ?? v.imageDataUrl ?? v.typedText ?? '').trim() || null;
  }
  if (!s) return '';
  if (s.startsWith('data:')) {
    // Strip whitespace/newlines - they break img src in HTML and prevent PDF rendering
    const clean = s.replace(/\s+/g, '');
    return '<img src="' + clean.replace(/"/g, '&quot;') + '" alt="Signature" style="max-height:36px;max-width:140px" loading="eager" />';
  }
  const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<span style="color:#dc2626;font-style:italic;font-family:serif">' + escaped + '</span>';
}

/** Escapes HTML and converts newlines to <br> so line breaks in question labels display correctly in PDF */
function labelToHtml(s: string | null | undefined): string {
  if (s == null) return '';
  const str = String(s);
  const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped.replace(/\n/g, '<br>');
}

async function getTemplateForInstance(instanceId: number) {
  const { data: instance } = await supabase
    .from('skyline_form_instances')
    .select('*')
    .eq('id', instanceId)
    .single();

  if (!instance) return null;

  const { data: form } = await supabase
    .from('skyline_forms')
    .select('*')
    .eq('id', instance.form_id)
    .single();

  if (!form) return null;

  const { data: steps } = await supabase
    .from('skyline_form_steps')
    .select('*')
    .eq('form_id', instance.form_id)
    .order('sort_order');

  const stepsWithSections: Array<{
    step: { id: number; title: string; subtitle: string | null; sort_order: number };
    sections: Array<{
      section: FormSection;
      questions: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }>;
    }>;
  }> = [];

  for (const step of steps || []) {
    const { data: sections } = await supabase
      .from('skyline_form_sections')
      .select('*')
      .eq('step_id', step.id)
      .order('sort_order');

    const sectionsWithQs: Array<{
      section: FormSection;
      questions: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }>;
    }> = [];

    for (const section of sections || []) {
      const { data: questions } = await supabase
        .from('skyline_form_questions')
        .select('*')
        .eq('section_id', section.id)
        .order('sort_order');

      const questionsWithExtras: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }> = [];

      for (const q of questions || []) {
        const { data: options } = await supabase
          .from('skyline_form_question_options')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order');
        const { data: rows } = await supabase
          .from('skyline_form_question_rows')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order');
        questionsWithExtras.push({
          question: q as FormQuestion,
          options: (options as FormQuestionOption[]) || [],
          rows: (rows as FormQuestionRow[]) || [],
        });
      }
      sectionsWithQs.push({
        section: section as FormSection,
        questions: questionsWithExtras,
      });
    }
    stepsWithSections.push({ step: step as { id: number; title: string; subtitle: string | null; sort_order: number }, sections: sectionsWithQs });
  }

  return { instance: { ...instance, form }, steps: stepsWithSections };
}

async function getTemplateForForm(formId: number) {
  const { data: form } = await supabase
    .from('skyline_forms')
    .select('*')
    .eq('id', formId)
    .single();

  if (!form) return null;

  const { data: steps } = await supabase
    .from('skyline_form_steps')
    .select('*')
    .eq('form_id', formId)
    .order('sort_order');

  const stepsWithSections: Array<{
    step: { id: number; title: string; subtitle: string | null; sort_order: number };
    sections: Array<{
      section: FormSection;
      questions: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }>;
    }>;
  }> = [];

  for (const step of steps || []) {
    const { data: sections } = await supabase
      .from('skyline_form_sections')
      .select('*')
      .eq('step_id', step.id)
      .order('sort_order');

    const sectionsWithQs: Array<{
      section: FormSection;
      questions: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }>;
    }> = [];

    for (const section of sections || []) {
      const { data: questions } = await supabase
        .from('skyline_form_questions')
        .select('*')
        .eq('section_id', section.id)
        .order('sort_order');

      const questionsWithExtras: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }> = [];

      for (const q of questions || []) {
        const { data: options } = await supabase
          .from('skyline_form_question_options')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order');
        const { data: rows } = await supabase
          .from('skyline_form_question_rows')
          .select('*')
          .eq('question_id', q.id)
          .order('sort_order');
        questionsWithExtras.push({
          question: q as FormQuestion,
          options: (options as FormQuestionOption[]) || [],
          rows: (rows as FormQuestionRow[]) || [],
        });
      }
      sectionsWithQs.push({
        section: section as FormSection,
        questions: questionsWithExtras,
      });
    }
    stepsWithSections.push({ step: step as { id: number; title: string; subtitle: string | null; sort_order: number }, sections: sectionsWithQs });
  }

  return { form, steps: stepsWithSections };
}

function getAnswerMap(answers: FormAnswer[]): Map<string, string | number | Record<string, unknown>> {
  const m = new Map<string, string | number | Record<string, unknown>>();
  for (const a of answers) {
    const key = a.row_id === null ? `q-${a.question_id}` : `q-${a.question_id}-${a.row_id}`;
    if (a.value_text != null) m.set(key, a.value_text);
    else if (a.value_number != null) m.set(key, a.value_number);
    else if (a.value_json != null) m.set(key, a.value_json as Record<string, unknown>);
  }
  return m;
}

type GridColumnType = 'question' | 'answer';
type GridHeaderCase = 'original' | 'uppercase' | 'title';
type GridTableColumnMeta = { label: string; type: GridColumnType };

function normalizeGridColumnType(raw: unknown): GridColumnType {
  return String(raw).trim().toLowerCase() === 'question' ? 'question' : 'answer';
}

function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatGridHeader(label: string, headerCase: GridHeaderCase): string {
  if (headerCase === 'uppercase') return label.toUpperCase();
  if (headerCase === 'title') return toTitleCase(label);
  return label;
}

function getGridColumnsMeta(pm: Record<string, unknown>): GridTableColumnMeta[] {
  const rawMeta = pm.columnsMeta;
  if (Array.isArray(rawMeta)) {
    const parsed = rawMeta
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const label = String(e.label ?? '').trim();
        if (!label) return null;
        return { label, type: normalizeGridColumnType(e.type) } as GridTableColumnMeta;
      })
      .filter(Boolean) as GridTableColumnMeta[];
    if (parsed.length > 0) return parsed;
  }

  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : ['Column 1', 'Column 2'];
  const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
  return columns
    .map((c, idx) => {
      const label = String(c ?? '').trim();
      if (!label) return null;
      return { label, type: normalizeGridColumnType(types[idx]) } as GridTableColumnMeta;
    })
    .filter(Boolean) as GridTableColumnMeta[];
}

function heightFromWordLimit(wordLimit: number | null | undefined): number {
  if (!wordLimit || wordLimit < 1) return 96;
  const lines = Math.max(1, Math.ceil(wordLimit / 10));
  return Math.min(3000, Math.max(36, lines * 24));
}

/** Normalize non-breaking spaces to normal spaces so prose wraps naturally in PDF. */
function normalizeNbspProse(s: string): string {
  return String(s || '').replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
}

function buildHtml(data: {
  form: { name: string; version: string | null; unit_code: string | null; header_asset_url: string | null; cover_asset_url?: string | null };
  steps: Array<{
    step: { id: number; title: string; subtitle: string | null };
    sections: Array<{
      section: FormSection;
      questions: Array<{
        question: FormQuestion;
        options: FormQuestionOption[];
        rows: FormQuestionRow[];
      }>;
    }>;
  }>;
  answers: Map<string, string | number | Record<string, unknown>>;
  taskRowsMap?: Map<number, FormQuestionRow>;
  trainerAssessments?: Map<number, string>;
  trainerRowAssessments?: Map<string, string>;
  resultsOffice?: Map<number, { entered_date: string | null; entered_by: string | null }>;
  resultsData?: Map<number, { first_attempt_satisfactory?: string | null; first_attempt_date?: string | null; first_attempt_feedback?: string | null; second_attempt_satisfactory?: string | null; second_attempt_date?: string | null; second_attempt_feedback?: string | null; third_attempt_satisfactory?: string | null; third_attempt_date?: string | null; third_attempt_feedback?: string | null; trainer_name?: string | null; trainer_signature?: string | null; trainer_date?: string | null }>;
  assessmentSummaryData?: Record<string, string | null>;
  role?: 'student' | 'trainer' | 'office';
}): { html: string; unitCode: string; version: string; headerHtml: string } {
  const { form, steps, answers, taskRowsMap = new Map(), trainerAssessments = new Map(), trainerRowAssessments = new Map(), resultsOffice = new Map(), resultsData = new Map(), assessmentSummaryData = {}, role = 'student' } = data;

  const orderedTaskRowIds: number[] = [];
  for (const g of steps) {
    for (const { section: sec, questions: qs } of g.sections) {
      if (sec.pdf_render_mode === 'assessment_tasks') {
        const tq = qs.find((x) => x.question.type === 'grid_table' && x.rows.length > 0);
        if (tq) for (const r of tq.rows) orderedTaskRowIds.push(r.id);
        break;
      }
    }
    if (orderedTaskRowIds.length > 0) break;
  }
  // Header images: crest (shield logo) and text logo
  let crestImg = form.header_asset_url || '';
  let textImg = '';
  const resolveLogoPath = (filename: string) => {
    const dirs = [
      path.join(__dirname, 'public'),           // pdf-server/public (for standalone deploy)
      path.join(__dirname, '..', 'public'),     // project root public (for local/monorepo)
    ];
    for (const dir of dirs) {
      const p = path.join(dir, filename);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  try {
    if (!crestImg) {
      const crestPath = resolveLogoPath('logo-crest.png') ?? resolveLogoPath('logo.png') ?? resolveLogoPath('logo.jpeg') ?? resolveLogoPath('logo.jpg');
      if (crestPath) {
        const buf = fs.readFileSync(crestPath);
        const mime = crestPath.endsWith('.png') ? 'png' : 'jpeg';
        crestImg = `data:image/${mime};base64,${buf.toString('base64')}`;
      } else {
        // Fallback: minimal SVG logo when no image files (e.g. on Render/Railway deploy)
        crestImg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><text x="10" y="55" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#f97316">SKYLINE</text></svg>')}`;
      }
    }
    const textPath = resolveLogoPath('logo-text.png');
    if (textPath) {
      const buf = fs.readFileSync(textPath);
      textImg = `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch (_e) {}

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 190px 15mm 70px 15mm; }
    @page cover { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif; font-size: 12pt; color: #000000; box-sizing: border-box; min-height: 100%; }
    .header { position: fixed; top: 0; left: 15mm; right: 15mm; width: calc(100% - 30mm); z-index: 1000; background: #fff; padding: 16px 0 16px 0; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; border-bottom: 1px solid #9ca3af; box-sizing: border-box; overflow: visible; }
    .header-inner { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; width: 100%; gap: 16px; overflow: visible; }
    .header img { max-height: 110px; max-width: 220px; flex-shrink: 0; }
    .header-address { text-align: right; font-size: 8pt; color: #374151; line-height: 1.35; flex-shrink: 0; overflow: visible; padding-left: 12px; }
    .header-address a { color: #2563eb; text-decoration: underline; }
    .divider { height: 1px; background: #9ca3af; margin: 8px 0 14px 0; }
    h2 { font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif; font-size: 16pt; font-weight: bold; margin: 0 0 12px 0; color: #000000; border-left: 4px solid #9ca3af; padding-left: 8px; }
    h3 { font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif; font-size: 16pt; font-weight: bold; margin: 12px 0 6px 0; color: #000000; }
    .step-page:not(.intro-page) h3 { color: #595959; font-size: 16pt; font-weight: bold; margin: 12px 0 6px 0; }
    .section-table { width: 100%; border-collapse: collapse; font-size: 12pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; margin: 0 0 12px 0; border: 1px solid #000; border-left: 1px solid #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section-table th, .section-table td { border: 1px solid #000; padding: 10px 12px; vertical-align: middle; line-height: 1.35; overflow: visible; }
    .section-table td:first-child, .section-table th:first-child { border-left: 1px solid #000 !important; }
    .section-table tbody tr { page-break-inside: avoid; break-inside: avoid; }
    .sub-section-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 12px; vertical-align: middle; }
    .label-cell { width: 35%; background: #F0F4FA; font-weight: 600; color: #374151; }
    .value-cell { width: 65%; color: #000000; background: #F0F4FA; }
    .section-table .label-cell, .section-table .row-alt .label-cell, .section-table .row-normal .label-cell { background: #fff !important; font-weight: normal; color: #000;font-family:'Calibri','Calibri Light',Arial,sans-serif; }
    .section-table .value-cell, .section-table .row-alt .value-cell, .section-table .row-normal .value-cell { background: #fff !important; color: #000; font-size: 12pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; }
    .row-alt .label-cell { color: #000000; background: #F0F4FA; }
    .row-alt .value-cell { color: #000000; background: #F0F4FA; }
    .row-normal .label-cell, .row-normal .value-cell { background: #F0F4FA; }
    .question { margin: 12px 0; overflow: visible; page-break-inside: avoid; break-inside: avoid; }
    .question-label { font-weight: bold; margin-bottom: 4px; overflow: visible; line-height: 1.4; white-space: pre-line; }
    .decl-heading-bar { font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif; font-size: 16pt; font-weight: bold; margin: 12px 0 6px 0; color: #000000; border-left: 4px solid #9ca3af; padding-left: 8px; }
    .declarations-section { border: 1px solid #000; border-left: 1px solid #000 !important; padding: 12px; background: #fff; margin-bottom: 12px; }
    .declarations-section.declarations-section-no-border { border: none !important; padding: 0; background: transparent; }
    .declarations-section .question { margin: 10px 0; }
    .declarations-section .question:first-child { padding-top: 0; margin-top: 0; }
    .declarations-section .question-label { font-style: italic; font-weight: 500; }
    .declaration-checkbox { display: inline-flex; align-items: flex-start; gap: 10px; }
    .declaration-checkbox .cb { width: 18px; height: 18px; border: 1px solid #d1d5db; border-radius: 3px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #000000; background: #fff; }
    .declaration-checkbox .cb.checked { color: #000000; }
    /* Assessment Submission Method (point 4): flow after Assessment Tasks when there's room; avoid blank page gap */
    .assessment-submission-page { page-break-before: auto; page-break-inside: avoid; }
    .assessment-submission-section { border: 1px solid #000; padding: 12px; background: #fff; margin-bottom: 12px; }
    .assessment-submission-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
    .assessment-submission-item { display: inline-flex; align-items: center; gap: 8px; }
    .assessment-submission-item .cb { width: 18px; height: 18px; border: 1px solid #000; border-radius: 0; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #000000; background: #fff; }
    .assessment-submission-item .cb.checked { background: #000000; color: #fff; }
    .assessment-submission-item .question-label { font-weight: normal; font-style: normal; }
    .assessment-submission-item .cb-inline-input { border: none; border-bottom: 1px solid #333; min-width: 120px; flex: 1; background: transparent; padding: 2px 4px; font-size: 9pt; display: inline-block; }
    .assessment-submission-item.span-full { grid-column: 1 / -1; }
    .assessment-submission-other-block { grid-column: 1 / -1; margin-top: 8px; text-align: center; }
    .assessment-submission-other-block .other-underline { display: block; margin: 0 auto; border: none; border-bottom: 1px solid #333; min-width: 200px; min-height: 18px; background: transparent; }
    .assessment-submission-hint { text-align: center; font-size: 8pt; font-style: italic; color: #6b7280; margin-top: 4px; }
    .reasonable-adjustment-section { border: 1px solid #000; margin-bottom: 12px; }
    .reasonable-adjustment-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 12px; display: flex; align-items: center; gap: 8px; }
    .reasonable-adjustment-arrow { font-size: 10pt; }
    .reasonable-adjustment-body { padding: 12px; background: #fff; }
    .reasonable-adjustment-radio { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .reasonable-adjustment-section .radio-circle { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #4b5563; border-radius: 50%; }
    .reasonable-adjustment-section .radio-circle.filled { background: #000000; border-color: #000000; }
    .reasonable-adjustment-desc { min-height: 48px; white-space: pre-line; }
    .reasonable-adjustment-sig-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .reasonable-adjustment-sig-label { font-weight: 600; }
    .reasonable-adjustment-sig-line { flex: 1; min-width: 120px; border-bottom: 1px solid #333; min-height: 20px; }
    .reasonable-adjustment-date-label { margin-left: 24px; font-weight: 600; }
    .reasonable-adjustment-date-line { flex: 1; min-width: 80px; border-bottom: 1px solid #333; min-height: 20px; }
    /* Appendix A - Reasonable Adjustments (full layout). Negative margin cancels step-page padding (24px) so Appendix A/B align with Assessment Summary / continued content. */
    .appendix-a-page { page-break-before: always; padding-top: 0; margin-top: -24px; }
    .appendix-b-page { page-break-before: always; padding-top: 0; margin-top: -24px; page-break-inside: auto; }
    /* Keep Appendix B header content and Table A together */
    .appendix-b-content-wrapper { page-break-inside: avoid; orphans: 3; widows: 3; }
    .appendix-b-table-a-wrapper { page-break-before: avoid !important; page-break-after: avoid; page-break-inside: avoid; orphans: 3; widows: 3; }
    .appendix-b-table-b-wrapper { page-break-before: always !important; page-break-inside: avoid; }
    .appendix-b-table-c-wrapper { page-break-before: always !important; page-break-inside: avoid; }
    .learner-eval-grey-bar { width: 100%; height: 40px; background: #595959 !important; margin-top: 20px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .appendix-a-title-bar { background: #595959 !important; color: #ffffff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 12px; margin: 0 0 8px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .appendix-section-bar { background: #595959 !important; color: #ffffff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 8px 12px; margin: 12px 0 6px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .appendix-matrix-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 0 0 10px 0; border: 1px solid #000; }
    .appendix-matrix-table th, .appendix-matrix-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: top; line-height: 1.3; }
    .appendix-matrix-table th { background: #595959 !important; color: #ffffff !important; font-weight: bold; }
    .appendix-matrix-table .appendix-cb { width: 10px; height: 10px; border: 1px solid #000; border-radius: 0; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; color: #000000; background: #fff; margin-right: 6px; vertical-align: middle; }
    .appendix-matrix-table .appendix-cb.checked { background: #000000; color: #fff; }
    .appendix-matrix-table .appendix-cell-item { display: flex; align-items: flex-start; gap: 4px; margin: 2px 0; }
    .appendix-declaration-box { border: 1px solid #333; padding: 12px; font-style: italic; margin: 12px 0; line-height: 1.4; background: #fff; }
    .appendix-footer-bar { font-size: 8pt; color: #374151; margin-bottom: 8px; padding: 6px 12px; background: #d9d9d9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .task-instructions-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 12px 16px; margin: 16px 0 0 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; max-width: 100%; box-sizing: border-box; page-break-after: avoid; break-after: avoid; }
    .task-questions-page { page-break-before: always; }
    .task-questions-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 12px 16px; margin: 16px 0 0 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-after: avoid; break-after: avoid; }
    .task-questions-subheader { font-size: 12pt; color: #000; margin: 0 0 12px 0; padding: 0; background: transparent !important; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; page-break-after: avoid; break-after: avoid; }
    .task-questions-instruction-label { font-size: 12pt; color: #000000; margin: 0 0 8px 0; padding: 0; background: transparent !important; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; }
    .task-instructions-student-label { font-size: 12pt; font-weight: bold; color: #000000; margin: 8px 0 4px 0; padding: 0; background: transparent !important; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; }
    .task-instructions-subheader { font-size: 12pt; color: #000000; margin: 0 0 8px 0; padding: 0; background: transparent !important; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; max-width: 100%; }
    .task-instructions-block { margin: 12px 0; max-width: 100%; box-sizing: border-box; }
    .task-instructions-block-title { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 8px 12px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; max-width: 100%; box-sizing: border-box; page-break-after: avoid; break-after: avoid; }
    .task-instructions-block-content { padding: 12px; background: transparent !important; border: 1px solid #e5e7eb; border-top: none; line-height: 1.5; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; max-width: 100%; box-sizing: border-box; }
    .task-instructions-block-content ul, .task-instructions-block-content li, .task-instructions-block-content p { overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; }
    .task-instructions-block-content ul { margin: 8px 0; padding-left: 20px; }
    .task-instructions-block-content p { margin: 6px 0; }
    .task-instructions-table { width: 100%; table-layout: fixed; border: 1px solid #000; border-collapse: collapse; }
    .task-instructions-table thead { display: table-header-group; }
    .task-instructions-table thead tr { page-break-after: avoid; break-after: avoid; }
    .task-instructions-table td, .task-instructions-table th { vertical-align: top; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; }
    .task-instructions-table .value-cell { min-width: 0; max-width: 100%; box-sizing: border-box; word-break: normal; overflow-wrap: normal; word-wrap: normal; hyphens: none; overflow: visible; text-align: left; }
    .task-instructions-table .label-cell { width: 24% !important; }
    .task-instructions-table td:last-child { border-right: 1px solid #000 !important; }
    /* Assessment Instructions: pasted rich-text sometimes carries inline nowrap/pre/hidden styles
       which prevents normal wrapping and can clip at the right edge. Override only within the TABLE value cell. */
    .task-instructions-table td.value-cell [style*="white-space: nowrap"],
    .task-instructions-table td.value-cell [style*="white-space: pre-wrap"],
    .task-instructions-table td.value-cell [style*="white-space: pre"],
    .task-instructions-table td.value-cell [style*="white-space: pre-line"] {
      white-space: normal !important;
      overflow: visible !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }
    .task-instructions-table td.value-cell [style*="overflow: hidden"],
    .task-instructions-table td.value-cell [style*="overflow:hidden"] {
      overflow: visible !important;
    }
    .task-instructions-table td.value-cell [style*="width: max-content"],
    .task-instructions-table td.value-cell [style*="width:max-content"] {
      width: auto !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }
    .task-instructions-table td.value-cell [style*="word-break: break-all"],
    .task-instructions-table td.value-cell [style*="word-break: break-word"],
    .task-instructions-table td.value-cell [style*="overflow-wrap: break-word"],
    .task-instructions-table td.value-cell [style*="overflow-wrap:anywhere"],
    .task-instructions-table td.value-cell [style*="word-wrap: break-word"],
    .task-instructions-table td.value-cell [style*="word-wrap:anywhere"],
    .task-instructions-table td.value-cell [style*="hyphens: auto"] {
      word-break: normal !important;
      overflow-wrap: normal !important;
      word-wrap: normal !important;
      hyphens: none !important;
    }
    .task-instructions-wrapper { max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; box-sizing: border-box; }
    .result-sheet-page { page-break-before: always; }
    .result-sheet-main { page-break-inside: avoid; break-inside: avoid; }
    .result-sheet-office { page-break-before: auto; }
    .task-results-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 16px; margin: 0 0 8px 0; page-break-after: avoid; break-after: avoid; }
    .task-results-outcome { margin: 12px 0; }
    .task-results-outcome-title { font-weight: bold; margin-bottom: 6px; }
    .result-sheet-table { width: 100%; border-collapse: collapse; font-size: 12pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; margin: 0 0 12px 0; border: 1px solid #000; }
    .result-sheet-table td { border: 1px solid #000; padding: 10px 12px; vertical-align: top; line-height: 1.35; }
    .result-sheet-table .result-label { width: 25%; background: #595959 !important; color: #ffffff; font-weight: 600; }
    .result-sheet-table .result-label.decl-office-label { background: #fae6d2 !important;color: #000000;}
    .result-sheet-table .result-value { background: #fff !important; color: #000000; }
    .result-sheet-table .answer-line { border: none; border-bottom: 1px solid #333; min-height: 18px; padding: 2px 4px; background: transparent; display: block; }
    .result-sheet-table .answer-line-inline { border: none; border-bottom: 1px solid #333; min-height: 14px; padding: 0 4px 2px; background: transparent; display: inline-block; min-width: 80px; }
    .result-sheet-table .answer-box { border: 1px solid #333; min-height: 24px; padding: 6px 8px; background: #e5e7eb; display: block; white-space: pre-line; }
    .result-sheet-table .answer-box-large { min-height: 60px; background: #fff; }
    .result-sheet-table .result-radio { display: inline-flex; align-items: center; gap: 6px; margin-right: 16px; }
    .result-sheet-table .result-radio .radio-circle { width: 12px; height: 12px; border: 1.5px solid #374151; border-radius: 50%; flex-shrink: 0; }
    .result-sheet-table .result-radio .radio-circle.filled { background: #000000; border-color: #000000; }
    .result-sheet-table .result-value-declaration { padding-bottom: 8px !important; }
    .result-sheet-table .result-value-declaration ul:last-of-type { margin-bottom: 4px !important; }
    .result-sheet-table .result-value-declaration p:last-child { margin-bottom: 0 !important; }
    .assessment-summary-page { page-break-before: always; page-break-after: always; page-break-inside: avoid; break-inside: avoid; }
    .assessment-summary-wrapper { page-break-inside: avoid; break-inside: avoid; }
    .assessment-summary-tables-wrap { page-break-inside: avoid; break-inside: avoid; }
    .assessment-summary-table.assessment-summary-info { page-break-after: avoid; break-after: avoid; margin-bottom: 4px; }
    .assessment-summary-table.assessment-summary-result { page-break-before: avoid; break-before: avoid; margin-bottom: 0; }
    .assessment-summary-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 12px; text-align: center; margin: 0; border: 1px solid #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .assessment-summary-intro { background: #fff !important; color: #374151 !important; font-size: 8pt; padding: 6px 10px; margin: 0; line-height: 1.35; border: 1px solid #000; border-top: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .assessment-summary-intro .intro-main { font-size: 9pt; font-weight: 600; margin-bottom: 4px; }
    .assessment-summary-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 0; border: 1px solid #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .assessment-summary-table th, .assessment-summary-table td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; line-height: 1.2; }
    .assessment-summary-table .summary-label { width: 25%; background: #595959 !important; color: #fff !important; font-weight: 600; }
    .assessment-summary-table tbody tr { page-break-inside: avoid; break-inside: avoid; }
    .assessment-summary-table .summary-value { background: #fff !important; color: #000000; white-space: pre-line; }
    .assessment-summary-table .summary-attempt-value { background: #f3f4f6 !important; color: #000000; }
    .assessment-summary-table .summary-result-header { background: #595959 !important; color: #fff !important; font-weight: bold; text-align: center; }
    .assessment-summary-table .summary-attempt-col { width: 25%; text-align: center; }
    .assessment-summary-table .summary-label.summary-office { background: #fae6d2 !important; color: #000000 !important; }
    .assessment-summary-table .summary-value.summary-office { background: #fae6d2 !important; color: #000000 !important; }
    .assessment-summary-table .summary-date-line { border: none; border-bottom: 1px solid #333; min-height: 12px; padding: 0 2px 1px; background: transparent; display: inline-block; min-width: 60px; font-size: 7pt; }
    .assessment-summary-table .summary-cb { width: 12px; height: 12px; border: 1px solid #000; border-radius: 0; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; color: #000000; background: #fff; }
    .assessment-summary-table .summary-cb.checked { background: #000000; color: #fff; }
    .decl-table { width: 100%; border-collapse: collapse; font-size: 12pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; margin: 0 0 12px 0; border: 1px solid #000; border-left: 1px solid #000 !important; }
    .decl-table td { border: 1px solid #000; padding: 10px 12px; vertical-align: middle; line-height: 1.35; overflow: visible; }
    .decl-table td:first-child { border-left: 1px solid #000 !important; }
    .decl-table .decl-label { width: 35%; background: #d9d9d9; color: #000000;font-weight: bold; }
    .decl-table .decl-value { background: #fff; color: #000000; white-space: pre-line; }
    .decl-table .decl-sig-value { color: #2563eb; font-style: italic; text-decoration: underline; }
    .decl-table .decl-other-header { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 16pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; padding: 10px 12px; vertical-align: middle; }
    .decl-table .decl-office-label { font-style: italic; }
    .decl-sig-heading { font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif; font-size: 16pt; font-weight: bold; margin: 12px 0 6px 0; color: #000000; }
    .decl-sig-inline-block { margin-bottom: 12px; }
    .decl-sig-inline { margin: 10px 0; font-size: 11pt; }
    .decl-sig-inline .decl-sig-label { font-weight: normal; margin-right: 8px; }
    .decl-sig-inline .decl-sig-line { display: inline-block; border: none; border-bottom: 1px solid #000; min-width: 280px; min-height: 18px; background: transparent; vertical-align: bottom; padding: 0 2px 2px 0; }
    .assessment-summary-page .answer-box { min-height: 18px; padding: 4px 6px; font-size: 8pt; }
    .assessment-summary-page .answer-box.answer-box-large { min-height: 40px; }
    .answer-box { border: 1px solid #333; min-height: 24px; padding: 6px 8px; overflow: visible; background: #fff; box-sizing: border-box; overflow-wrap: anywhere; word-break: break-word; white-space: pre-line; }
    .answer-box.answer-box-large { min-height: 80px; }
    table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 12px; }
    th, td { border: 1px solid #000; padding: 10px 12px; vertical-align: middle; line-height: 1.35; overflow: visible; }
    th { background: #595959; color: #fff; font-weight: bold; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tbody tr:nth-child(odd) { background: #fff; }
    .likert-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; margin: 0 0 8px 0; border: 1px solid #000; border-left: 1px solid #000 !important; }
    .likert-table th, .likert-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: middle; line-height: 1.25; overflow: visible; font-size: 11pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; }
    .likert-table th:first-child, .likert-table td:first-child { border-left: 1px solid #000 !important; }
    .likert-header { background: #595959 !important; color: #fff !important; font-weight: bold; }
    .likert-no { width: 4%; text-align: center; font-weight: 600; vertical-align: middle; font-size: 11pt; }
    .likert-criteria { width: 50%; font-weight: 600; vertical-align: middle; font-size: 11pt; word-wrap: break-word; }
    .likert-scale { width: 9.2%; height: 100px; padding: 6px 3px; overflow: visible; font-size: 8pt; box-sizing: border-box; vertical-align: middle; }
    .likert-scale-inner { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 100%; overflow: visible; }
    .likert-scale-inner span { display: inline-block; transform: rotate(-90deg); transform-origin: center center; white-space: normal; line-height: 1.15; text-align: center; }
    .likert-section-row td { background: #595959 !important; color: #fff !important; font-weight: bold; font-size: 11pt; font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; }
    /* Keep likert table and its comments box on same page */
    .likert-table-with-comments { page-break-inside: avoid; }
    .likert-table tbody .likert-no { background: #e5e7eb !important; color: #000000; }
    .likert-table tbody .likert-criteria { background: #e5e7eb !important; color: #000000; }
    .likert-table tbody .row-alt .likert-no { background: #f3f4f6 !important; }
    .likert-table tbody .row-alt .likert-criteria { background: #f3f4f6 !important; }
    .likert-radio { text-align: center; background: #fff !important; }
    .likert-table tbody .row-alt .likert-radio { background: #f9fafb !important; }
    .radio-circle { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #4b5563; border-radius: 50%; }
    .radio-circle.filled { background: #000000; border-color: #000000; }
    .signature-img { max-width: 150px; max-height: 60px; display: block; }
    .grid-table-no-border { width: 100%; table-layout: fixed; }
    .grid-table-no-border th, .grid-table-no-border td { border: 1px solid #000 !important; overflow-wrap: anywhere; word-break: break-word; }
    .grid-table-no-border th { background: #595959 !important; color: #ffffff !important; font-weight: 700; border: 1px solid #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .grid-table-no-border tbody tr { background: transparent !important; }
    .grid-table-no-border .label-cell, .grid-table-no-border .value-cell { background: transparent !important; white-space: pre-line; }
    .grid-table-no-border .sub-section-header { background: transparent !important; color: #000000 !important; border: 1px solid #000 !important; }
    .written-evidence-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 0 0 12px 0; border: 1px solid #000; }
    .written-evidence-table th, .written-evidence-table td { border: 1px solid #000; padding: 8px 10px; vertical-align: middle; line-height: 1.25; color: #000; }
    .written-evidence-table th { background: #595959 !important; color: #fff !important; font-weight: 700; text-align: center; }
    .written-evidence-table thead { display: table-header-group; }
    .written-evidence-table thead tr { page-break-after: avoid; break-after: avoid; }
    .written-evidence-table .we-left { text-align: left; }
    .written-evidence-table .we-index { width: 28px; text-align: center; }
    .written-evidence-table .we-yn { width: 56px; text-align: center; }
    .written-evidence-table .we-radio { display: inline-flex; align-items: center; justify-content: center; }
    .written-evidence-table .we-radio .radio-circle { width: 12px; height: 12px; border: 1.5px solid #374151; border-radius: 50%; display: inline-block; }
    .written-evidence-table .we-radio .radio-circle.filled { background: #000; border-color: #000; }
    .written-evidence-wrapper { page-break-inside: avoid; break-inside: avoid; }
    .written-evidence-wrapper .written-evidence-checklist-heading { page-break-after: avoid; break-after: avoid; margin: 0 0 12px 0; font-size: 11pt; font-weight: 700; }
    .assessment-marking-checklist-wrapper { page-break-inside: avoid; break-inside: avoid; margin-bottom: 16px; }
    .assessment-marking-checklist-header { text-align: center; font-weight: 700; font-size: 12pt; margin: 0 0 6px 0; }
    .assessment-marking-checklist-subheader { text-align: center; font-weight: 700; font-size: 11pt; margin: 0 0 12px 0; }
    .assessment-marking-meta-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 0 0 12px 0; border: 1px solid #000; }
    .assessment-marking-meta-table td { border: 1px solid #000; padding: 8px 10px; }
    .assessment-marking-meta-table .amc-label { background: #e5e7eb !important; font-weight: 600; width: 35%; }
    .assessment-marking-meta-table .amc-value { background: #fff; }
    .amc-outcome-section { margin-top: 16px; }
    .amc-outcome-header { background: #595959 !important; color: #fff !important; font-weight: 700; text-align: center; padding: 8px 10px; border: 1px solid #000; font-size: 10pt; }
    .amc-outcome-question { font-weight: 700; padding: 8px 10px; border: 1px solid #000; border-top: none; font-size: 10pt; }
    .assessment-marking-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 0; border: 1px solid #000; }
    .assessment-marking-table th, .assessment-marking-table td { border: 1px solid #000; padding: 8px 10px; vertical-align: middle; line-height: 1.25; color: #000; }
    .assessment-marking-table th { background: #595959 !important; color: #fff !important; font-weight: 700; text-align: center; }
    .assessment-marking-table thead { display: table-header-group; }
    .assessment-marking-table thead tr { page-break-after: avoid; break-after: avoid; }
    .assessment-marking-table .amc-criteria { text-align: left; }
    .assessment-marking-table .amc-index { width: 28px; text-align: center; }
    .assessment-marking-table .amc-yn { width: 56px; text-align: center; }
    .assessment-marking-table .amc-radio { display: inline-flex; align-items: center; justify-content: center; }
    .assessment-marking-table .amc-radio .radio-circle { width: 12px; height: 12px; border: 1.5px solid #374151; border-radius: 50%; display: inline-block; }
    .assessment-marking-table .amc-radio .radio-circle.filled { background: #000; border-color: #000; }
    .task-q-question-box { border: 1px solid #595959; margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid; }
    .task-q-question-box.task-q-first-question { page-break-before: avoid; break-before: avoid; }
    .task-q-question-box:last-child { margin-bottom: 0; }
    .task-q-question-box .task-questions-table th,
    .task-q-question-box .task-questions-table td,
    .task-q-question-box .task-questions-table .task-q-inner-table th,
    .task-q-question-box .task-questions-table .task-q-inner-table td { border-color: #595959 !important; }
    .task-questions-table { border: none !important; margin: 0 !important; }
    .task-q-question-box .task-questions-table .task-q-num-cell { border: 1px solid #000 !important; border-color: #000 !important; }
    .task-q-question-box .task-questions-table .task-q-satisfactory-cell { border: 1px solid #000 !important; border-left: none !important; border-color: #000 !important; }
    .task-questions-table .task-q-num-cell { background: #fff !important; padding: 24px 12px 12px 12px !important; vertical-align: top !important; font-weight: bold; font-size: 11pt; width: 5%; }
    .task-q-question-box .task-questions-table .task-q-question-cell,
    .task-q-question-box .task-questions-table .task-q-question-label-cell,
    .task-q-question-box .task-questions-table .task-q-answer-cell { border: 1px solid #000 !important; border-left: none !important; border-color: #000 !important; }
    .task-questions-table .task-q-question-cell,
    .task-questions-table .task-q-question-label-cell,
    .task-questions-table .task-q-answer-cell { background: #fff !important; padding: 24px 12px 12px 12px !important; vertical-align: top !important; }
    .task-questions-table .task-q-cell-lower { padding: 12px !important; vertical-align: top !important; }
    .task-questions-table .task-q-answer-cell .task-q-answer-block { border-top: none !important; }
    .task-questions-table .task-q-answer-full { border-left: 1px solid #000 !important; width: 100%; }
    .task-questions-table .task-q-question-label { font-weight: bold; font-size: 11pt; margin-bottom: 8px; color: #000; white-space: pre-line; }
    .task-q-text-above-header { font-weight: bold; font-size: 11pt; margin-bottom: 8px; color: #000; }
    .task-q-content-block, .task-q-additional-grid { width: 100%; max-width: 100%; box-sizing: border-box; }
    .task-q-additional-grid table { min-width: 0; width: 100% !important; table-layout: fixed !important; }
    .task-questions-table .task-q-satisfactory-cell { background: #fff !important; padding: 24px 12px 12px 12px !important; vertical-align: top !important; text-align: center; width: 25%; }
    .task-questions-table .task-q-satisfactory-header { font-weight: bold; font-size: 10pt; margin-bottom: 8px; }
    .task-questions-table .task-q-satisfactory-cell .task-q-radio-group { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 16px; }
    .task-questions-table .task-q-radio { display: inline-flex; align-items: center; gap: 6px; }
    .task-questions-table .task-q-radio .radio-circle { width: 12px; height: 12px; border: 1.5px solid #374151; border-radius: 50%; flex-shrink: 0; }
    .task-questions-table .task-q-radio .radio-circle.filled { background: #000; border-color: #000; }
    .grid-status-yn-wrap { display: inline-flex !important; flex-direction: row !important; align-items: center !important; justify-content: center !important; gap: 6px !important; white-space: nowrap !important; font-size: 9px !important; font-family: Arial, sans-serif !important; }
    .grid-status-cb { width: 10px !important; height: 10px !important; min-width: 10px !important; min-height: 10px !important; border: 1px solid #000 !important; border-radius: 2px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; font-size: 8px !important; line-height: 1 !important; color: #000 !important; background: #fff !important; }
    .grid-status-cb.checked { background: #000 !important; color: #fff !important; }
    .task-q-satisfactory-top-right { position: absolute; top: 4px; right: 8px; font-size: 15pt; font-weight: 600; white-space: nowrap; }
    .task-q-satisfactory-top-right .grid-status-cb { width: 16px !important; height: 16px !important; min-width: 16px !important; min-height: 16px !important; font-size: 11px !important; }
    .task-q-satisfactory-above { display: block; padding: 8px 12px; margin: 0 0 10px 0; text-align: right; font-size: 10pt; font-weight: 600; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    .task-q-satisfactory-above .grid-status-cb { width: 14px !important; height: 14px !important; min-width: 14px !important; min-height: 14px !important; font-size: 10px !important; }
    .task-q-answer-block { padding: 12px; min-height: 36px; font-size: 11pt; background: #fff; box-sizing: border-box; overflow-wrap: anywhere; word-break: break-word; white-space: pre-line; }
    .task-q-answer-block.task-q-answer-large { min-height: 96px; }
    .task-questions-table .task-q-inner-table th, .task-questions-table .task-q-inner-table td,
    .task-questions-table .task-q-inner-table .label-cell, .task-questions-table .task-q-inner-table .value-cell { background: transparent !important; border: 1px solid #595959 !important; color: #000000; white-space: pre-line; }
    .task-questions-table .task-q-inner-table th { background: #595959 !important; color: #ffffff !important; font-weight: 700; border: 1px solid #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .task-questions-table .label-cell, .task-questions-table .value-cell, .task-questions-table td { background: #fff !important; }
    .step-page { page-break-after: always; }
    .task-q-question-box.page-break-after { page-break-after: always; }
    .section-table, .likert-table, .assessment-tasks-table { page-break-inside: auto; }
    .decl-table, .result-sheet-table, .assessment-summary-table { page-break-inside: avoid; }
    .step-page:first-child { padding-top: 20px; }
    .step-page:not(:first-child) { padding-top: 24px; }
    .intro-page h2.intro-title { color: #595959; font-size: 24pt; font-weight: bold; font-family:'Calibri','Calibri Light',Arial,sans-serif; margin: 0 0 16px 0; border-left: none; padding-left: 0; }
    .intro-page h3 { color: #595959; font-weight: normal; font-size: 24pt; font-family:'Calibri','Calibri Light',Arial,sans-serif; margin: 16px 0 8px 0; }
    .intro-page h4 { font-weight: bold;font-size: 11pt;font-family:'Calibri','Calibri Light',Arial,sans-serif; margin: 12px 0 6px 0; color: #000000; }
    .intro-page p { margin: 0 0 12px 0; line-height: 1.5; }
    .intro-page ul { margin: 0 0 12px 0; padding-left: 20px; }
    .intro-page li { margin-bottom: 6px; line-height: 1.5; }
    .step-page:last-child { page-break-after: auto; }
    /* Prevent awkward breaks that could push content into footer */
    p, .intro-page p, .declarations-section { orphans: 2; widows: 2; }
    /* COVER PAGE ONLY */
    .cover-page{
      page: cover;
      position: relative;
      z-index: 1001;
      width: 100%;
      min-height: 297mm;
      height: 297mm;
      page-break-after: always;
      overflow: hidden;
      background: #b0b8c0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      margin: 0;
    }

    /* hero image area */
    .cover-image{
      position:absolute;
      top:0; left:0; right:0;
      height: 260mm;
      background-size: cover;
      background-position: center;
      background-repeat:no-repeat;
      z-index: 1;
    }

    /* logo on top-left */
    .cover-logo{
      position:absolute;
      top: 12mm;
      left: 12mm;
      z-index: 6;
    }
    .cover-logo img{
      max-height: 85px;
      max-width: 150px;
      display:block;
    }

    /* STUDENT WORKBOOK band (overlay on image) */
    .cover-band{
      position:absolute;
      left:0; right:0;
      top: 114mm;
      height: 18mm;
      background: #9ca3af;
      border-top: 2px solid #fff;
      border-bottom: 2px solid #fff;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index: 5;
    }
    .cover-band h1{
      margin:0;
      font-size: 22pt;
      font-weight: 800;
      color: #1a3a5c;
      letter-spacing: 0.14em;
    }

    /* WAVE sits ON TOP of image and visually becomes the "cut" */
    .cover-wave{
      position:absolute;
      left:0; right:0;
      top: 155mm;
      height: 55mm;
      z-index: 4;
      pointer-events:none;
    }
    .cover-wave svg{
      width:100%;
      height:100%;
      display:block;
    }

    /* grey area must START EXACTLY at the same top as wave container,
      wave path itself fills grey so there is NO seam line */
    .cover-grey{
      position:absolute;
      left:0; right:0;
      top: 210mm;
      bottom:0;
      background:#b0b8c0;
      z-index: 2;
    }
    /* unit text in grey area - single line, no background on code */
    .cover-unit{
      position:absolute;
      left: 15mm; right: 15mm;
      top: 225mm;
      text-align:center;
      z-index: 7;
    }
    .cover-unit-text{
      font-size: 17pt;
      font-weight: 800;
      color:#fff;
      line-height: 1.2;
    }

    /* student table box */
    .cover-student-box{
      position:absolute;
      left: 15mm; right: 15mm;
      bottom: 18mm;
      background:#fff;
      border: 1px solid #000;
      z-index: 7;
    }
    .cover-student-table{
      width:100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 11pt;
    }
    .cover-student-table td{
      border: 1px solid #000;
      padding: 6px 10px;
      vertical-align: middle;
    }
    .cover-student-label{
      width: 42mm;
      background:#e5e7eb;
      font-weight: 800;
    }
    .cover-student-line{
      display:inline-block;
      width: 100%;
      border-bottom: 1px solid #000;
      min-height: 14px;
    }

  </style>
</head>
<body>
`;

  // Group steps: put Student & Trainer + Qualification & Unit on the same page. Appendix A hidden from students.
  const isAppendixAStep = (s: { title?: string | null }) => /Appendix\s*A/i.test((s.title ?? '').trim());
  const stepsForPdf = role === 'student' ? steps.filter((g) => !isAppendixAStep(g.step)) : steps;
  const isStudentTrainerStep = (s: { title: string }) => /student/i.test(s.title) && /trainer/i.test(s.title);
  const isQualificationStep = (s: { title: string }) => /qualification/i.test(s.title);
  const pageGroups: Array<typeof steps> = [];
  for (let i = 0; i < stepsForPdf.length; i++) {
    const curr = stepsForPdf[i];
    const next = stepsForPdf[i + 1];
    if (next && isStudentTrainerStep(curr.step) && isQualificationStep(next.step)) {
      pageGroups.push([curr, next]);
      i++;
    } else {
      pageGroups.push([curr]);
    }
  }

  const codeToValue = new Map<string, string | number | Record<string, unknown>>();
  for (const g of pageGroups) {
    for (const { sections } of g) {
      for (const { questions } of sections) {
        for (const { question } of questions) {
          if (question.code) {
            const v = answers.get(`q-${question.id}`);
            if (v != null) codeToValue.set(question.code, v);
          }
        }
      }
    }
  }

  const formExt = form as { qualification_code?: string | null; qualification_name?: string | null; unit_name?: string | null };
  if (!codeToValue.has('qualification.code') && formExt.qualification_code) codeToValue.set('qualification.code', formExt.qualification_code);
  if (!codeToValue.has('qualification.name') && formExt.qualification_name) codeToValue.set('qualification.name', formExt.qualification_name);
  if (!codeToValue.has('unit.code') && form.unit_code) codeToValue.set('unit.code', form.unit_code);
  if (!codeToValue.has('unit.name') && formExt.unit_name) codeToValue.set('unit.name', formExt.unit_name);

  const unitCode = String(codeToValue.get('unit.code') ?? form.unit_code ?? '');
  const unitTitle = String(codeToValue.get('unit.name') ?? codeToValue.get('qualification.name') ?? formExt.unit_name ?? formExt.qualification_name ?? '');
  const studentName = String(codeToValue.get('student.fullName') ?? '');
  const studentId = String(codeToValue.get('student.id') ?? '');
  const coverImg = (form as { cover_asset_url?: string | null }).cover_asset_url || '';

  const coverImageStyle = coverImg ? `background-image:url('${coverImg}')` : 'background:linear-gradient(180deg,#5a6a7a 0%,#3d4a5a 100%)';

  const unitText = [unitCode || 'Unit Code', unitTitle || form.name || 'Unit Title'].filter(Boolean).join(' ');

  const headerHtml = `
    <div style="position:relative;width:100%;min-height:165px;box-sizing:border-box;font-family:'Calibri','Calibri Light',Arial,sans-serif;font-weight:400;line-height:1.05;">
      <div style="height:165px;min-height:165px;width:0;overflow:hidden;pointer-events:none;"></div>
      <div style="position:absolute;left:15mm;right:15mm;top:110px;border-top:1px solid #8b95a5;z-index:0;"></div>
      <div style="position:absolute;left:15mm;top:0px;z-index:1;">${crestImg ? `<img src="${crestImg}" alt="Skyline Institute of Technology" style="width:210px;height:165px;object-fit:contain;display:block;" />` : ''}</div>
      <div style="position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:1;">${textImg ? `<img src="${textImg}" alt="SKYLINE INSTITUTE OF TECHNOLOGY" style="height:100px;width:auto;object-fit:contain;display:block;" />` : '<div style="display:flex;flex-direction:column;align-items:center;"><span style="font-size:22pt;font-weight:700;color:#f97316;letter-spacing:2px;">SKYLINE</span><span style="font-size:9pt;font-weight:600;color:#374151;letter-spacing:2px;margin-top:2px;">INSTITUTE OF TECHNOLOGY</span></div>'}</div>
      <div style="position:absolute;right:15mm;top:8px;width:250px;font-size:10pt;font-family:'Calibri','Calibri Light',Arial,sans-serif;color:#374151;text-align:right;line-height:1.25;font-weight:300;z-index:1;">
        Level 8, 310 King Street<br/>Melbourne VIC – 3000<br/>RTO: 45989 CRICOS: 04114B<br/>Email: <a href="mailto:info@slit.edu.au" style="color:#2563eb;text-decoration:underline;">info@slit.edu.au</a><br/>Phone: +61 3 9125 1661
      </div>
    </div>
  `;

  html += `<div class="cover-page">
  <div class="cover-image" style="${coverImageStyle}"></div>

  <div class="cover-logo">
    ${crestImg ? `<img src="${crestImg}" alt="Skyline" />` : ''}
  </div>

  <div class="cover-band"><h1>STUDENT WORKBOOK</h1></div>

  <div class="cover-grey"></div>

  <div class="cover-wave">
    <svg viewBox="0 0 1200 300" preserveAspectRatio="none">
      <path fill="#b0b8c0"
        d="M0,70
          C300,70 350,240 600,230
          C850,240 1150,70 1200,70
          L1200,300 L0,300 Z"/>
      </svg>
  </div>

  <div class="cover-unit">
    <div class="cover-unit-text">${unitText}</div>
  </div>

  <div class="cover-student-box">
    <table class="cover-student-table">
      <tr>
        <td class="cover-student-label">Student Name:</td>
        <td><span class="cover-student-line">${studentName || ''}</span></td>
      </tr>
      <tr>
        <td class="cover-student-label">Student ID:</td>
        <td><span class="cover-student-line">${studentId || ''}</span></td>
      </tr>
    </table>
  </div>
</div>
`;

  // Introduction page (before student details) - shown in every form
  html += `<div class="step-page intro-page">
  <h2 class="intro-title">Student Pack</h2>
  <h3>What is the purpose of this document?</h3>
  <p>The Student Pack is the document you, the student, needs to complete to demonstrate competency. This document includes the context and conditions of your assessment, the tasks to be completed by you and an outline of the evidence to be gathered.</p>
  <h4>The information includes the following:</h4>
  <ul>
    <li>Information related to the unit of competency.</li>
    <li>Guidelines and instructions to complete each task and activity.</li>
    <li>A student evaluation form</li>
  </ul>
  <h4>Student Evaluation Form</h4>
  <p>These documents are designed after conducting thorough industry consultation. Students are encouraged to evaluate this document and provide constructive feedback to their training organisation if they feel that this document can be improved.</p>
  <h4>Link to other unit documents</h4>
  <ul>
    <li>The Student Pack is a document for students to complete to demonstrate their competency. This document includes context and conditions of assessment, tasks to be administered to the student, and an outline of the evidence to be gathered from the student.</li>
    <li>The Unit Mapping is a document that contains information and comprehensive mapping with the training package requirements.</li>
  </ul>
</div>
`;

  const formHasAppendixA = steps.some((g) => /Appendix\s*A/i.test((g.step?.title ?? '').trim()));
  let headerNum = 1;
  for (const group of pageGroups) {
    html += `<div class="step-page">`;
    for (const { step, sections } of group) {
      const isLearnerEvaluation = (step?.title || '').trim() === 'Learner Evaluation';
      let learnerEvalIntroShown = false;
      const learnerEvalLikertSections = isLearnerEvaluation ? sections.filter(s => s.section.pdf_render_mode === 'likert_table').sort((a, b) => b.section.sort_order - a.section.sort_order) : [];
      const lastLikertSectionId = learnerEvalLikertSections.length > 0 ? learnerEvalLikertSections[0].section.id : null;
      for (const { section, questions } of sections) {
      /* Skip Written Evidence Checklist section entirely when it has no rows - avoids blank header */
      if (questions.some((q) => q.question.code === 'written.evidence.checklist')) {
        const checklistQ = questions.find((q) => q.question.code === 'written.evidence.checklist' && q.question.type === 'single_choice' && q.rows.length > 0);
        if (!checklistQ) continue;
      }
      /* Skip Assessment Marking Checklist when both Evidence and Performance outcome have no rows */
      if (section.pdf_render_mode === 'task_marking_checklist') {
        const evidenceQ = questions.find((q) => q.question.code === 'assessment.marking.evidence_outcome' && q.question.type === 'single_choice');
        const perfQ = questions.find((q) => q.question.code === 'assessment.marking.performance_outcome' && q.question.type === 'single_choice');
        const evidenceRows = evidenceQ?.rows?.length ?? 0;
        const perfRows = perfQ?.rows?.length ?? 0;
        if (evidenceRows === 0 && perfRows === 0) continue;
      }
      if (isLearnerEvaluation && !learnerEvalIntroShown) {
        html += '<div class="appendix-b-page">';
        html += '<div class="appendix-b-content-wrapper">';
        html += '<div class="appendix-a-title-bar" style="text-align:center">Appendix B - Learner Evaluation Form</div>';
        html += '<p style="margin:8px 0;line-height:1.4;font-size:11pt">Please complete this evaluation form as thoroughly as you can, in order for us to continuously improve our training quality. The purpose of the evaluation form is to evaluate the areas below:</p>';
        html += '<ul style="margin:0 0 8px 0;padding-left:20px;line-height:1.4;font-size:11pt">';
        html += '<li>logistics and support</li>';
        html += '<li>facilitation</li>';
        html += '<li>training material</li>';
        html += '<li>assessment</li>';
        html += '</ul>';
        html += '<p style="margin:0 0 10px 0;line-height:1.4;font-size:11pt">Your honest and detailed input is therefore of great value to us, and we appreciate your assistance in completing this evaluation form!</p>';
        learnerEvalIntroShown = true;
      }
      /* Only increment headerNum when we output a visible numbered section. Reasonable Adjustment (Appendix A) has no number; inline Reasonable Adjustment handles its own increment below. */
      /* assessment_submission: wrap label + content so both move to new page together */
      if (section.pdf_render_mode === 'assessment_submission') {
        html += `<div class="assessment-submission-page">`;
        html += `<h3>${headerNum}. ${section.title}</h3>`;
        headerNum++;
        if (section.description) html += `<p>${section.description}</p>`;
      } else if (section.pdf_render_mode !== 'declarations' && section.pdf_render_mode !== 'reasonable_adjustment' && section.pdf_render_mode !== 'task_instructions' && section.pdf_render_mode !== 'task_results' && section.pdf_render_mode !== 'task_questions' && section.pdf_render_mode !== 'task_written_evidence_checklist' && section.pdf_render_mode !== 'task_marking_checklist' && section.pdf_render_mode !== 'assessment_summary' && section.title !== 'Assessment Summary Sheet' && !isLearnerEvaluation && !questions.some((q) => q.question.code === 'written.evidence.checklist')) {
        html += `<h3>${headerNum}. ${section.title}</h3>`;
        headerNum++;
        if (section.description) html += `<p>${section.description}</p>`;
      }

      if (isLearnerEvaluation && section.title === 'Participant Information') {
        html += '<table class="section-table" style="margin-bottom:10px;width:100%"><tbody>';
        const participantQs = questions.filter(q => q.question.type === 'short_text').sort((a, b) => a.question.sort_order - b.question.sort_order);
        const leftQs = participantQs.slice(0, 3);
        const rightQs = participantQs.slice(3, 6);
        const studentFullName = String(codeToValue.get('student.fullName') ?? '');
        const trainerFullName = String(codeToValue.get('trainer.fullName') ?? '');
        for (let i = 0; i < 3; i++) {
          const leftQ = leftQs[i];
          const rightQ = rightQs[i];
          let leftVal = leftQ ? String(answers.get(`q-${leftQ.question.id}`) ?? '') : '';
          let rightVal = rightQ ? String(answers.get(`q-${rightQ.question.id}`) ?? '') : '';
          if (leftQ?.question.code === 'evaluation.studentName' && leftVal.length <= 1 && studentFullName) leftVal = studentFullName;
          if (leftQ?.question.code === 'evaluation.trainerName' && leftVal.length <= 1 && trainerFullName) leftVal = trainerFullName;
          html += '<tr>';
          html += `<td class="label-cell" style="width:25%;background:#595959 !important;color:#fff !important;font-weight:600;border:1px solid #000">${leftQ?.question.label || ''}</td>`;
          html += `<td class="value-cell" style="width:25%;background:#fff;border:1px solid #000">${leftVal}</td>`;
          html += `<td class="label-cell" style="width:25%;background:#595959 !important;color:#fff !important;font-weight:600;border:1px solid #000">${rightQ?.question.label || ''}</td>`;
          html += `<td class="value-cell" style="width:25%;background:#fff;border:1px solid #000">${rightVal}</td>`;
          html += '</tr>';
        }
        html += '</tbody></table>';
      } else if (section.pdf_render_mode === 'likert_table') {
        // For Learner Evaluation: A (sort_order=1) stays with Appendix B header (no break), B (sort_order=2) and C (sort_order=3) each get their own page
        const isSectionA = isLearnerEvaluation && section.sort_order === 1;
        const isSectionB = isLearnerEvaluation && section.sort_order === 2;
        const isSectionC = isLearnerEvaluation && section.sort_order === 3;
        const isLastSection = isLearnerEvaluation && section.id === lastLikertSectionId;
        
        // Structure: content-wrapper contains header + Table A, then Table B and C get separate pages
        if (isSectionA) {
          // Table A stays in content-wrapper - no page break, keep together with header
          html += `<div class="appendix-b-table-a-wrapper" style="margin-bottom:12px;page-break-before:avoid !important;page-break-inside:avoid;">`;
        } else {
          // Table B/C: content-wrapper should already be closed after Table A
          // Determine wrapper class for B and C with explicit page breaks
          let wrapperClass = '';
          let inlineStyle = 'margin-bottom:12px;';
          if (isSectionB) {
            wrapperClass = 'appendix-b-table-b-wrapper';
            inlineStyle += 'page-break-before:always !important;page-break-inside:avoid;';
          } else if (isSectionC) {
            wrapperClass = 'appendix-b-table-c-wrapper';
            inlineStyle += 'page-break-before:always !important;page-break-inside:avoid;';
          }
          html += `<div class="${wrapperClass}" style="${inlineStyle}">`;
        }
        const scaleLabels = ['Strongly<br/>Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly<br/>Agree'];
        html += '<div class="likert-table-with-comments">';
        html += '<table class="likert-table"><thead><tr>';
        html += '<th class="likert-header likert-no">No.</th><th class="likert-header likert-criteria">Criteria/Question</th>';
        for (const lbl of scaleLabels) html += `<th class="likert-header likert-scale"><div class="likert-scale-inner"><span>${lbl}</span></div></th>`;
        html += '</tr><tr class="likert-section-row">';
        const sectionLetter = section.sort_order >= 1 ? String.fromCharCode(64 + section.sort_order) : '';
        const sectionTitleText = sectionLetter ? `${sectionLetter}. ${section.title}` : section.title;
        html += `<td class="likert-no">${sectionLetter}</td><td colspan="6" class="likert-section-title">${sectionTitleText}</td>`;
        html += '</tr></thead><tbody>';
        let rowNum = 1;
        for (const { question, rows } of questions) {
          if (question.type === 'likert_5') {
            for (const row of rows) {
              const key = `q-${question.id}-${row.id}`;
              const val = answers.get(key);
              const sel = val != null ? String(val) : '';
              const rowClass = rowNum % 2 === 0 ? 'row-alt' : 'row-normal';
              html += `<tr class="${rowClass}"><td class="likert-no">${rowNum}</td><td class="likert-criteria">${row.row_label}</td>`;
              for (let i = 1; i <= 5; i++) {
                const filled = sel === String(i);
                html += `<td class="likert-radio"><span class="radio-circle${filled ? ' filled' : ''}"></span></td>`;
              }
              html += '</tr>';
              rowNum++;
            }
          }
        }
        html += '</tbody></table>';
        const commentsQ = questions.find(q => q.question.type === 'long_text' && q.question.code?.includes('Comments'));
        if (commentsQ) {
          const commentsVal = String(answers.get(`q-${commentsQ.question.id}`) ?? '');
          html += `<div class="question" style="margin-top:8px;font-family:'Calibri','Calibri Light',Arial,sans-serif;font-size:11pt"><div class="question-label" style="font-weight:600;margin-bottom:4px">${commentsQ.question.label}</div>`;
          html += `<div class="answer-box answer-box-large" style="min-height:50px;font-size:11pt">${commentsVal}</div></div>`;
        }
        html += '</div>'; // close likert-table-with-comments
        // Add grey bar inside the wrapper for C so it stays on same page
        if (isLastSection) {
          html += '<div class="learner-eval-grey-bar"></div>';
        }
        html += '</div>'; // Close table wrapper
        
        // Close content-wrapper after Table A
        if (isSectionA) {
          html += '</div>'; // Close appendix-b-content-wrapper
        }
      } else if (section.pdf_render_mode === 'grid_table') {
        const pm = (questions[0]?.question?.pdf_meta as Record<string, unknown>) || {};
        const columnsMeta = getGridColumnsMeta(pm);
        const cols = columnsMeta.map((c) => c.label);
        const headerCaseRaw = String(pm.headerCase ?? 'original').toLowerCase();
        const headerCase: GridHeaderCase = headerCaseRaw === 'uppercase' || headerCaseRaw === 'title' ? headerCaseRaw : 'original';
        const layout = (pm.layout as string) || 'no_image';
        const isSplit = layout === 'split' || layout === 'polygon';
        const isNoImage = layout === 'no_image' || layout === 'no_image_no_header';
        const isNoHeader = layout === 'no_image_no_header';
        const noImageIncludeBaseColumns = !isNoImage;
        const firstCol = (pm.firstColumnLabel as string) || (isNoImage ? 'Item' : layout === 'polygon' ? 'Polygon Name' : layout === 'default' ? 'Shape' : 'Name');
        const secondCol = (pm.secondColumnLabel as string) || (isNoImage ? 'Description' : layout === 'polygon' ? 'Polygon Shape' : 'Image');
        const firstQuestionColIndex = columnsMeta.findIndex((c) => c.type === 'question');
        html += '<table class="grid-table-no-border">';
        if (!isNoHeader) {
          html += '<thead><tr>';
          if (isSplit) {
            html += `<th>${formatGridHeader(secondCol, headerCase)}</th>`;
          } else if (isNoImage) {
            if (noImageIncludeBaseColumns) {
              html += `<th>${formatGridHeader(firstCol, headerCase)}</th><th>${formatGridHeader(secondCol, headerCase)}</th>`;
            }
          } else {
            html += `<th>${formatGridHeader(firstCol, headerCase)}</th>`;
          }
          for (const c of cols) html += `<th>${formatGridHeader(c, headerCase)}</th>`;
          html += '</tr></thead>';
        }
        html += '<tbody>';
        for (const { question, rows } of questions) {
          for (const row of rows) {
            const key = `q-${question.id}-${row.id}`;
            const val = answers.get(key) as Record<string, string> | undefined;
            html += '<tr>';
            if (isSplit) {
              html += `<td class="col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
            } else if (isNoImage) {
              if (noImageIncludeBaseColumns) {
                html += `<td class="col-question">${row.row_label}</td>`;
                html += `<td class="col-question">${row.row_help || '—'}</td>`;
              }
            } else {
              html += `<td class="col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
            }
            for (let i = 0; i < cols.length; i++) {
              const colType = columnsMeta[i]?.type === 'question' ? 'question' : 'answer';
              const questionCell = isNoImage && !noImageIncludeBaseColumns && i === firstQuestionColIndex
                ? (row.row_label || row.row_help || '—')
                : (row.row_help || '—');
              const cellVal = colType === 'question' ? questionCell : (val && typeof val === 'object' ? (val[`r${row.id}_c${i}`] || '') : '');
              const cellClass = colType === 'question' ? ' class="col-question"' : '';
              html += `<td${cellClass}>${cellVal}</td>`;
            }
            html += '</tr>';
          }
        }
        html += '</tbody></table>';
      } else if (section.pdf_render_mode === 'assessment_tasks') {
        const taskQuestion = questions.find((q) => q.question.type === 'grid_table' && q.rows.length > 0);
        if (taskQuestion) {
          html += '<table class="section-table assessment-tasks-table">';
          html += '<thead><tr><th class="sub-section-header">Evidence number</th><th class="sub-section-header">Assessment method/ Type of evidence</th></tr></thead><tbody>';
          let rowIdx = 0;
          for (const row of taskQuestion.rows) {
            const rowClass = rowIdx++ % 2 === 0 ? 'row-normal' : 'row-alt';
            const methodText = normalizeNbspProse((row.row_help || '').replace(/\n/g, '<br/>'));
            html += `<tr class="${rowClass}"><td class="label-cell">${row.row_label}</td><td class="value-cell">${methodText}</td></tr>`;
          }
          html += '</tbody></table>';
        }
      } else if (questions.some((q) => q.question.code === 'written.evidence.checklist')) {
        const checklistQ = questions.find((q) => q.question.code === 'written.evidence.checklist' && q.question.type === 'single_choice' && q.rows.length > 0);
        if (checklistQ) {
          const weTitle = section.title || 'Written Evidence Checklist';
          html += '<div class="written-evidence-wrapper">';
          html += `<h3 class="written-evidence-checklist-heading">${weTitle}</h3>`;
          html += '<table class="written-evidence-table">';
          html += '<thead>';
          html += '<tr><th rowspan="2" class="we-index"></th><th rowspan="2" class="we-left">Written Evidence</th><th colspan="2">Submitted</th></tr>';
          html += '<tr><th class="we-yn">Yes</th><th class="we-yn">No</th></tr>';
          html += '</thead><tbody>';
          for (let i = 0; i < checklistQ.rows.length; i++) {
            const row = checklistQ.rows[i];
            const key = `q-${checklistQ.question.id}-${row.id}`;
            const val = String(answers.get(key) ?? '');
            const yes = val === 'yes';
            const no = val === 'no';
            html += '<tr>';
            html += `<td class="we-index">${i + 1}</td>`;
            html += `<td class="we-left">${row.row_label || ''}</td>`;
            html += `<td class="we-yn"><span class="we-radio"><span class="radio-circle${yes ? ' filled' : ''}"></span></span></td>`;
            html += `<td class="we-yn"><span class="we-radio"><span class="radio-circle${no ? ' filled' : ''}"></span></span></td>`;
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }
      } else if (section.pdf_render_mode === 'task_marking_checklist') {
        const evidenceQ = questions.find((q) => q.question.code === 'assessment.marking.evidence_outcome' && q.question.type === 'single_choice' && (q.rows?.length ?? 0) > 0);
        const perfQ = questions.find((q) => q.question.code === 'assessment.marking.performance_outcome' && q.question.type === 'single_choice' && (q.rows?.length ?? 0) > 0);
        if (evidenceQ || perfQ) {
          const rowId = section.assessment_task_row_id;
          const row = rowId ? taskRowsMap.get(rowId) : null;
          const taskLabel = row?.row_label || 'Assessment Task';
          const taskMethod = row?.row_help || '';
          const subheader = taskMethod ? `${taskLabel} – ${taskMethod}` : taskLabel;
          const candidateQ = questions.find((q) => q.question.code === 'assessment.marking.candidateName');
          const assessorQ = questions.find((q) => q.question.code === 'assessment.marking.assessorName');
          const dateQ = questions.find((q) => q.question.code === 'assessment.marking.assessmentDate');
          const candidateVal = candidateQ ? String(answers.get(`q-${candidateQ.question.id}`) ?? '') : '';
          const assessorVal = assessorQ ? String(answers.get(`q-${assessorQ.question.id}`) ?? '') : '';
          const dateVal = dateQ ? String(answers.get(`q-${dateQ.question.id}`) ?? '') : '';
          html += '<div class="assessment-marking-checklist-wrapper">';
          html += '<div class="assessment-marking-checklist-header">ASSESSMENT MARKING CHECKLIST</div>';
          html += `<div class="assessment-marking-checklist-subheader">${labelToHtml(subheader)}</div>`;
          html += '<table class="assessment-marking-meta-table"><tbody>';
          html += `<tr><td class="amc-label">Candidate Name</td><td class="amc-value">${labelToHtml(candidateVal)}</td></tr>`;
          html += `<tr><td class="amc-label">Assessor Name</td><td class="amc-value">${labelToHtml(assessorVal)}</td></tr>`;
          html += `<tr><td class="amc-label">Assessment date/s</td><td class="amc-value">${labelToHtml(dateVal)}</td></tr>`;
          html += '</tbody></table>';
          const renderChecklistTable = (checklistQ: { question: { id: number }; rows: FormQuestionRow[] }, title: string, questionText: string) => {
            if (!checklistQ || !checklistQ.rows?.length) return '';
            let t = `<div class="amc-outcome-section"><div class="amc-outcome-header">${title}</div>`;
            t += `<div class="amc-outcome-question">${labelToHtml(questionText)}</div>`;
            t += '<table class="assessment-marking-table">';
            t += '<thead><tr><th rowspan="2" class="amc-index"></th><th rowspan="2" class="amc-criteria">Criteria</th><th colspan="2">SATISFACTORY</th></tr>';
            t += '<tr><th class="amc-yn">Yes</th><th class="amc-yn">No</th></tr></thead><tbody>';
            for (let i = 0; i < checklistQ.rows.length; i++) {
              const r = checklistQ.rows[i];
              const key = `q-${checklistQ.question.id}-${r.id}`;
              const val = String(answers.get(key) ?? '');
              const yes = val === 'yes';
              const no = val === 'no';
              t += '<tr>';
              t += `<td class="amc-index">${i + 1}</td>`;
              t += `<td class="amc-criteria">${labelToHtml(r.row_label || '')}</td>`;
              t += `<td class="amc-yn"><span class="amc-radio"><span class="radio-circle${yes ? ' filled' : ''}"></span></span></td>`;
              t += `<td class="amc-yn"><span class="amc-radio"><span class="radio-circle${no ? ' filled' : ''}"></span></span></td>`;
              t += '</tr>';
            }
            t += '</tbody></table></div>';
            return t;
          };
          if (evidenceQ) html += renderChecklistTable(evidenceQ, 'EVIDENCE OUTCOME', 'Did the candidate complete and submit the following while being observed?');
          if (perfQ) html += renderChecklistTable(perfQ, 'PERFORMANCE OUTCOME', 'Did the candidate provide answers to the following questions with the required length and breadth consistently applying knowledge of vocational environment?');
          html += '</div>';
        }
      } else if (section.pdf_render_mode === 'assessment_submission') {
        const multiChoice = questions.find((q) => q.question.type === 'multi_choice');
        const otherDescQ = questions.find((q) => q.question.type === 'short_text');
        const otherDescVal = otherDescQ ? String(answers.get(`q-${otherDescQ.question.id}`) ?? '') : '';
        const mcVal = multiChoice ? answers.get(`q-${multiChoice.question.id}`) : undefined;
        const selected = new Set(Array.isArray(mcVal) ? (mcVal as string[]) : []);
        const opts = multiChoice?.options ?? [];
        html += '<div class="assessment-submission-section">';
        html += '<div class="assessment-submission-grid">';
        for (let i = 0; i < opts.length; i++) {
          const opt = opts[i];
          const checked = selected.has(opt.value);
          const isOther = opt.value === 'other';
          const isLms = /lms|learning management/i.test(opt.label);
          const itemClass = 'assessment-submission-item' + (isLms || isOther ? ' span-full' : '');
          html += `<div class="${itemClass}">`;
          html += `<span class="cb ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span>`;
          html += `<span class="question-label">${opt.label}</span>`;
          if (isOther) {
            html += `<span class="cb-inline-input">${otherDescVal}</span>`;
          }
          html += '</div>';
        }
        html += '<div class="assessment-submission-other-block">';
        html += '<div class="other-underline"></div>';
        html += '<div class="assessment-submission-hint">(Please describe here)</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>'; /* close assessment-submission-page */
      } else if (section.pdf_render_mode === 'task_instructions') {
        const rowId = section.assessment_task_row_id;
        const row = rowId ? taskRowsMap.get(rowId) : null;
        const instr = row?.row_meta?.instructions as Record<string, string | string[] | undefined> | undefined;
        const assessmentType = instr?.assessment_type ? String(instr.assessment_type).replace(/<[^>]*>/g, '').trim() || 'Assessment' : 'Assessment';
        html += '<div class="task-instructions-wrapper">';
        html += `<div class="task-instructions-header">${row?.row_label || section.title} – ${assessmentType}</div>`;
        html += `<div class="task-instructions-student-label">Student Instructions</div>`;
        html += `<div class="task-instructions-subheader">Assessment method-based instructions and guidelines: ${normalizeNbspProse(row?.row_help || '')}</div>`;
        if (instr) {
          const customBlocks = Array.isArray((instr as { blocks?: unknown[] }).blocks)
            ? ((instr as { blocks?: Array<{ id?: string; type?: string; heading?: string; content?: string; columnHeaders?: string[]; rows?: Array<{ heading?: string; content?: string; cells?: string[] }> }> }).blocks || [])
            : [];
          if (customBlocks.length > 0) {
            for (const b of customBlocks) {
              const heading = String(b.heading || '').trim();
              if (b.type === 'table') {
                if (heading) html += `<div class="task-instructions-block-title">${heading}</div>`;
                const rows = Array.isArray(b.rows) ? b.rows : [];
                const columnHeaders = Array.isArray(b.columnHeaders) ? b.columnHeaders : [];
                if (rows.length > 0) {
                  html += '<table class="section-table task-instructions-table">';
                  if (columnHeaders.length > 0) {
                    html += '<thead><tr>';
                    for (const h of columnHeaders) {
                      html += `<th class="label-cell" style="font-weight:700;border:1px solid #000;padding:6px 8px;text-align:left">${String(h).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</th>`;
                    }
                    html += '</tr></thead>';
                  }
                  html += '<tbody>';
                  for (const r of rows) {
                    const cells = r.cells;
                    if (Array.isArray(cells) && cells.length > 0) {
                      html += '<tr>';
                      for (const c of cells) {
                        html += `<td class="value-cell" style="border:1px solid #000;padding:6px 8px">${normalizeNbspProse(String(c ?? ''))}</td>`;
                      }
                      html += '</tr>';
                    } else {
                      html += '<tr>';
                      html += `<td class="label-cell" style="width:35%;font-weight:700;border:1px solid #000;padding:6px 8px">${String(r.heading || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
                      html += `<td class="value-cell" style="border:1px solid #000;padding:6px 8px">${normalizeNbspProse(String(r.content || ''))}</td>`;
                      html += '</tr>';
                    }
                  }
                  html += '</tbody></table>';
                }
              } else if (String(b.content || '').replace(/<[^>]*>/g, '').trim()) {
                html += `<div class="task-instructions-block-content">${normalizeNbspProse(String(b.content || ''))}</div>`;
              }
            }
          } else {
          const blocks: { title: string; content: string }[] = [
            { title: 'Assessment type', content: normalizeNbspProse(String(instr.assessment_type || '')) },
            { title: 'Instructions provided to the student:', content: normalizeNbspProse(String(instr.task_description || '')) },
            { title: 'Applicable conditions:', content: normalizeNbspProse(String(instr.applicable_conditions || '')) },
            { title: 'Resubmissions and reattempts:', content: normalizeNbspProse(String(instr.resubmissions || '')) },
            { title: 'Location:', content: normalizeNbspProse(String(instr.location_intro || '')) + (Array.isArray(instr.location_options) ? '<ul><li>' + instr.location_options.map((o: string) => normalizeNbspProse(o)).join('</li><li>') + '</li></ul>' : '') + normalizeNbspProse(String(instr.location_note || '')) },
            { title: 'Instructions for answering the written questions:', content: normalizeNbspProse(String(instr.answering_instructions || '')) },
            { title: 'Purpose of the assessment', content: normalizeNbspProse(String(instr.purpose_intro || '') + String(instr.purpose_bullets || '')) },
          ];
          for (const b of blocks) {
            if (b.content && b.content.replace(/<[^>]*>/g, '').trim()) {
              html += `<div class="task-instructions-block"><div class="task-instructions-block-title">${b.title}</div><div class="task-instructions-block-content">${b.content}</div></div>`;
            }
          }
          if (instr.task_instructions && String(instr.task_instructions).replace(/<[^>]*>/g, '').trim()) {
            html += `<div class="task-instructions-block"><div class="task-instructions-block-title">Task instructions</div><div class="task-instructions-block-content">${normalizeNbspProse(String(instr.task_instructions))}</div></div>`;
          }
          }
        }
        html += '</div>'; /* close task-instructions-wrapper */
      } else if (section.pdf_render_mode === 'task_questions') {
        const rowId = (section as { assessment_task_row_id?: number | null }).assessment_task_row_id;
        const row = rowId ? taskRowsMap.get(rowId) : null;
        const instr = row?.row_meta?.instructions as Record<string, string> | undefined;
        const assessmentType = instr?.assessment_type ? String(instr.assessment_type).replace(/<[^>]*>/g, '').trim() || (row?.row_help || 'Assessment') : (row?.row_help || 'Assessment');
        const taskHeaderTitle = `${row?.row_label || section.title} – ${assessmentType}`;
        const assessmentTaskIndex = rowId && orderedTaskRowIds.length > 0 ? (orderedTaskRowIds.indexOf(rowId) + 1) || 1 : 1;
        const isAssessment2Plus = assessmentTaskIndex >= 2;
        const useTopRightSatisfactory = isAssessment2Plus;
        html += '<div class="task-questions-page">';
        html += `<div class="task-questions-header">${taskHeaderTitle}</div>`;
        html += `<div class="task-questions-subheader">Provide your response to each question in the box below.</div>`;
        headerNum++;
        const renderableQs = questions.filter(
          (q) => q.question.type !== 'instruction_block' && !((q.question.pdf_meta as Record<string, unknown>)?.isAdditionalBlockOf)
        );
        let qNum = 0;
        for (let i = 0; i < renderableQs.length; i++) {
          const { question, rows } = renderableQs[i];
          if (question.type === 'page_break') continue;
          const nextIsPageBreak = renderableQs[i + 1]?.question.type === 'page_break';
          qNum++;
          const sat = trainerAssessments.get(question.id);
          const satYes = sat === 'yes';
          const satNo = sat === 'no';
          const isGridTable = question.type === 'grid_table' && rows.length > 0;
          const isFirstQuestion = qNum === 1;
          const boxClass = 'task-q-question-box' + (isFirstQuestion ? ' task-q-first-question' : '') + (nextIsPageBreak ? ' page-break-after' : '');
          html += `<div class="${boxClass}">`;
          if (useTopRightSatisfactory) {
            html += `<div class="task-q-satisfactory-above"><span style="font-weight:600;margin-right:8px">Satisfactory response:</span><span class="grid-status-cb${satYes ? ' checked' : ''}"></span> Yes <span style="margin-left:12px" class="grid-status-cb${satNo ? ' checked' : ''}"></span> No</div>`;
          }
          if (isAssessment2Plus) {
            html += `<div class="task-q-question-label" style="font-weight:bold;margin-bottom:8px">${labelToHtml(question.label)}</div>`;
            const pmTop = (question.pdf_meta as Record<string, unknown>) || {};
            const textAboveHeader = String(pmTop.textAboveHeader ?? '').trim();
            if (textAboveHeader) html += `<div class="task-q-text-above-header">${labelToHtml(textAboveHeader)}</div>`;
            if (isGridTable) {
              const pm = (question.pdf_meta as Record<string, unknown>) || {};
              const columnsMeta = getGridColumnsMeta(pm);
              const cols = columnsMeta.map((c) => c.label);
              const headerCaseRaw = String(pm.headerCase ?? 'original').toLowerCase();
              const headerCase: GridHeaderCase = headerCaseRaw === 'uppercase' || headerCaseRaw === 'title' ? headerCaseRaw : 'original';
              const layout = (pm.layout as string) || 'no_image';
              const isSplit = layout === 'split' || layout === 'polygon';
              const isNoImage = layout === 'no_image' || layout === 'no_image_no_header';
              const isNoHeader = layout === 'no_image_no_header';
              const noImageIncludeBaseColumns = !isNoImage;
              const firstCol = (pm.firstColumnLabel as string) || (isNoImage ? 'Item' : layout === 'default' ? 'Shape' : 'Name');
              const secondCol = (pm.secondColumnLabel as string) || (isNoImage ? 'Description' : 'Image');
              const firstQuestionColIndex = columnsMeta.findIndex((c) => c.type === 'question');
              const columnWordLimits = (Array.isArray(pm.columnWordLimits) ? pm.columnWordLimits : []).map((v: unknown) => (typeof v === 'number' && v > 0 ? v : null)) as (number | null)[];
              html += '<table class="section-table grid-table-no-border task-q-inner-table">';
              if (!isNoHeader) {
                html += '<thead><tr>';
                if (isSplit) html += `<th>${formatGridHeader(secondCol, headerCase)}</th>`;
                else if (isNoImage && noImageIncludeBaseColumns) html += `<th>${formatGridHeader(firstCol, headerCase)}</th><th>${formatGridHeader(secondCol, headerCase)}</th>`;
                else if (!isNoImage) html += `<th>${formatGridHeader(firstCol, headerCase)}</th>`;
                for (const c of cols) html += `<th>${formatGridHeader(c, headerCase)}</th>`;
                html += '</tr></thead>';
              }
              html += '<tbody>';
              for (const r of rows) {
                const key = `q-${question.id}-${r.id}`;
                const val = answers.get(key) as Record<string, string> | undefined;
                const rowSat = trainerRowAssessments.get(key);
                const rowYes = rowSat === 'yes';
                const rowNo = rowSat === 'no';
                html += '<tr>';
                if (isSplit) {
                  html += `<td class="value-cell col-question">${r.row_image_url ? `<img src="${r.row_image_url}" class="signature-img" alt="" /><br/>${r.row_label}` : r.row_label}</td>`;
                } else if (isNoImage) {
                  if (noImageIncludeBaseColumns) {
                    html += `<td class="label-cell col-question">${r.row_label}</td>`;
                    html += `<td class="value-cell col-question">${r.row_help || '—'}</td>`;
                  }
                } else {
                  html += `<td class="label-cell col-question">${r.row_image_url ? `<img src="${r.row_image_url}" class="signature-img" alt="" /><br/>${r.row_label}` : r.row_label}</td>`;
                }
                for (let ci = 0; ci < cols.length; ci++) {
                  const colType = columnsMeta[ci]?.type === 'question' ? 'question' : 'answer';
                  const questionCell = isNoImage && !noImageIncludeBaseColumns && ci === firstQuestionColIndex
                    ? (r.row_label || r.row_help || '—')
                    : (r.row_help || '—');
                  const cellVal = colType === 'question' ? questionCell : (val && typeof val === 'object' ? (val[`r${r.id}_c${ci}`] || '') : '');
                  const cellClass = colType === 'question' ? 'value-cell col-question' : 'value-cell';
                  const wl = columnWordLimits[ci];
                  const cellStyle = colType === 'answer' && wl ? `min-height:${heightFromWordLimit(wl)}px;max-height:${heightFromWordLimit(wl)}px;height:${heightFromWordLimit(wl)}px;` : '';
                  html += `<td class="${cellClass}"${cellStyle ? ` style="${cellStyle}"` : ''}>${cellVal}</td>`;
                }
                html += '</tr>';
              }
              html += '</tbody></table>';
              if (!useTopRightSatisfactory) html += '<div class="mt-3" style="margin-top:10px"><span style="font-weight:600;margin-right:8px">Satisfactory response:</span><span class="grid-status-cb' + (satYes ? ' checked' : '') + '"></span> Yes <span style="margin-left:12px" class="grid-status-cb' + (satNo ? ' checked' : '') + '"></span> No</div>';
            } else {
              const key = rows[0] ? `q-${question.id}-${rows[0].id}` : `q-${question.id}`;
              const val = answers.get(key);
              const qPm = question.pdf_meta as Record<string, unknown> | undefined;
              const qWordLimit = typeof qPm?.wordLimit === 'number' && qPm.wordLimit > 0 ? qPm.wordLimit : null;
              const blockClass = question.type === 'long_text' ? 'task-q-answer-block task-q-answer-large' : 'task-q-answer-block';
              const blockStyle = qWordLimit ? `min-height:${heightFromWordLimit(qWordLimit)}px;max-height:${heightFromWordLimit(qWordLimit)}px;height:${heightFromWordLimit(qWordLimit)}px;` : '';
              html += `<div class="${blockClass}"${blockStyle ? ` style="${blockStyle}"` : ''}>${val ?? ''}</div>`;
              if (!useTopRightSatisfactory) html += '<div class="mt-3" style="margin-top:10px"><span style="font-weight:600;margin-right:8px">Satisfactory response:</span><span class="grid-status-cb' + (satYes ? ' checked' : '') + '"></span> Yes <span style="margin-left:12px" class="grid-status-cb' + (satNo ? ' checked' : '') + '"></span> No</div>';
            }
            const legacyAb = pmTop?.additionalBlock as Record<string, unknown> | undefined;
            const contentBlocks: Array<{ type: string; content?: string; questionId?: number; headerText?: string }> = Array.isArray(pmTop?.contentBlocks)
              ? (pmTop.contentBlocks as Array<{ type: string; content?: string; questionId?: number; headerText?: string }>)
              : legacyAb ? [{ type: String(legacyAb.type ?? 'instruction_block'), content: legacyAb.content as string, questionId: legacyAb.questionId as number }] : [];
            const blockHeaderHtml = (ht: string | undefined) => (ht ? `<div class="task-q-text-above-header">${labelToHtml(ht)}</div>` : '');
            for (const block of contentBlocks) {
              if (block.type === 'instruction_block' && ((block.content as string) || (block as { imageUrl?: string }).imageUrl)) {
                const blockContent = block.content as string;
                const blockImgUrl = (block as { imageUrl?: string }).imageUrl;
                const blockLayout = (block as { imageLayout?: string }).imageLayout || 'side_by_side';
                const blockPct = Math.max(20, Math.min(80, (block as { imageWidthPercent?: number }).imageWidthPercent || 50));
                const imgTag = blockImgUrl ? `<img src="${blockImgUrl}" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" />` : '';
                let innerHtml = '';
                if (!imgTag) innerHtml = `<div class="task-q-additional-instruction">${blockContent || ''}</div>`;
                else if (blockLayout === 'above') innerHtml = `<div style="margin-bottom:8px">${imgTag}</div><div class="task-q-additional-instruction">${blockContent || ''}</div>`;
                else if (blockLayout === 'below') innerHtml = `<div class="task-q-additional-instruction">${blockContent || ''}</div><div style="margin-top:8px">${imgTag}</div>`;
                else innerHtml = `<div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0"><div class="task-q-additional-instruction">${blockContent || ''}</div></div><div style="width:${blockPct}%;flex-shrink:0">${imgTag}</div></div>`;
                html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}${innerHtml}</div>`;
              } else if ((block.type === 'short_text' || block.type === 'long_text') && block.questionId) {
                const childQ = questions.find((x) => x.question.id === block.questionId);
                if (childQ) {
                  const cq = childQ.question;
                  const key = `q-${cq.id}`;
                  const val = answers.get(key);
                  const cqPm = (cq.pdf_meta as Record<string, unknown>) || {};
                  const qWordLimit = typeof cqPm?.wordLimit === 'number' && cqPm.wordLimit > 0 ? cqPm.wordLimit : null;
                  const blockClass = block.type === 'long_text' ? 'task-q-answer-block task-q-answer-large' : 'task-q-answer-block';
                  const blockStyle = qWordLimit ? `min-height:${heightFromWordLimit(qWordLimit)}px;max-height:${heightFromWordLimit(qWordLimit)}px;height:${heightFromWordLimit(qWordLimit)}px;` : '';
                  const cqImgUrl = cqPm?.imageUrl as string | undefined;
                  const cqLayout = (cqPm?.imageLayout as string) || 'side_by_side';
                  const cqPct = Math.max(20, Math.min(80, (cqPm?.imageWidthPercent as number) || 50));
                  const cqImgTag = cqImgUrl ? `<img src="${cqImgUrl}" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" />` : '';
                  let labelHtml = `<div class="task-q-question-label">${labelToHtml(cq.label)}</div>`;
                  if (cqImgTag) {
                    if (cqLayout === 'above') labelHtml = `<div style="margin-bottom:8px">${cqImgTag}</div>${labelHtml}`;
                    else if (cqLayout === 'below') labelHtml += `<div style="margin-top:8px">${cqImgTag}</div>`;
                    else labelHtml = `<div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0">${labelHtml}</div><div style="width:${cqPct}%;flex-shrink:0">${cqImgTag}</div></div>`;
                  }
                  html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}${labelHtml}<div class="${blockClass}"${blockStyle ? ` style="${blockStyle}"` : ''}>${val ?? ''}</div></div>`;
                }
              } else if (block.type === 'grid_table' && block.questionId) {
                const childQ = questions.find((x) => x.question.id === block.questionId);
                if (childQ) {
                  const { question: cq, rows: cRows } = childQ;
                  const cqSat = trainerAssessments.get(cq.id);
                  const cqSatYes = cqSat === 'yes';
                  const cqSatNo = cqSat === 'no';
                  const cqPm = (cq.pdf_meta as Record<string, unknown>) || {};
                  const cColumnsMeta = getGridColumnsMeta(cqPm);
                  const cCols = cColumnsMeta.map((c) => c.label);
                  const cHeaderCaseRaw = String(cqPm.headerCase ?? 'original').toLowerCase();
                  const cHeaderCase: GridHeaderCase = cHeaderCaseRaw === 'uppercase' || cHeaderCaseRaw === 'title' ? cHeaderCaseRaw : 'original';
                  const cLayout = (cqPm.layout as string) || 'no_image';
                  const cIsSplit = cLayout === 'split' || cLayout === 'polygon';
                  const cIsNoImage = cLayout === 'no_image' || cLayout === 'no_image_no_header';
                  const cNoImageIncludeBaseColumns = !cIsNoImage;
                  const cFirstCol = (cqPm.firstColumnLabel as string) || (cIsNoImage ? 'Item' : cLayout === 'default' ? 'Shape' : 'Name');
                  const cSecondCol = (cqPm.secondColumnLabel as string) || (cIsNoImage ? 'Description' : 'Image');
                  const cFirstQuestionColIndex = cColumnsMeta.findIndex((c) => c.type === 'question');
                  const cColumnWordLimits = (Array.isArray(cqPm.columnWordLimits) ? cqPm.columnWordLimits : []).map((v: unknown) => (typeof v === 'number' && v > 0 ? v : null)) as (number | null)[];
                  html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}`;
                  html += useTopRightSatisfactory
                    ? `<div class="task-q-additional-grid"><div class="task-q-satisfactory-above"><span style="font-weight:600;margin-right:8px">Satisfactory response:</span><span class="grid-status-cb${cqSatYes ? ' checked' : ''}"></span> Yes <span style="margin-left:12px" class="grid-status-cb${cqSatNo ? ' checked' : ''}"></span> No</div><table class="section-table grid-table-no-border task-q-inner-table">`
                    : '<div class="task-q-additional-grid"><table class="section-table grid-table-no-border task-q-inner-table">';
                  if (cLayout !== 'no_image_no_header') {
                    html += '<thead><tr>';
                    if (cIsSplit) html += `<th>${formatGridHeader(cSecondCol, cHeaderCase)}</th>`;
                    else if (cIsNoImage && cNoImageIncludeBaseColumns) html += `<th>${formatGridHeader(cFirstCol, cHeaderCase)}</th><th>${formatGridHeader(cSecondCol, cHeaderCase)}</th>`;
                    else if (!cIsNoImage) html += `<th>${formatGridHeader(cFirstCol, cHeaderCase)}</th>`;
                    for (const c of cCols) html += `<th>${formatGridHeader(c, cHeaderCase)}</th>`;
                    html += '</tr></thead>';
                  }
                  html += '<tbody>';
                  for (const r of cRows) {
                    const key = `q-${cq.id}-${r.id}`;
                    const val = answers.get(key) as Record<string, string> | undefined;
                    const rowSat = trainerRowAssessments.get(key);
                    const rowYes = rowSat === 'yes';
                    const rowNo = rowSat === 'no';
                    html += '<tr>';
                    if (cIsSplit) html += `<td class="value-cell col-question">${r.row_image_url ? `<img src="${r.row_image_url}" class="signature-img" alt="" /><br/>${r.row_label}` : r.row_label}</td>`;
                    else if (cIsNoImage && cNoImageIncludeBaseColumns) { html += `<td class="label-cell col-question">${r.row_label}</td>`;
                      html += `<td class="value-cell col-question">${r.row_help || '—'}</td>`;
                    } else if (!cIsNoImage) html += `<td class="label-cell col-question">${r.row_image_url ? `<img src="${r.row_image_url}" class="signature-img" alt="" /><br/>${r.row_label}` : r.row_label}</td>`;
                    for (let ci = 0; ci < cCols.length; ci++) {
                      const colType = cColumnsMeta[ci]?.type === 'question' ? 'question' : 'answer';
                      const questionCell = cIsNoImage && !cNoImageIncludeBaseColumns && ci === cFirstQuestionColIndex ? (r.row_label || r.row_help || '—') : (r.row_help || '—');
                      const cellVal = colType === 'question' ? questionCell : (val && typeof val === 'object' ? (val[`r${r.id}_c${ci}`] || '') : '');
                      const cellClass = colType === 'question' ? 'value-cell col-question' : 'value-cell';
                      const wl = cColumnWordLimits[ci];
                      const cellStyle = colType === 'answer' && wl ? `min-height:${heightFromWordLimit(wl)}px;max-height:${heightFromWordLimit(wl)}px;height:${heightFromWordLimit(wl)}px;` : '';
                      html += `<td class="${cellClass}"${cellStyle ? ` style="${cellStyle}"` : ''}>${cellVal}</td>`;
                    }
                    html += '</tr>';
                  }
                  if (!useTopRightSatisfactory) {
                    html += '</tbody></table><div class="mt-3" style="margin-top:10px"><span style="font-weight:600;margin-right:8px">Satisfactory response:</span><span class="grid-status-cb' + (cqSatYes ? ' checked' : '') + '"></span> Yes <span style="margin-left:12px" class="grid-status-cb' + (cqSatNo ? ' checked' : '') + '"></span> No</div></div></div>';
                  } else {
                    html += '</tbody></table></div></div>';
                  }
                }
              }
            }
            html += '</div>';
          } else {
          html += '<table class="section-table task-questions-table"><tbody>';
          html += '<tr class="task-q-row-top">';
          html += `<td class="task-q-num-cell">Q${qNum}:</td>`;
          html += '<td class="task-q-question-label-cell">';
          const pmTop = (question.pdf_meta as Record<string, unknown>) || {};
          const textAboveHeader = String(pmTop.textAboveHeader ?? '').trim();
          let labelCellContent = `<div class="task-q-question-label">${labelToHtml(question.label)}</div>` + (textAboveHeader ? `<div class="task-q-text-above-header">${labelToHtml(textAboveHeader)}</div>` : '');
          const qImgUrl = pmTop?.imageUrl as string | undefined;
          const qLayout = (pmTop?.imageLayout as string) || 'side_by_side';
          const qPct = Math.max(20, Math.min(80, (pmTop?.imageWidthPercent as number) || 50));
          if (qImgUrl) {
            const qImgTag = `<img src="${qImgUrl}" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" />`;
            if (qLayout === 'above') labelCellContent = `<div style="margin-bottom:8px">${qImgTag}</div>${labelCellContent}`;
            else if (qLayout === 'below') labelCellContent += `<div style="margin-top:8px">${qImgTag}</div>`;
            else labelCellContent = `<div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0">${labelCellContent}</div><div style="width:${qPct}%;flex-shrink:0">${qImgTag}</div></div>`;
          }
          html += labelCellContent + '</td>';
          html += '<td class="task-q-satisfactory-cell">';
          html += '<div class="task-q-satisfactory-header">Satisfactory response</div>';
          html += '<div class="task-q-radio-group"><div class="task-q-radio"><span class="radio-circle' + (satYes ? ' filled' : '') + '"></span>Yes</div>';
          html += '<div class="task-q-radio"><span class="radio-circle' + (satNo ? ' filled' : '') + '"></span>No</div></div>';
          html += '</td></tr>';
          html += '<tr class="task-q-row-bottom">';
          html += '<td colspan="3" class="task-q-answer-cell task-q-answer-full">';
          if (isGridTable) {
            const pm = (question.pdf_meta as Record<string, unknown>) || {};
            const columnsMeta = getGridColumnsMeta(pm);
            const cols = columnsMeta.map((c) => c.label);
            const headerCaseRaw = String(pm.headerCase ?? 'original').toLowerCase();
            const headerCase: GridHeaderCase = headerCaseRaw === 'uppercase' || headerCaseRaw === 'title' ? headerCaseRaw : 'original';
            const layout = (pm.layout as string) || 'no_image';
            const isSplit = layout === 'split' || layout === 'polygon';
            const isNoImage = layout === 'no_image' || layout === 'no_image_no_header';
            const isNoHeader = layout === 'no_image_no_header';
            const noImageIncludeBaseColumns = !isNoImage;
            const firstCol = (pm.firstColumnLabel as string) || (isNoImage ? 'Item' : layout === 'default' ? 'Shape' : 'Name');
            const secondCol = (pm.secondColumnLabel as string) || (isNoImage ? 'Description' : 'Image');
            const firstQuestionColIndex = columnsMeta.findIndex((c) => c.type === 'question');
            const columnWordLimits = (Array.isArray(pm.columnWordLimits) ? pm.columnWordLimits : []).map((v: unknown) => (typeof v === 'number' && v > 0 ? v : null)) as (number | null)[];
            html += '<table class="section-table grid-table-no-border task-q-inner-table">';
            if (!isNoHeader) {
              html += '<thead><tr>';
              if (isSplit) {
                html += `<th>${formatGridHeader(secondCol, headerCase)}</th>`;
              } else if (isNoImage) {
                if (noImageIncludeBaseColumns) {
                  html += `<th>${formatGridHeader(firstCol, headerCase)}</th><th>${formatGridHeader(secondCol, headerCase)}</th>`;
                }
              } else {
                html += `<th>${formatGridHeader(firstCol, headerCase)}</th>`;
              }
              for (const c of cols) html += `<th>${formatGridHeader(c, headerCase)}</th>`;
              html += '</tr></thead>';
            }
            html += '<tbody>';
            for (const row of rows) {
              const key = `q-${question.id}-${row.id}`;
              const val = answers.get(key) as Record<string, string> | undefined;
              html += '<tr>';
              if (isSplit) {
                html += `<td class="value-cell col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
              } else if (isNoImage) {
                if (noImageIncludeBaseColumns) {
                  html += `<td class="label-cell col-question">${row.row_label}</td>`;
                  html += `<td class="value-cell col-question">${row.row_help || '—'}</td>`;
                }
              } else {
                html += `<td class="label-cell col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
              }
              for (let i = 0; i < cols.length; i++) {
                const colType = columnsMeta[i]?.type === 'question' ? 'question' : 'answer';
                const questionCell = isNoImage && !noImageIncludeBaseColumns && i === firstQuestionColIndex
                  ? (row.row_label || row.row_help || '—')
                  : (row.row_help || '—');
                const cellVal = colType === 'question' ? questionCell : (val && typeof val === 'object' ? (val[`r${row.id}_c${i}`] || '') : '');
                const cellClass = colType === 'question' ? 'value-cell col-question' : 'value-cell';
                const wl = columnWordLimits[i];
                const cellStyle = colType === 'answer' && wl ? `min-height:${heightFromWordLimit(wl)}px;max-height:${heightFromWordLimit(wl)}px;height:${heightFromWordLimit(wl)}px;` : '';
                html += `<td class="${cellClass}"${cellStyle ? ` style="${cellStyle}"` : ''}>${cellVal}</td>`;
              }
              html += '</tr>';
            }
            html += '</tbody></table>';
          }
          if (!isGridTable) {
            const key = rows[0] ? `q-${question.id}-${rows[0].id}` : `q-${question.id}`;
            const val = answers.get(key);
            const qPm = question.pdf_meta as Record<string, unknown> | undefined;
            const qWordLimit = typeof qPm?.wordLimit === 'number' && qPm.wordLimit > 0 ? qPm.wordLimit : null;
            const blockClass = question.type === 'long_text' ? 'task-q-answer-block task-q-answer-large' : 'task-q-answer-block';
            const blockStyle = qWordLimit ? `min-height:${heightFromWordLimit(qWordLimit)}px;max-height:${heightFromWordLimit(qWordLimit)}px;height:${heightFromWordLimit(qWordLimit)}px;` : '';
            html += `<div class="${blockClass}"${blockStyle ? ` style="${blockStyle}"` : ''}>${val ?? ''}</div>`;
          }
          const legacyAb = pmTop?.additionalBlock as Record<string, unknown> | undefined;
          const contentBlocks: Array<{ type: string; content?: string; questionId?: number; headerText?: string }> = Array.isArray(pmTop?.contentBlocks)
            ? (pmTop.contentBlocks as Array<{ type: string; content?: string; questionId?: number; headerText?: string }>)
            : legacyAb ? [{ type: String(legacyAb.type ?? 'instruction_block'), content: legacyAb.content as string, questionId: legacyAb.questionId as number }] : [];
          const blockHeaderHtml = (ht: string | undefined) => (ht ? `<div class="task-q-text-above-header">${labelToHtml(ht)}</div>` : '');
          for (const block of contentBlocks) {
            if (block.type === 'instruction_block' && ((block.content as string) || (block as { imageUrl?: string }).imageUrl)) {
              const blockContent = block.content as string;
              const blockImgUrl = (block as { imageUrl?: string }).imageUrl;
              const blockLayout = (block as { imageLayout?: string }).imageLayout || 'side_by_side';
              const blockPct = Math.max(20, Math.min(80, (block as { imageWidthPercent?: number }).imageWidthPercent || 50));
              const imgTag = blockImgUrl ? `<img src="${blockImgUrl}" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" />` : '';
              let innerHtml = '';
              if (!imgTag) innerHtml = `<div class="task-q-additional-instruction">${blockContent || ''}</div>`;
              else if (blockLayout === 'above') innerHtml = `<div style="margin-bottom:8px">${imgTag}</div><div class="task-q-additional-instruction">${blockContent || ''}</div>`;
              else if (blockLayout === 'below') innerHtml = `<div class="task-q-additional-instruction">${blockContent || ''}</div><div style="margin-top:8px">${imgTag}</div>`;
              else innerHtml = `<div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0"><div class="task-q-additional-instruction">${blockContent || ''}</div></div><div style="width:${blockPct}%;flex-shrink:0">${imgTag}</div></div>`;
              html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}${innerHtml}</div>`;
              continue;
            }
            if ((block.type === 'short_text' || block.type === 'long_text') && block.questionId) {
              const childQ = questions.find((x) => x.question.id === block.questionId);
              if (childQ) {
                const cq = childQ.question;
                const key = `q-${cq.id}`;
                const val = answers.get(key);
                const cqPm = (cq.pdf_meta as Record<string, unknown>) || {};
                const qWordLimit = typeof cqPm?.wordLimit === 'number' && cqPm.wordLimit > 0 ? cqPm.wordLimit : null;
                const blockClass = block.type === 'long_text' ? 'task-q-answer-block task-q-answer-large' : 'task-q-answer-block';
                const blockStyle = qWordLimit ? `min-height:${heightFromWordLimit(qWordLimit)}px;max-height:${heightFromWordLimit(qWordLimit)}px;height:${heightFromWordLimit(qWordLimit)}px;` : '';
                const cqImgUrl = cqPm?.imageUrl as string | undefined;
                const cqLayout = (cqPm?.imageLayout as string) || 'side_by_side';
                const cqPct = Math.max(20, Math.min(80, (cqPm?.imageWidthPercent as number) || 50));
                const cqImgTag = cqImgUrl ? `<img src="${cqImgUrl}" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" />` : '';
                let labelHtml = `<div class="task-q-question-label">${labelToHtml(cq.label)}</div>`;
                if (cqImgTag) {
                  if (cqLayout === 'above') labelHtml = `<div style="margin-bottom:8px">${cqImgTag}</div>${labelHtml}`;
                  else if (cqLayout === 'below') labelHtml += `<div style="margin-top:8px">${cqImgTag}</div>`;
                  else labelHtml = `<div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0">${labelHtml}</div><div style="width:${cqPct}%;flex-shrink:0">${cqImgTag}</div></div>`;
                }
                html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}${labelHtml}<div class="${blockClass}"${blockStyle ? ` style="${blockStyle}"` : ''}>${val ?? ''}</div></div>`;
              }
              continue;
            }
            if (block.type === 'grid_table' && block.questionId) {
            const childQ = questions.find((x) => x.question.id === block.questionId);
            if (childQ) {
              html += `<div class="task-q-content-block mt-3">${blockHeaderHtml(block.headerText)}`;
              const { question: cq, rows: cRows } = childQ;
              const cqPm = (cq.pdf_meta as Record<string, unknown>) || {};
              const cColumnsMeta = getGridColumnsMeta(cqPm);
              const cCols = cColumnsMeta.map((c) => c.label);
              const cHeaderCaseRaw = String(cqPm.headerCase ?? 'original').toLowerCase();
              const cHeaderCase: GridHeaderCase = cHeaderCaseRaw === 'uppercase' || cHeaderCaseRaw === 'title' ? cHeaderCaseRaw : 'original';
              const cLayout = (cqPm.layout as string) || 'no_image';
              const cIsSplit = cLayout === 'split' || cLayout === 'polygon';
              const cIsNoImage = cLayout === 'no_image' || cLayout === 'no_image_no_header';
              const cNoImageIncludeBaseColumns = !cIsNoImage;
              const cFirstCol = (cqPm.firstColumnLabel as string) || (cIsNoImage ? 'Item' : cLayout === 'default' ? 'Shape' : 'Name');
              const cSecondCol = (cqPm.secondColumnLabel as string) || (cIsNoImage ? 'Description' : 'Image');
              const cFirstQuestionColIndex = cColumnsMeta.findIndex((c) => c.type === 'question');
              const cColumnWordLimits = (Array.isArray(cqPm.columnWordLimits) ? cqPm.columnWordLimits : []).map((v: unknown) => (typeof v === 'number' && v > 0 ? v : null)) as (number | null)[];
              html += '<div class="task-q-additional-grid"><table class="section-table grid-table-no-border task-q-inner-table">';
              if (!(cLayout === 'no_image_no_header')) {
                html += '<thead><tr>';
                if (cIsSplit) html += `<th>${formatGridHeader(cSecondCol, cHeaderCase)}</th>`;
                else if (cIsNoImage && cNoImageIncludeBaseColumns) html += `<th>${formatGridHeader(cFirstCol, cHeaderCase)}</th><th>${formatGridHeader(cSecondCol, cHeaderCase)}</th>`;
                else if (!cIsNoImage) html += `<th>${formatGridHeader(cFirstCol, cHeaderCase)}</th>`;
                for (const c of cCols) html += `<th>${formatGridHeader(c, cHeaderCase)}</th>`;
                html += '</tr></thead>';
              }
              html += '<tbody>';
              for (const row of cRows) {
                const key = `q-${cq.id}-${row.id}`;
                const val = answers.get(key) as Record<string, string> | undefined;
                html += '<tr>';
                if (cIsSplit) {
                  html += `<td class="value-cell col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
                } else if (cIsNoImage) {
                  if (cNoImageIncludeBaseColumns) {
                    html += `<td class="label-cell col-question">${row.row_label}</td>`;
                    html += `<td class="value-cell col-question">${row.row_help || '—'}</td>`;
                  }
                } else {
                  html += `<td class="label-cell col-question">${row.row_image_url ? `<img src="${row.row_image_url}" class="signature-img" alt="" /><br/>${row.row_label}` : row.row_label}</td>`;
                }
                for (let i = 0; i < cCols.length; i++) {
                  const colType = cColumnsMeta[i]?.type === 'question' ? 'question' : 'answer';
                  const questionCell = cIsNoImage && !cNoImageIncludeBaseColumns && i === cFirstQuestionColIndex
                    ? (row.row_label || row.row_help || '—')
                    : (row.row_help || '—');
                  const cellVal = colType === 'question' ? questionCell : (val && typeof val === 'object' ? (val[`r${row.id}_c${i}`] || '') : '');
                  const cellClass = colType === 'question' ? 'value-cell col-question' : 'value-cell';
                  const wl = cColumnWordLimits[i];
                  const cellStyle = colType === 'answer' && wl ? `min-height:${heightFromWordLimit(wl)}px;max-height:${heightFromWordLimit(wl)}px;height:${heightFromWordLimit(wl)}px;` : '';
                  html += `<td class="${cellClass}"${cellStyle ? ` style="${cellStyle}"` : ''}>${cellVal}</td>`;
                }
                html += '</tr>';
              }
              html += '</tbody></table></div></div>';
            }
            }
          }
          html += '</td>';
          html += '</tr>';
          html += '</tbody></table>';
          html += '</div>';
        }
        }
        html += '</div>'; // Close task-questions-page wrapper
      } else if (section.pdf_render_mode === 'task_results') {
        const rowId = section.assessment_task_row_id;
        const row = rowId ? taskRowsMap.get(rowId) : null;
        const taskTitle = row?.row_label || section.title;
        const rd = resultsData.get(section.id);
        const f1s = rd?.first_attempt_satisfactory === 's';
        const f1n = rd?.first_attempt_satisfactory === 'ns';
        const f2s = rd?.second_attempt_satisfactory === 's';
        const f2n = rd?.second_attempt_satisfactory === 'ns';
        const f3s = rd?.third_attempt_satisfactory === 's';
        const f3n = rd?.third_attempt_satisfactory === 'ns';
        const studentNameDisplay = (() => {
          const rn = (rd?.student_name ?? '').trim();
          if (rn.length > 1) return rn;
          const sig = rd?.student_signature;
          if (sig && typeof sig === 'string' && !sig.startsWith('data:')) return sig;
          return String(codeToValue.get('student.fullName') ?? '');
        })();
        const trainerNameDisplay = (() => {
          const rn = (rd?.trainer_name ?? '').trim();
          if (rn.length > 1) return rn;
          const sig = rd?.trainer_signature;
          if (sig && typeof sig === 'string' && !sig.startsWith('data:')) return sig;
          return String(codeToValue.get('trainer.fullName') ?? '');
        })();
        const officeEntry = resultsOffice.get(section.id);
        const officeDate = officeEntry?.entered_date ?? '';
        const officeName = officeEntry?.entered_by ?? '';
        html += `<div class="result-sheet-page"><div class="result-sheet-main"><div class="task-results-header">${taskTitle} – Results Sheet</div>`;
        html += '<table class="result-sheet-table"><tbody>';
        html += '<tr><td class="result-label" rowspan="3">Outcome</td><td class="result-value">';
        html += '<div class="task-results-outcome-title">First attempt:</div>';
        html += '<div>Outcome (make sure to tick the correct checkbox):</div>';
        html += '<div style="margin: 6px 0;"><span class="result-radio"><span class="radio-circle' + (f1s ? ' filled' : '') + '"></span><span class="question-label">Satisfactory (S)</span></span><span class="result-radio"><span class="radio-circle' + (f1n ? ' filled' : '') + '"></span><span class="question-label">Not Satisfactory (NS)</span></span></div>';
        html += '<div style="margin: 8px 0;"><span class="question-label">Date:</span> <span class="answer-line-inline" style="min-width:120px;">' + (rd?.first_attempt_date ?? '') + '</span></div>';
        html += '<div class="question" style="margin: 8px 0;"><span class="question-label">Feedback:</span><div class="answer-box answer-box-large">' + (rd?.first_attempt_feedback ?? '') + '</div></div>';
        html += '</td></tr>';
        html += '<tr><td class="result-value">';
        html += '<div class="task-results-outcome-title">Second attempt:</div>';
        html += '<div>Outcome (make sure to tick the correct checkbox):</div>';
        html += '<div style="margin: 6px 0;"><span class="result-radio"><span class="radio-circle' + (f2s ? ' filled' : '') + '"></span><span class="question-label">Satisfactory (S)</span></span><span class="result-radio"><span class="radio-circle' + (f2n ? ' filled' : '') + '"></span><span class="question-label">Not Satisfactory (NS)</span></span></div>';
        html += '<div style="margin: 8px 0;"><span class="question-label">Date:</span> <span class="answer-line-inline" style="min-width:120px;">' + (rd?.second_attempt_date ?? '') + '</span></div>';
        html += '<div class="question" style="margin: 8px 0;"><span class="question-label">Feedback:</span><div class="answer-box answer-box-large">' + (rd?.second_attempt_feedback ?? '') + '</div></div>';
        html += '</td></tr>';
        html += '<tr><td class="result-value">';
        html += '<div class="task-results-outcome-title">Third attempt:</div>';
        html += '<div>Outcome (make sure to tick the correct checkbox):</div>';
        html += '<div style="margin: 6px 0;"><span class="result-radio"><span class="radio-circle' + (f3s ? ' filled' : '') + '"></span><span class="question-label">Satisfactory (S)</span></span><span class="result-radio"><span class="radio-circle' + (f3n ? ' filled' : '') + '"></span><span class="question-label">Not Satisfactory (NS)</span></span></div>';
        html += '<div style="margin: 8px 0;"><span class="question-label">Date:</span> <span class="answer-line-inline" style="min-width:120px;">' + (rd?.third_attempt_date ?? '') + '</span></div>';
        html += '<div class="question" style="margin: 8px 0;"><span class="question-label">Feedback:</span><div class="answer-box answer-box-large">' + (rd?.third_attempt_feedback ?? '') + '</div></div>';
        html += '</td></tr>';
        html += '<tr><td class="result-label">Student Declaration</td><td class="result-value result-value-declaration">';
        html += '<ul style="margin: 8px 0; padding-left: 20px;"><li>I declare that the answers I have provided are my own work.</li><li>I have kept a copy of all relevant notes and reference material.</li><li>I have provided references for all sources where the information is not my own.</li>';
        html += '<li>For the purposes of assessment, I give the trainer/assessor permission to:<ul style="margin: 4px 0; padding-left: 20px;"><li>i. Reproduce this assessment and provide a copy to another member of the RTO for the purposes of assessment.</li><li>ii. Take steps to authenticate the assessment, including conducting a plagiarism check.</li></ul></li></ul>';
        html += '<p style="margin: 12px 0 4px 0;"><strong>I understand that if I disagree with the assessment outcome, I can appeal the assessment process, and either re-submit additional evidence undertake gap training and or have my submission re-assessed.</strong></p>';
        html += '<p style="margin: 4px 0 0 0;"><strong>All appeal options have been explained to me.</strong></p>';
        html += '</td></tr>';
        html += '<tr><td class="result-label">Student Name</td><td class="result-value">' + studentNameDisplay + '</td></tr>';
        html += '<tr><td class="result-label">Student Signature</td><td class="result-value">' + renderSignatureHtml(rd?.student_signature ?? '') + '</td></tr>';
        html += '<tr><td class="result-label">Trainer/Assessor Name</td><td class="result-value">' + trainerNameDisplay + '</td></tr>';
        html += '<tr><td class="result-label">Trainer/Assessor Signature</td><td class="result-value">' + renderSignatureHtml(rd?.trainer_signature ?? '') + '</td></tr>';
        html += '<tr><td class="result-label">Date</td><td class="result-value">' + (rd?.trainer_date ?? '') + '</td></tr>';
        html += '</tbody></table></div>';
        html += '<div class="result-sheet-office"><table class="result-sheet-table"><tbody>';
        html += '<tr><td class="result-label decl-office-label">Office Use Only</td><td class="result-value">';
        html += 'The outcome of this assessment has been entered into the Student Management System on <span class="answer-line-inline">' + officeDate + '</span> (insert date) by <span class="answer-line-inline">' + officeName + '</span> (insert Name)';
        html += '</td></tr>';
        html += '</tbody></table></div></div>';
      } else if (section.pdf_render_mode === 'assessment_summary' || section.title === 'Assessment Summary Sheet') {
        const taskRowsOrdered: { id: number; row_label: string }[] = [];
        const taskRowToSectionId = new Map<number, number>();
        for (const g of steps) {
          for (const { section: sec, questions } of g.sections) {
            if (sec.pdf_render_mode === 'assessment_tasks') {
              const taskQ = questions.find((q) => q.question.type === 'grid_table' && q.rows.length > 0);
              if (taskQ) for (const r of taskQ.rows) taskRowsOrdered.push({ id: r.id, row_label: r.row_label });
            }
            if (sec.pdf_render_mode === 'task_results' && (sec as { assessment_task_row_id?: number }).assessment_task_row_id) {
              taskRowToSectionId.set((sec as { assessment_task_row_id: number }).assessment_task_row_id, sec.id);
            }
          }
        }
        const sum = assessmentSummaryData || {};
        const studentName = String(codeToValue.get('student.fullName') ?? '');
        const studentId = String(codeToValue.get('student.id') ?? '');
        const unitCodeName = [String(codeToValue.get('unit.code') ?? ''), String(codeToValue.get('unit.name') ?? '')].filter(Boolean).join(' ');
        html += '<div class="assessment-summary-page"><div class="assessment-summary-wrapper">';
        html += '<div class="assessment-summary-header">ASSESSMENT SUMMARY SHEET</div>';
        html += '<div class="assessment-summary-intro"><div class="intro-main">This form is to be completed by the assessor and used as a final record of student competency.</div>';
        html += 'All student submissions including any associated checklists (outlined below) are to be attached to this cover sheet before placing on the student\'s file.<br/>';
        html += 'Student results are not to be entered onto the Student Database unless all relevant paperwork is completed and attached to this form.</div>';
        html += '<div class="assessment-summary-tables-wrap">';
        html += '<table class="assessment-summary-table assessment-summary-info"><tbody>';
        html += '<tr><td class="summary-label" style="width:25%">Student Name:</td><td class="summary-value" colspan="3">' + studentName + '</td></tr>';
        html += '<tr><td class="summary-label">Student ID:</td><td class="summary-value" colspan="3">' + studentId + '</td></tr>';
        html += '<tr><td class="summary-label">Start date:</td><td class="summary-value"><span class="summary-date-line">' + (sum.start_date ?? '') + '</span></td><td class="summary-label" style="text-align:right;width:15%">End Date:</td><td class="summary-value"><span class="summary-date-line">' + (sum.end_date ?? '') + '</span></td></tr>';
        html += '<tr><td class="summary-label">Unit Code & Name:</td><td class="summary-value" colspan="3">' + unitCodeName + '</td></tr>';
        html += '</tbody></table>';
        html += '<table class="assessment-summary-table assessment-summary-result"><thead><tr><th class="summary-label">Please attach the following evidence to this form</th><th colspan="3" class="summary-result-header">Result</th></tr>';
        html += '<tr><th class="summary-label"></th><th class="summary-result-header summary-attempt-col">1st Attempt</th><th class="summary-result-header summary-attempt-col">2nd Attempt</th><th class="summary-result-header summary-attempt-col">3rd Attempt</th></tr></thead><tbody>';
        if (taskRowsOrdered.length === 0) {
          // Default placeholder rows so new forms always show full table structure (match reference image)
          html += '<tr><td class="summary-label">Assessment Task 1</td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td></tr>';
          html += '<tr><td class="summary-label">Assessment Task 2</td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb"></span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line"></span></div></td></tr>';
        }
        for (const tr of taskRowsOrdered) {
          const secId = taskRowToSectionId.get(tr.id);
          const rd = secId ? resultsData.get(secId) : null;
          const f1s = rd?.first_attempt_satisfactory === 's';
          const f1n = rd?.first_attempt_satisfactory === 'ns';
          const f2s = rd?.second_attempt_satisfactory === 's';
          const f2n = rd?.second_attempt_satisfactory === 'ns';
          const f3s = rd?.third_attempt_satisfactory === 's';
          const f3n = rd?.third_attempt_satisfactory === 'ns';
          html += '<tr><td class="summary-label">' + tr.row_label + '</td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f1s ? ' checked' : '') + '">' + (f1s ? '✓' : '') + '</span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f1n ? ' checked' : '') + '">' + (f1n ? '✓' : '') + '</span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line">' + (rd?.first_attempt_date ?? '') + '</span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f2s ? ' checked' : '') + '">' + (f2s ? '✓' : '') + '</span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f2n ? ' checked' : '') + '">' + (f2n ? '✓' : '') + '</span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line">' + (rd?.second_attempt_date ?? '') + '</span></div></td>';
          html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f3s ? ' checked' : '') + '">' + (f3s ? '✓' : '') + '</span> Satisfactory</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (f3n ? ' checked' : '') + '">' + (f3n ? '✓' : '') + '</span> Not Satisfactory</div><div style="margin-top:6px;font-size:8pt">Date: <span class="summary-date-line">' + (rd?.third_attempt_date ?? '') + '</span></div></td></tr>';
        }
        const fc1 = sum.final_attempt_1_result === 'competent';
        const fnc1 = sum.final_attempt_1_result === 'not_yet_competent';
        const fc2 = sum.final_attempt_2_result === 'competent';
        const fnc2 = sum.final_attempt_2_result === 'not_yet_competent';
        const fc3 = sum.final_attempt_3_result === 'competent';
        const fnc3 = sum.final_attempt_3_result === 'not_yet_competent';
        html += '<tr style="border-top:2px solid #000"><td class="summary-label">Final Assessment result for this unit</td>';
        html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fc1 ? ' checked' : '') + '">' + (fc1 ? '✓' : '') + '</span> Competent</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fnc1 ? ' checked' : '') + '">' + (fnc1 ? '✓' : '') + '</span> Not Yet Competent</div></td>';
        html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fc2 ? ' checked' : '') + '">' + (fc2 ? '✓' : '') + '</span> Competent</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fnc2 ? ' checked' : '') + '">' + (fnc2 ? '✓' : '') + '</span> Not Yet Competent</div></td>';
        html += '<td class="summary-attempt-value summary-attempt-col"><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fc3 ? ' checked' : '') + '">' + (fc3 ? '✓' : '') + '</span> Competent</div><div style="margin:2px 0;display:flex;align-items:center;gap:6px"><span class="summary-cb' + (fnc3 ? ' checked' : '') + '">' + (fnc3 ? '✓' : '') + '</span> Not Yet Competent</div></td></tr>';
        html += '<tr><td class="summary-label" style="vertical-align:top"><span style="font-weight:600">Trainer/Assessor Signature</span><div style="font-size:8pt;font-style:italic;margin-top:6px;line-height:1.3">I declare that I have conducted a fair, valid, reliable, and flexible assessment with this student, and I have provided appropriate feedback</div></td><td colspan="3" class="summary-value">';
        html += '<table style="width:100%;border:none;font-size:9pt"><tr><td style="width:33%;border:none;padding:4px 8px 4px 0;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.trainer_sig_1 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.trainer_date_1 ?? '') + '</span></div></td>';
        html += '<td style="width:33%;border:none;padding:4px 8px;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.trainer_sig_2 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.trainer_date_2 ?? '') + '</span></div></td>';
        html += '<td style="width:33%;border:none;padding:4px 0 4px 8px;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.trainer_sig_3 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.trainer_date_3 ?? '') + '</span></div></td></tr></table></td></tr>';
        html += '<tr><td class="summary-label" style="vertical-align:top"><span style="font-weight:600">Student:</span><div style="font-size:8pt;font-style:italic;margin-top:6px;line-height:1.3">I declare that I have been assessed in this unit, and I have been advised of my result. I also am aware of my appeal rights.</div></td><td colspan="3" class="summary-value">';
        html += '<table style="width:100%;border:none;font-size:9pt"><tr><td style="width:33%;border:none;padding:4px 8px 4px 0;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.student_sig_1 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.student_date_1 ?? '') + '</span></div></td>';
        html += '<td style="width:33%;border:none;padding:4px 8px;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.student_sig_2 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.student_date_2 ?? '') + '</span></div></td>';
        html += '<td style="width:33%;border:none;padding:4px 0 4px 8px;vertical-align:top"><div><span style="font-weight:600">Signature:</span></div><div class="summary-date-line" style="min-width:100%;display:block">' + renderSignatureHtml(sum.student_sig_3 ?? '') + '</div><div style="margin-top:4px"><span style="font-weight:600">Date:</span> <span class="summary-date-line">' + (sum.student_date_3 ?? '') + '</span></div></td></tr></table></td></tr>';
        html += '<tr><td class="summary-label">Student overall Feedback:</td><td colspan="3" class="summary-value"><div class="answer-box answer-box-large" style="min-height:50px;background:#fff">' + (sum.student_overall_feedback ?? '') + '</div></td></tr>';
        html += '<tr><td class="summary-label summary-office" colspan="2">Administrative use only - Entered onto Student Management Database</td><td class="summary-label summary-office">Initials</td><td class="summary-value summary-office"><span class="summary-date-line" style="min-width:60px">' + (sum.admin_initials ?? '') + '</span></td></tr>';
        html += '</tbody></table></div></div></div>';
      } else if (section.pdf_render_mode === 'reasonable_adjustment') {
        const stepTitle = (step?.title || '').trim();
        const isAppendixA = /Appendix\s*A/i.test(stepTitle);
        if (isAppendixA && role === 'student') {
          /* Appendix A - Trainer and Office only: skip entire section for students */
        } else if (!isAppendixA && formHasAppendixA) {
          html += `<h3>${headerNum}. Reasonable Adjustment</h3>`;
          headerNum++;
          html += '<p style="margin:0 0 10px 0;line-height:1.5">Reasonable Adjustment: See Appendix A – Reasonable Adjustments for details and to record any adjustments applied.</p>';
        } else {
        const taskQ = isAppendixA
          ? (questions.find((q) => q.question.code === 'reasonable_adjustment_appendix.task') ?? questions.find((q) => q.question.code === 'reasonable_adjustment.task' && q.question.type === 'short_text'))
          : questions.find((q) => q.question.code === 'reasonable_adjustment.task');
        const descQ = isAppendixA
          ? (questions.find((q) => q.question.code === 'reasonable_adjustment_appendix.explanation') ?? questions.find((q) => q.question.code === 'reasonable_adjustment.description'))
          : questions.find((q) => q.question.code === 'reasonable_adjustment.description');
        const matrixQ = isAppendixA ? questions.find((q) => q.question.code === 'reasonable_adjustment_appendix.matrix' || (q.question.pdf_meta as Record<string, unknown>)?.appendixMatrix === true) : null;
        let sigQ = isAppendixA ? questions.find((q) => q.question.code === 'trainer.reasonableAdjustmentAppendixSignature') : questions.find((q) => q.question.type === 'signature');
        if (isAppendixA && !sigQ) sigQ = questions.find((q) => q.question.type === 'signature');
        const yesNoQ = questions.find((q) => q.question.type === 'yes_no');
        const taskVal = taskQ ? String(answers.get(`q-${taskQ.question.id}`) ?? '') : '';
        const descVal = descQ ? String(answers.get(`q-${descQ.question.id}`) ?? '') : '';
        const appliedVal = yesNoQ ? String(answers.get(`q-${yesNoQ.question.id}`) ?? '') : '';
        const yesChecked = appliedVal.toLowerCase() === 'yes' || appliedVal === 'true';
        const noChecked = appliedVal.toLowerCase() === 'no' || appliedVal === 'false' || (!yesChecked && appliedVal !== '');
        let sigVal: string | null = null;
        let dateVal = '';
        let trainerNameVal = String(codeToValue.get('trainer.fullName') ?? '');
        if (sigQ) {
          const v = answers.get(`q-${sigQ.question.id}`);
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const o = v as Record<string, unknown>;
            sigVal = (typeof o.signature === 'string' ? o.signature : null) ?? (typeof o.imageDataUrl === 'string' ? o.imageDataUrl : null) ?? (typeof o.typedText === 'string' ? o.typedText : null);
            dateVal = String(o.date ?? o.signedAtDate ?? '');
            if (o.name != null || o.fullName != null) trainerNameVal = String(o.name ?? o.fullName ?? '');
          } else if (typeof v === 'string' && v) {
            sigVal = v;
          }
        }
        const sigDisplay = renderSignatureHtml(sigVal ?? '');
        if (!isAppendixA) {
          html += `<h3>${headerNum}. Reasonable Adjustment</h3>`;
          headerNum++;
          if (section.description) {
            const desc = section.description;
            const inCaseIdx = desc.search(/In the case that/i);
            const beforeInCase = inCaseIdx >= 0 ? desc.slice(0, inCaseIdx).trim() : desc;
            const inCasePart = inCaseIdx >= 0 ? desc.slice(inCaseIdx).trim() : '';
            if (beforeInCase) html += `<p style="margin:0 0 10px 0;line-height:1.5">${beforeInCase.replace(/\n/g, '<br/>')}</p>`;
            if (inCasePart) html += `<p style="margin:0 0 12px 0;line-height:1.5;font-style:italic">${inCasePart.replace(/\n/g, '<br/>')}</p>`;
          }
          html += '<div class="reasonable-adjustment-section">';
          html += '<div class="reasonable-adjustment-header"><span class="reasonable-adjustment-arrow">&#9654;</span> Reasonable Adjustment</div>';
          html += '<div class="reasonable-adjustment-body">';
          html += `<div class="question"><div class="question-label">${yesNoQ?.question.label || 'Was reasonable adjustment applied to any of these assessment tasks?'}</div>`;
          html += '<div class="reasonable-adjustment-radio"><span class="radio-circle' + (yesChecked ? ' filled' : '') + '"></span> Yes</div>';
          html += '<div class="reasonable-adjustment-radio"><span class="radio-circle' + (noChecked ? ' filled' : '') + '"></span> No</div></div>';
          html += `<div class="question"><div class="question-label">${taskQ?.question.label || 'If yes, which assessment task was this applied to?'}</div><div class="answer-box">${taskVal}</div></div>`;
          html += `<div class="question"><div class="question-label">${descQ?.question.label || 'Provide a description of the adjustment applied and explain reasons.'}</div><div class="answer-box reasonable-adjustment-desc">${descVal}</div></div>`;
          html += '<div class="reasonable-adjustment-sig-row"><span class="reasonable-adjustment-sig-label">Trainer Signature:</span><span class="reasonable-adjustment-sig-line">' + sigDisplay + '</span><span class="reasonable-adjustment-date-label">Date:</span><span class="reasonable-adjustment-date-line">' + dateVal + '</span></div>';
          html += '</div></div>';
        } else {
        html += '<div class="appendix-a-page">';
        html += '<div class="appendix-a-title-bar">Appendix A – Reasonable Adjustments</div>';
        html += '<div class="appendix-section-bar">Write (task name and number) where reasonable adjustments have been applied:</div>';
        html += '<div class="answer-box answer-box-large" style="min-height:60px;margin-bottom:14px">' + (taskVal || '') + '</div>';
        html += '<div class="appendix-section-bar">Reasonable Adjustments</div>';
        html += '<ul style="margin:0 0 12px 0;padding-left:20px;line-height:1.45">';
        html += '<li>Students with carer responsibilities, cultural or religious obligations, English as an additional language, disability etc., can request for reasonable adjustments.</li>';
        html += '<li>Please note, academic standards of the unit/course will not be lowered to accommodate the needs of any student, but there is a requirement to be flexible about the way in which it is delivered or assessed.</li>';
        html += '<li>The Disability Standards for Education requires institutions to take reasonable steps to enable the student with a disability to participate in education on the same basis as a student without a disability.</li>';
        html += '<li>The trainer/assessor must complete the section below "Reasonable Adjustment Strategies Matrix" to ensure the explanation and correct strategy have been recorded and implemented.</li>';
        html += '<li>The trainer/assessor must notify the administration/compliance and quality assurance department for any reasonable adjustments made.</li>';
        html += '<li>All evidence and supplementary documentation must be submitted with the assessment pack to the administration/compliance and quality assurance department.</li>';
        html += '</ul>';
        const matrixVal = matrixQ ? (answers.get(`q-${matrixQ.question.id}`) as Record<string, boolean> | undefined) : undefined;
        const matrixChecked: Record<string, boolean> = matrixVal && typeof matrixVal === 'object' && !Array.isArray(matrixVal) ? matrixVal : {};
        html += renderAppendixAMatrixHtml(matrixChecked);
        html += '<div class="appendix-section-bar">Explanation of reasonable adjustments strategy used</div>';
        html += '<div class="answer-box answer-box-large" style="min-height:100px;margin-bottom:14px">' + (descVal || '') + '</div>';
        const declarationText = 'I declare that I have attached all relevant evidence to provide reasonable adjustment. The training package guidelines and criteria have not been compromised in the process of providing reasonable adjustment to the student. I declare that I have conducted a fair, valid, reliable, and flexible assessment. I have provided explanation of reasonable adjustments strategy used, as required.';
        html += '<table class="decl-table" style="margin-bottom:14px"><tbody>';
        html += '<tr><td class="decl-label" style="width:35%">Trainer/Assessor Name</td><td class="decl-value">' + (trainerNameVal || '') + '</td></tr>';
        html += '<tr><td class="decl-label">Trainer/Assessor Declaration</td><td class="decl-value"><span style="font-style:italic;line-height:1.4">' + declarationText + '</span></td></tr>';
        html += '<tr><td class="decl-label" style="width:35%">Trainer/Assessor Signature</td><td class="decl-value">' + sigDisplay + '</td></tr>';
        html += '<tr><td class="decl-label">Date</td><td class="decl-value">' + (dateVal || '') + '</td></tr>';
        html += '</tbody></table>';
        html += '</div>';
        }
        }
      } else if (section.pdf_render_mode === 'declarations') {
        const sectionTitle = section.title.toLowerCase();
        if (sectionTitle.includes('final declaration')) {
          html += `<div class="decl-heading-bar">${headerNum}. ${section.title}</div>`;
          headerNum++;
          html += '<div class="declarations-section">';
          for (const { question, options } of questions) {
            if (question.type === 'yes_no' || question.type === 'single_choice') {
              const key = `q-${question.id}`;
              const val = answers.get(key);
              const checked = String(val || '').toLowerCase() === 'yes' || String(val || '').toLowerCase() === 'true';
              html += `<div class="question declaration-checkbox"><span class="cb ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span><span class="question-label">${question.label}</span></div>`;
            }
          }
          html += '</div>';
        } else if (sectionTitle.includes('signature')) {
          html += `<div class="decl-heading-bar">${headerNum}. ${section.title}</div>`;
          headerNum++;
          for (const { question } of questions) {
            if (question.type === 'signature') {
              const code = question.code || '';
              const val = answers.get(`q-${question.id}`);
              const pm = (question.pdf_meta as Record<string, unknown>) || {};
              const showName = pm.showNameField !== false;
              const showDate = pm.showDateField !== false;
              let nameVal = '';
              let sigVal: string | null = null;
              let dateVal = '';
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                const o = val as Record<string, unknown>;
                nameVal = String(o.name ?? o.fullName ?? codeToValue.get(code.startsWith('student') ? 'student.fullName' : 'trainer.fullName') ?? '');
                sigVal = (typeof o.signature === 'string' ? o.signature : null) ?? (typeof o.imageDataUrl === 'string' ? o.imageDataUrl : null) ?? (typeof o.typedText === 'string' ? o.typedText : null);
                dateVal = String(o.date ?? o.signedAtDate ?? '');
              } else if (typeof val === 'string' && val) {
                sigVal = val;
                nameVal = String(codeToValue.get(code.startsWith('student') ? 'student.fullName' : 'trainer.fullName') ?? '');
              }
              const isStudent = code.startsWith('student');
              if (isStudent) {
                html += '<div class="decl-sig-inline-block">';
                html += `<div class="decl-sig-inline"><span class="decl-sig-label">${question.label}:</span>${renderSignatureHtml(sigVal ?? '') || '<span class="decl-sig-line"></span>'}</div>`;
                if (showDate) html += `<div class="decl-sig-inline"><span class="decl-sig-label">Date:</span><span class="decl-sig-line">${dateVal || ''}</span></div>`;
                html += '</div>';
              } else {
                const sigDisplay = renderSignatureHtml(sigVal ?? '') || `<span class="decl-sig-value">${nameVal || '-'}</span>`;
                html += `<div class="decl-sig-heading">${question.label}</div>`;
                html += '<table class="decl-table"><tbody>';
                if (showName) html += `<tr><td class="decl-label">Trainer/Assessor Name</td><td class="decl-value">${nameVal || ''}</td></tr>`;
                html += `<tr><td class="decl-label">${question.label}</td><td class="decl-value">${sigDisplay}</td></tr>`;
                if (showDate) html += `<tr><td class="decl-label">Date</td><td class="decl-value">${dateVal || ''}</td></tr>`;
                html += '</tbody></table>';
              }
            }
          }
        } else if (sectionTitle.includes('office')) {
          html += `<div class="decl-heading-bar">${headerNum}. ${section.title}</div>`;
          headerNum++;
          html += '<table class="decl-table"><tbody>';
          html += '<tr><td colspan="2" class="decl-other-header">Other</td></tr>';
          for (const { question } of questions) {
            const key = `q-${question.id}`;
            const val = answers.get(key);
            const label = question.label;
            html += `<tr><td class="decl-label decl-office-label">${label}</td><td class="decl-value">${val ?? ''}</td></tr>`;
          }
          html += '</tbody></table>';
        } else {
          const hasStudentSig = questions.some((q) => q.question.type === 'signature' && (q.question.code || '').startsWith('student'));
          const declSectionClass = hasStudentSig ? 'declarations-section declarations-section-no-border' : 'declarations-section';
          html += `<h3>${headerNum}. ${section.title}</h3>`;
          headerNum++;
          if (section.description) html += `<p class="intro-page" style="margin: 0 0 12px 0; line-height: 1.5;">${(section.description || '').replace(/\n/g, '<br/>')}</p>`;
          html += `<div class="${declSectionClass}">`;
          for (const { question } of questions) {
            if (question.type === 'signature') {
              const code = question.code || '';
              const val = answers.get(`q-${question.id}`);
              const pm = (question.pdf_meta as Record<string, unknown>) || {};
              const showName = pm.showNameField !== false;
              const showDate = pm.showDateField !== false;
              let nameVal = '';
              let sigVal: string | null = null;
              let dateVal = '';
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                const o = val as Record<string, unknown>;
                nameVal = String(o.name ?? o.fullName ?? codeToValue.get(code.startsWith('student') ? 'student.fullName' : 'trainer.fullName') ?? '');
                sigVal = (typeof o.signature === 'string' ? o.signature : null) ?? (typeof o.imageDataUrl === 'string' ? o.imageDataUrl : null) ?? (typeof o.typedText === 'string' ? o.typedText : null);
                dateVal = String(o.date ?? o.signedAtDate ?? '');
              } else if (typeof val === 'string' && val) {
                sigVal = val;
                nameVal = String(codeToValue.get(code.startsWith('student') ? 'student.fullName' : 'trainer.fullName') ?? '');
              }
              const isStudent = code.startsWith('student');
              if (isStudent) {
                html += '<div class="decl-sig-inline-block">';
                html += `<div class="decl-sig-inline"><span class="decl-sig-label">${question.label}:</span>${renderSignatureHtml(sigVal ?? '') || '<span class="decl-sig-line"></span>'}</div>`;
                if (showDate) html += `<div class="decl-sig-inline"><span class="decl-sig-label">Date:</span><span class="decl-sig-line">${dateVal || ''}</span></div>`;
                html += '</div>';
              } else {
                const sigDisplay = renderSignatureHtml(sigVal ?? '') || `<span class="decl-sig-value">${nameVal || '-'}</span>`;
                html += `<div class="decl-sig-heading">${question.label}</div>`;
                html += '<table class="decl-table"><tbody>';
                if (showName) html += `<tr><td class="decl-label">Trainer/Assessor Name</td><td class="decl-value">${nameVal || ''}</td></tr>`;
                html += `<tr><td class="decl-label">${question.label}</td><td class="decl-value">${sigDisplay}</td></tr>`;
                if (showDate) html += `<tr><td class="decl-label">Date</td><td class="decl-value">${dateVal || ''}</td></tr>`;
                html += '</tbody></table>';
              }
            } else if (question.type === 'date') {
              const val = answers.get(`q-${question.id}`);
              html += `<div class="question"><div class="question-label">${question.label}</div><div class="answer-box">${val ?? ''}</div></div>`;
            } else if (question.type === 'yes_no' || question.type === 'single_choice') {
              const val = answers.get(`q-${question.id}`);
              const checked = String(val || '').toLowerCase() === 'yes' || String(val || '').toLowerCase() === 'true';
              html += `<div class="question declaration-checkbox"><span class="cb ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span><span class="question-label">${question.label}</span></div>`;
            } else {
              const val = answers.get(`q-${question.id}`);
              html += `<div class="question"><div class="question-label">${question.label}</div><div class="answer-box">${val ?? ''}</div></div>`;
            }
          }
          html += '</div>';
        }
      } else {
        const instructionBlocks = questions.filter((q) => q.question.type === 'instruction_block');
        for (const { question } of instructionBlocks) {
          if (question.help_text) {
            html += `<div class="intro-page" style="margin: 0 0 12px 0; line-height: 1.5;">${(question.help_text || '').replace(/\n/g, '<br/>')}</div>`;
          }
        }
        const normalQuestions = questions.filter(
          (q) => q.question.type !== 'instruction_block' && q.question.type !== 'page_break'
        );
        if (normalQuestions.length > 0) {
          const groupNames: Record<string, string> = {
            student: 'Student details',
            trainer: 'Trainer details',
            qualification: 'Qualification/Course/Program Details',
            unit: 'Unit of competency',
            office: 'Office Use Only',
          };
          const groups: Record<string, typeof normalQuestions> = {};
          for (const q of normalQuestions) {
            const prefix = (q.question.code || '').split('.')[0] || 'other';
            const groupKey = groupNames[prefix] || 'Other';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(q);
          }
          html += '<table class="section-table">';
          let rowIdx = 0;
          for (const [groupName, groupQs] of Object.entries(groups)) {
            html += `<tr><td colspan="2" class="sub-section-header">${groupName}</td></tr>`;
            for (const { question, rows } of groupQs) {
              const key = rows[0] ? `q-${question.id}-${rows[0].id}` : `q-${question.id}`;
              const rawVal = answers.get(key);
              const val = (rawVal != null && rawVal !== '') ? rawVal : (question.code ? codeToValue.get(question.code) : undefined);
              const rowClass = rowIdx++ % 2 === 0 ? 'row-normal' : 'row-alt';
              html += `<tr class="${rowClass}"><td class="label-cell">${question.label}</td><td class="value-cell">${val ?? ''}</td></tr>`;
            }
          }
          html += '</table>';
        }
      }
      if (isLearnerEvaluation && learnerEvalIntroShown) {
        html += '</div>';
      }
    }
  }
  html += `</div>`;
  }

  html += `
  </div>
</body>
</html>`;

  const version = form.version || '1';
  return { html, unitCode, version, headerHtml };
}

function splitCoverAndRestHtml(fullHtml: string): { coverHtml: string; restHtml: string } {
  const bodyOpenTag = '<body>';
  const bodyCloseTag = '</body>';
  const introMarker = '<div class="step-page intro-page">';
  const bodyStart = fullHtml.indexOf(bodyOpenTag);
  const bodyEnd = fullHtml.lastIndexOf(bodyCloseTag);

  if (bodyStart < 0 || bodyEnd < 0 || bodyEnd <= bodyStart) {
    return { coverHtml: fullHtml, restHtml: fullHtml };
  }

  const beforeBody = fullHtml.slice(0, bodyStart + bodyOpenTag.length);
  const bodyContent = fullHtml.slice(bodyStart + bodyOpenTag.length, bodyEnd);
  const introIndex = bodyContent.indexOf(introMarker);

  if (introIndex <= 0) {
    return { coverHtml: fullHtml, restHtml: fullHtml };
  }

  const coverContent = bodyContent.slice(0, introIndex);
  const restContent = bodyContent.slice(introIndex);
  const htmlClose = '\n</body>\n</html>';

  return {
    coverHtml: `${beforeBody}${coverContent}${htmlClose}`,
    restHtml: `${beforeBody}${restContent}${htmlClose}`,
  };
}

app.get('/pdf/:instanceId', async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  const download = req.query.download === '1';
  const roleParam = typeof req.query.role === 'string' ? req.query.role : '';
  const role = roleParam === 'trainer' || roleParam === 'office' ? roleParam : 'student';

  if (!instanceId) {
    res.status(400).send('Invalid instance ID');
    return;
  }

  try {
    const template = await getTemplateForInstance(instanceId);
    if (!template) {
      res.status(404).send('Instance not found');
      return;
    }

    const { data: answers } = await supabase
      .from('skyline_form_answers')
      .select('*')
      .eq('instance_id', instanceId);

    let trainerAssessmentsMap = new Map<number, string>();
    let trainerRowAssessmentsMap = new Map<string, string>();
    try {
      const { data: assessments } = await supabase
        .from('skyline_form_trainer_assessments')
        .select('question_id, satisfactory')
        .eq('instance_id', instanceId);
      for (const a of (assessments as { question_id: number; satisfactory: string | null }[]) || []) {
        if (a.satisfactory) trainerAssessmentsMap.set(a.question_id, a.satisfactory);
      }
    } catch (_e) {
      // Table may not exist before migration
    }
    try {
      const { data: rowAssessments } = await supabase
        .from('skyline_form_trainer_row_assessments')
        .select('question_id, row_id, satisfactory')
        .eq('instance_id', instanceId);
      for (const a of (rowAssessments as { question_id: number; row_id: number; satisfactory: string | null }[]) || []) {
        if (a.satisfactory) trainerRowAssessmentsMap.set(`q-${a.question_id}-${a.row_id}`, a.satisfactory);
      }
    } catch (_e) {
      // Table may not exist before migration
    }

    let resultsOfficeMap = new Map<number, { entered_date: string | null; entered_by: string | null }>();
    let resultsDataMap = new Map<number, Record<string, string | null>>();
    try {
      const { data: officeRows } = await supabase
        .from('skyline_form_results_office')
        .select('section_id, entered_date, entered_by')
        .eq('instance_id', instanceId);
      for (const r of (officeRows as { section_id: number; entered_date: string | null; entered_by: string | null }[]) || []) {
        resultsOfficeMap.set(r.section_id, { entered_date: r.entered_date, entered_by: r.entered_by });
      }
    } catch (_e) {
      // Table may not exist before migration
    }
    try {
      const { data: resultsRows } = await supabase
        .from('skyline_form_results_data')
        .select('section_id, first_attempt_satisfactory, first_attempt_date, first_attempt_feedback, second_attempt_satisfactory, second_attempt_date, second_attempt_feedback, third_attempt_satisfactory, third_attempt_date, third_attempt_feedback, student_name, student_signature, trainer_name, trainer_signature, trainer_date')
        .eq('instance_id', instanceId);
      function normalizeSig(v: unknown): string | null {
        if (v == null) return null;
        if (typeof v === 'string') return v.trim() || null;
        if (typeof v === 'object' && !Array.isArray(v)) {
          const o = v as Record<string, unknown>;
          const s = String(o.signature ?? o.imageDataUrl ?? o.typedText ?? '').trim();
          return s || null;
        }
        return null;
      }
      for (const r of (resultsRows as Record<string, unknown>[]) || []) {
        const sid = r.section_id as number;
        resultsDataMap.set(sid, {
          first_attempt_satisfactory: (r.first_attempt_satisfactory as string) ?? null,
          first_attempt_date: (r.first_attempt_date as string) ?? null,
          first_attempt_feedback: (r.first_attempt_feedback as string) ?? null,
          second_attempt_satisfactory: (r.second_attempt_satisfactory as string) ?? null,
          second_attempt_date: (r.second_attempt_date as string) ?? null,
          second_attempt_feedback: (r.second_attempt_feedback as string) ?? null,
          third_attempt_satisfactory: (r.third_attempt_satisfactory as string) ?? null,
          third_attempt_date: (r.third_attempt_date as string) ?? null,
          third_attempt_feedback: (r.third_attempt_feedback as string) ?? null,
          student_name: (r.student_name as string) ?? null,
          student_signature: normalizeSig(r.student_signature),
          trainer_name: (r.trainer_name as string) ?? null,
          trainer_signature: normalizeSig(r.trainer_signature),
          trainer_date: (r.trainer_date as string) ?? null,
        });
      }
    } catch (_e) {
      // Table may not exist before migration
    }

    let assessmentSummaryMap: Record<string, string | null> = {};
    try {
      const { data: sumRow } = await supabase
        .from('skyline_form_assessment_summary_data')
        .select('*')
        .eq('instance_id', instanceId)
        .maybeSingle();
      if (sumRow) {
        const r = sumRow as Record<string, unknown>;
        assessmentSummaryMap = {
          start_date: (r.start_date as string) ?? null,
          end_date: (r.end_date as string) ?? null,
          final_attempt_1_result: (r.final_attempt_1_result as string) ?? null,
          final_attempt_2_result: (r.final_attempt_2_result as string) ?? null,
          final_attempt_3_result: (r.final_attempt_3_result as string) ?? null,
          trainer_sig_1: (r.trainer_sig_1 as string) ?? null,
          trainer_date_1: (r.trainer_date_1 as string) ?? null,
          trainer_sig_2: (r.trainer_sig_2 as string) ?? null,
          trainer_date_2: (r.trainer_date_2 as string) ?? null,
          trainer_sig_3: (r.trainer_sig_3 as string) ?? null,
          trainer_date_3: (r.trainer_date_3 as string) ?? null,
          student_sig_1: (r.student_sig_1 as string) ?? null,
          student_date_1: (r.student_date_1 as string) ?? null,
          student_sig_2: (r.student_sig_2 as string) ?? null,
          student_date_2: (r.student_date_2 as string) ?? null,
          student_sig_3: (r.student_sig_3 as string) ?? null,
          student_date_3: (r.student_date_3 as string) ?? null,
          student_overall_feedback: (r.student_overall_feedback as string) ?? null,
          admin_initials: (r.admin_initials as string) ?? null,
          reasonable_adjustment_task: (r.reasonable_adjustment_task as string) ?? null,
          reasonable_adjustment_explanation: (r.reasonable_adjustment_explanation as string) ?? null,
          trainer_assessor_name: (r.trainer_assessor_name as string) ?? null,
          trainer_assessor_signature: (r.trainer_assessor_signature as string) ?? null,
          trainer_assessor_date: (r.trainer_assessor_date as string) ?? null,
        };
      }
    } catch (_e) {
      // Table may not exist before migration
    }

    const answerMap = getAnswerMap((answers as FormAnswer[]) || []);

    const taskRowIds = new Set<number>();
    for (const g of template.steps) {
      for (const { section } of g.sections) {
        const sid = (section as { assessment_task_row_id?: number | null }).assessment_task_row_id;
        if (sid) taskRowIds.add(sid);
      }
    }
    const taskRowsMap = new Map<number, FormQuestionRow>();
    if (taskRowIds.size > 0) {
      const { data: taskRows } = await supabase
        .from('skyline_form_question_rows')
        .select('*')
        .in('id', Array.from(taskRowIds));
      for (const r of (taskRows as FormQuestionRow[]) || []) taskRowsMap.set(r.id, r);
    }

    const form = template.instance.form as { name: string; version: string | null; unit_code: string | null; header_asset_url: string | null; cover_asset_url?: string | null };
    const { html, unitCode, version, headerHtml } = buildHtml({
      form,
      steps: template.steps,
      answers: answerMap,
      taskRowsMap,
      trainerAssessments: trainerAssessmentsMap,
      trainerRowAssessments: trainerRowAssessmentsMap,
      resultsOffice: resultsOfficeMap,
      resultsData: resultsDataMap,
      assessmentSummaryData: assessmentSummaryMap,
      role,
    });
    const footerHtml = `
      <div style="font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; font-size: 11pt; color: #000000; width: 100%; height: 50px; display: flex; justify-content: space-between; align-items: center; padding: 0 15mm; box-sizing: border-box; page-break-inside: avoid; background: transparent; border-bottom: 1px solid #d1d5db; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
        <span>Version Number: ${version}</span>
        <span>Unit Code: ${unitCode || ''}</span>
        <span>Page <strong><span class="pageNumber"></span></strong> of <strong><span class="totalPages"></span></strong></span>
      </div>
    `;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const { coverHtml, restHtml } = splitCoverAndRestHtml(html);
    await page.setContent(coverHtml, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    });
    await page.evaluate(() => document.fonts.ready);

    // Cover page (page 1): no footer - hide version, unit code, page number
    const coverPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
    });

    let pdf: Buffer;
    await page.setContent(restHtml, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    });
    await page.evaluate(() => document.fonts.ready);
    const restPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '190px', right: '15mm', bottom: '70px', left: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
    });

    await browser.close();

    // Merge: cover (no footer) + rest (with footer)
    const mergedPdf = await PDFDocument.create();
    const coverDoc = await PDFDocument.load(coverPdf);
    const [coverPage] = await mergedPdf.copyPages(coverDoc, [0]);
    mergedPdf.addPage(coverPage);

    const restDoc = await PDFDocument.load(restPdf);
    const restPageCount = restDoc.getPageCount();
    if (restPageCount > 0) {
      for (let i = 0; i < restPageCount; i++) {
        const [p] = await mergedPdf.copyPages(restDoc, [i]);
        mergedPdf.addPage(p);
      }
    }

    pdf = Buffer.from(await mergedPdf.save());

    let pdfFilename = `form-${instanceId}.pdf`;
    if (download) {
      let studentId = '';
      let studentName = '';
      for (const g of template.steps) {
        for (const { questions } of g.sections) {
          for (const { question } of questions) {
            if (question.code === 'student.id') {
              const v = answerMap.get(`q-${question.id}`);
              if (v != null) studentId = String(v).trim();
            }
            if (question.code === 'student.fullName') {
              const v = answerMap.get(`q-${question.id}`);
              if (v != null) studentName = String(v).trim();
            }
          }
        }
      }
      if (studentId || studentName) {
        const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
        const idPart = sanitize(studentId);
        const namePart = sanitize(studentName);
        pdfFilename = [idPart, namePart].filter(Boolean).join('_') + '.pdf';
      }
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).send('Failed to generate PDF');
  }
});

app.get('/pdf/preview/form/:formId', async (req, res) => {
  const formId = Number(req.params.formId);
  const download = req.query.download === '1';

  if (!formId) {
    res.status(400).send('Invalid form ID');
    return;
  }

  try {
    const template = await getTemplateForForm(formId);
    if (!template) {
      res.status(404).send('Form not found');
      return;
    }

    const answerMap = getAnswerMap([]);

    const taskRowIds = new Set<number>();
    for (const g of template.steps) {
      for (const { section } of g.sections) {
        const sid = (section as { assessment_task_row_id?: number | null }).assessment_task_row_id;
        if (sid) taskRowIds.add(sid);
      }
    }
    const taskRowsMap = new Map<number, FormQuestionRow>();
    if (taskRowIds.size > 0) {
      const { data: taskRows } = await supabase
        .from('skyline_form_question_rows')
        .select('*')
        .in('id', Array.from(taskRowIds));
      for (const r of (taskRows as FormQuestionRow[]) || []) taskRowsMap.set(r.id, r);
    }

    const form = template.form as { name: string; version: string | null; unit_code: string | null; header_asset_url: string | null; cover_asset_url?: string | null };
    const { html, unitCode, version, headerHtml } = buildHtml({
      form,
      steps: template.steps,
      answers: answerMap,
      taskRowsMap,
      trainerAssessments: new Map<number, string>(),
      trainerRowAssessments: new Map<string, string>(),
      resultsOffice: new Map<number, { entered_date: string | null; entered_by: string | null }>(),
      resultsData: new Map<number, { first_attempt_satisfactory?: string | null; first_attempt_date?: string | null; first_attempt_feedback?: string | null; second_attempt_satisfactory?: string | null; second_attempt_date?: string | null; second_attempt_feedback?: string | null; trainer_name?: string | null; trainer_signature?: string | null; trainer_date?: string | null }>(),
      assessmentSummaryData: {},
    });
    const footerHtml = `
      <div style="font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; font-size: 11pt; color: #000000; width: 100%; height: 50px; display: flex; justify-content: space-between; align-items: center; padding: 0 15mm; box-sizing: border-box; page-break-inside: avoid; background: transparent; border-bottom: 1px solid #d1d5db; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
        <span>Version Number: ${version}</span>
        <span>Unit Code: ${unitCode || ''}</span>
        <span>Page <strong><span class="pageNumber"></span></strong> of <strong><span class="totalPages"></span></strong></span>
      </div>
    `;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const { coverHtml, restHtml } = splitCoverAndRestHtml(html);
    await page.setContent(coverHtml, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    });
    await page.evaluate(() => document.fonts.ready);

    const coverPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
    });

    let pdf: Buffer;
    await page.setContent(restHtml, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    });
    await page.evaluate(() => document.fonts.ready);
    const restPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '190px', right: '15mm', bottom: '70px', left: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
    });

    await browser.close();

    const mergedPdf = await PDFDocument.create();
    const coverDoc = await PDFDocument.load(coverPdf);
    const [coverPage] = await mergedPdf.copyPages(coverDoc, [0]);
    mergedPdf.addPage(coverPage);

    const restDoc = await PDFDocument.load(restPdf);
    const restPageCount = restDoc.getPageCount();
    if (restPageCount > 0) {
      for (let i = 0; i < restPageCount; i++) {
        const [p] = await mergedPdf.copyPages(restDoc, [i]);
        mergedPdf.addPage(p);
      }
    }

    pdf = Buffer.from(await mergedPdf.save());

    if (download) {
      const safeName = String(form.name || 'form-preview').replace(/[/\\:*?"<>|]/g, '_').trim();
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'form-preview'}.pdf"`);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(pdf);
  } catch (err) {
    console.error('PDF preview generation error:', err);
    res.status(500).send('Failed to generate preview PDF');
  }
});

app.listen(PORT, () => {
  console.log(`PDF server running on http://localhost:${PORT}`);
});
