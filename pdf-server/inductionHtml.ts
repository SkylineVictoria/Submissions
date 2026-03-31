/**
 * Induction pack HTML for Playwright PDF — crest + logo-text in document flow per page;
 * margins are uniform (no Playwright header/footer templates — inner footers live in HTML).
 */
import path from 'path';
import fs from 'fs';

export function resolveSlitLogoDataUrls(baseDir: string): { crestImg: string; textImg: string } {
  let crestImg = '';
  let textImg = '';
  const resolveLogoPath = (filename: string) => {
    const dirs = [path.join(baseDir, 'public'), path.join(baseDir, '..', 'public')];
    for (const dir of dirs) {
      const p = path.join(dir, filename);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  try {
    const crestPath =
      resolveLogoPath('logo-crest.png') ??
      resolveLogoPath('logo.png') ??
      resolveLogoPath('logo.jpeg') ??
      resolveLogoPath('logo.jpg');
    if (crestPath) {
      const buf = fs.readFileSync(crestPath);
      const mime = crestPath.endsWith('.png') ? 'png' : 'jpeg';
      crestImg = `data:image/${mime};base64,${buf.toString('base64')}`;
    } else {
      crestImg = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><text x="10" y="55" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#f97316">SKYLINE</text></svg>'
      )}`;
    }
    const textPath = resolveLogoPath('logo-text.png');
    if (textPath) {
      const buf = fs.readFileSync(textPath);
      textImg = `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch {
    /* ignore */
  }
  return { crestImg, textImg };
}

/** Same layout as buildHtml headerHtml in index.ts (Playwright header template). */
export function buildSlitPdfHeaderHtml(crestImg: string, textImg: string): string {
  const crestAttr = crestImg ? crestImg.replace(/"/g, '&quot;') : '';
  const textCenter = textImg
    ? `<img src="${textImg.replace(/"/g, '&quot;')}" alt="SKYLINE INSTITUTE OF TECHNOLOGY" style="height:100px;width:auto;object-fit:contain;display:block;" />`
    : '<div style="display:flex;flex-direction:column;align-items:center;"><span style="font-size:22pt;font-weight:700;color:#f97316;letter-spacing:2px;">SKYLINE</span><span style="font-size:9pt;font-weight:600;color:#374151;letter-spacing:2px;margin-top:2px;">INSTITUTE OF TECHNOLOGY</span></div>';
  return `
    <div style="position:relative;width:100%;min-height:165px;box-sizing:border-box;font-family:'Calibri','Calibri Light',Arial,sans-serif;font-weight:400;line-height:1.05;">
      <div style="height:165px;min-height:165px;width:0;overflow:hidden;pointer-events:none;"></div>
      <div style="position:absolute;left:15mm;right:15mm;top:110px;border-top:1px solid #8b95a5;z-index:0;"></div>
      <div style="position:absolute;left:15mm;top:0px;z-index:1;">${crestImg ? `<img src="${crestAttr}" alt="Skyline Institute of Technology" style="width:210px;height:165px;object-fit:contain;display:block;" />` : ''}</div>
      <div style="position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:1;">${textCenter}</div>
      <div style="position:absolute;right:15mm;top:8px;width:250px;font-size:10pt;font-family:'Calibri','Calibri Light',Arial,sans-serif;color:#374151;text-align:right;line-height:1.25;font-weight:300;z-index:1;">
        Level 8, 310 King Street<br/>Melbourne VIC – 3000<br/>RTO: 45989 CRICOS: 04114B<br/>Email: <a href="mailto:info@slit.edu.au" style="color:#2563eb;text-decoration:underline;">info@slit.edu.au</a><br/>Phone: +61 3 9125 1661
      </div>
    </div>
  `;
}

/**
 * Flowed header for induction PDF body — same geometry as `buildSlitPdfHeaderHtml` / assessment PDF:
 * horizontal rule at top:110px (behind crest), crest + logo-text + address on top; tight bottom margin.
 */
export function buildSlitPdfInlineHeaderHtml(crestImg: string, textImg: string): string {
  const crestAttr = crestImg ? crestImg.replace(/"/g, '&quot;') : '';
  const textCenter = textImg
    ? `<img src="${textImg.replace(/"/g, '&quot;')}" alt="SKYLINE INSTITUTE OF TECHNOLOGY" style="height:100px;width:auto;object-fit:contain;display:block;" />`
    : '<div style="display:flex;flex-direction:column;align-items:center;"><span style="font-size:22pt;font-weight:700;color:#f97316;letter-spacing:2px;">SKYLINE</span><span style="font-size:9pt;font-weight:600;color:#374151;letter-spacing:2px;margin-top:2px;">INSTITUTE OF TECHNOLOGY</span></div>';
  const crestBlock = crestImg
    ? `<img src="${crestAttr}" alt="Skyline Institute of Technology" style="width:210px;height:165px;object-fit:contain;display:block;" />`
    : '';
  return `<div style="position:relative;width:100%;min-height:165px;box-sizing:border-box;margin:0 0 6px 0;font-family:'Calibri','Calibri Light',Arial,sans-serif;font-weight:400;line-height:1.05;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
<div style="height:165px;min-height:165px;width:0;overflow:hidden;pointer-events:none;"></div>
<div style="position:absolute;left:0;right:0;top:110px;border-top:1px solid #8b95a5;z-index:0;"></div>
<div style="position:absolute;left:0;top:0;z-index:1;">${crestBlock}</div>
<div style="position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:1;">${textCenter}</div>
<div style="position:absolute;right:0;top:8px;width:250px;font-size:10pt;color:#374151;text-align:right;line-height:1.25;font-weight:300;z-index:1;">Level 8, 310 King Street<br/>Melbourne VIC – 3000<br/>RTO: 45989 CRICOS: 04114B<br/>Email: <a href="mailto:info@slit.edu.au" style="color:#2563eb;text-decoration:underline;">info@slit.edu.au</a><br/>Phone: +61 3 9125 1661</div>
</div>`;
}

export function buildInductionFooterHtml(): string {
  return `
      <div style="font-family: 'Calibri', 'Calibri Light', Arial, sans-serif; font-size: 11pt; color: #000000; width: 100%; height: 50px; display: flex; justify-content: space-between; align-items: center; padding: 0 15mm; box-sizing: border-box; page-break-inside: avoid; background: transparent; border-bottom: 1px solid #d1d5db; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
        <span>Induction pack</span>
        <span style="font-size:9pt;color:#374151">Skyline Institute of Technology</span>
        <span>Page <strong><span class="pageNumber"></span></strong> of <strong><span class="totalPages"></span></strong></span>
      </div>
    `;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** PDF display: ISO yyyy-MM-dd → dd/MM/yyyy; otherwise return trimmed text for escaping upstream. */
function formatDatePdf(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split('-');
    return `${d}/${m}/${y}`;
  }
  return t;
}

/** Signature text in filled PDFs — matches assessment-style emphasis (red italic). */
const PDF_SIGNATURE_STYLE = 'color:#b91c1c;font-style:italic;font-weight:600;';

function melbourneMonthYearUpper(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', month: 'long', year: 'numeric' })
      .format(d)
      .toUpperCase();
  } catch {
    return '';
  }
}

const POLICY_ROWS = [
  '2) Refund policy',
  '3) Deferment policy',
  '4) Credit transfer policy',
  '5) Transfer policy',
  '6) Fees policy',
  '7) Access to records',
  '8) Complaints policy',
  '9) Attendance policy',
  '10) Reassessment policy',
  '11) Ethics (SLIT)',
];

const HANDBOOK_ROWS = [
  '20) Student support services',
  '21) Student visa conditions',
  '22) Adjusting to life in Melbourne',
  '23) Student handbook',
];

/** Same order as web form / `CHECKLIST_TOPIC_KEYS` in `src/lib/inductionForm.ts`. */
const INDUCTION_CHECKLIST_KEYS = [
  'course_module',
  'refund',
  'deferment',
  'credit_transfer',
  'transfer',
  'fees',
  'access_records',
  'complaints',
  'attendance',
  'reassessment',
  'ethics',
  'ohs',
  'location',
  'student_support',
  'visa',
  'melbourne',
  'handbook',
] as const;

function pget(payload: Record<string, unknown>, ...keys: string[]): string {
  let o: unknown = payload;
  for (const k of keys) {
    if (o == null || typeof o !== 'object') return '';
    o = (o as Record<string, unknown>)[k];
  }
  if (o == null) return '';
  return String(o);
}

function inlineField(
  P: Record<string, unknown> | null,
  path: string[],
  minW: string,
  solid?: boolean,
): string {
  const v = P ? pget(P, ...path).trim() : '';
  const border = solid ? '1px solid #000' : '1px dotted #9ca3af';
  return `<span style="border-bottom:${border};display:inline-block;min-width:${minW};">${v ? esc(v) : ''}</span>`;
}

function inlineDateField(
  P: Record<string, unknown> | null,
  path: string[],
  minW: string,
  solid?: boolean,
): string {
  const raw = P ? pget(P, ...path).trim() : '';
  const display = raw ? formatDatePdf(raw) : '';
  const border = solid ? '1px solid #000' : '1px dotted #9ca3af';
  return `<span style="border-bottom:${border};display:inline-block;min-width:${minW};">${display ? esc(display) : ''}</span>`;
}

function inlineSignatureField(
  P: Record<string, unknown> | null,
  path: string[],
  minW: string,
  solid?: boolean,
): string {
  const v = P ? pget(P, ...path).trim() : '';
  const border = solid ? '1px solid #000' : '1px dotted #9ca3af';
  const inner = v ? `<span style="${PDF_SIGNATURE_STYLE}">${esc(v)}</span>` : '';
  return `<span style="border-bottom:${border};display:inline-block;min-width:${minW};">${inner}</span>`;
}

function checklistTopicFirstCell(key: string): string {
  switch (key) {
    case 'course_module':
      return `<strong>1) Course/module information</strong><br/><span style="font-size:7.5pt;line-height:1.25;">→ Introduction of key teaching and support staff<br/>→ Module outline and student certificates upon completion<br/>→ Students provided with timetables/training plan</span>`;
    case 'refund':
      return `<span style="text-decoration:underline;">2) Refund policy</span>`;
    case 'deferment':
      return `<span style="text-decoration:underline;">3) Deferment policy</span>`;
    case 'credit_transfer':
      return `<span style="text-decoration:underline;">4) Credit transfer policy</span>`;
    case 'transfer':
      return `<span style="text-decoration:underline;">5) Transfer policy</span>`;
    case 'fees':
      return `<span style="text-decoration:underline;">6) Fees policy</span>`;
    case 'access_records':
      return `<span style="text-decoration:underline;">7) Access to records</span>`;
    case 'complaints':
      return `<span style="text-decoration:underline;">8) Complaints policy</span>`;
    case 'attendance':
      return `<span style="text-decoration:underline;">9) Attendance policy</span>`;
    case 'reassessment':
      return `<span style="text-decoration:underline;">10) Reassessment policy</span>`;
    case 'ethics':
      return `<span style="text-decoration:underline;">11) Ethics (SLIT)</span>`;
    case 'ohs':
      return `<span style="font-weight:600;">15) Occupational health and safety procedures</span>`;
    case 'location':
      return `<strong>19) Location of</strong><br/><span style="font-size:7.5pt;line-height:1.25;">→ Classrooms<br/>→ Kitchen and recreation areas<br/>→ Toilets<br/>→ Public transport</span>`;
    case 'student_support':
      return `<span style="text-decoration:underline;">20) Student support services</span>`;
    case 'visa':
      return `<span style="text-decoration:underline;">21) Student visa conditions</span>`;
    case 'melbourne':
      return `<span style="text-decoration:underline;">22) Adjusting to life in Melbourne</span>`;
    case 'handbook':
      return `<span style="text-decoration:underline;">23) Student handbook</span>`;
    default:
      return esc(key);
  }
}

function ynCells(key: string, row: { answer?: string; initial?: string } | undefined): string {
  const hi = key === 'course_module' || key === 'location' ? ' class="cell-blue"' : '';
  const yes = row?.answer === 'yes';
  const no = row?.answer === 'no';
  const y = yes ? '●' : '○';
  const n = no ? '●' : '○';
  const ini = esc(String(row?.initial ?? ''));
  return `<td style="text-align:center;"${hi}>${y}</td><td style="text-align:center;"${hi}>${n}</td><td style="text-align:center;"${hi}>${ini}</td>`;
}

function buildFilledChecklistTbody(P: Record<string, unknown>): string {
  const rows = (
    P.checklistRows && typeof P.checklistRows === 'object' ? P.checklistRows : {}
  ) as Record<string, { answer?: string; initial?: string }>;
  let html = '';
  for (const key of INDUCTION_CHECKLIST_KEYS) {
    html += `<tr><td>${checklistTopicFirstCell(key)}</td>${ynCells(key, rows[key])}</tr>`;
  }
  return html;
}

function buildBlankChecklistTbody(policyRowsHtml: string, handbookRowsHtml: string): string {
  return `<tr>
          <td><strong>1) Course/module information</strong><br/><span style="font-size:7.5pt;line-height:1.25;">→ Introduction of key teaching and support staff<br/>→ Module outline and student certificates upon completion<br/>→ Students provided with timetables/training plan</span></td>
          <td class="cell-blue"></td><td class="cell-blue"></td><td class="cell-blue"></td>
        </tr>
        ${policyRowsHtml}
        <tr>
          <td style="font-weight:600;">15) Occupational health and safety procedures</td>
          <td></td><td></td><td></td>
        </tr>
        <tr>
          <td><strong>19) Location of</strong><br/><span style="font-size:7.5pt;line-height:1.25;">→ Classrooms<br/>→ Kitchen and recreation areas<br/>→ Toilets<br/>→ Public transport</span></td>
          <td class="cell-blue"></td><td class="cell-blue"></td><td class="cell-blue"></td>
        </tr>
        ${handbookRowsHtml}`;
}

function buildChecklistHeaderHtml(P: Record<string, unknown> | null): string {
  return `<p style="margin:3px 0;font-size:10pt;"><span style="font-weight:600;">Student full name:</span> ${inlineField(P, ['checklistHeader', 'fullName'], '200px')}</p>
    <p style="margin:3px 0;font-size:10pt;"><span style="font-weight:600;">Student ID:</span> ${inlineField(P, ['checklistHeader', 'studentId'], '200px')}</p>
    <p style="margin:3px 0;font-size:10pt;"><span style="font-weight:600;">Email:</span> ${inlineField(P, ['checklistHeader', 'email'], '180px')}
    <span style="font-weight:600;margin-left:12px;">Mobile:</span> ${inlineField(P, ['checklistHeader', 'mobile'], '120px')}</p>
    <p style="margin:3px 0;font-size:10pt;"><span style="font-weight:600;">Course:</span> ${inlineField(P, ['checklistHeader', 'course'], '240px')}</p>`;
}

function buildChecklistDeclarationHtml(P: Record<string, unknown> | null): string {
  return `<p style="margin-top:10px;font-size:10pt;"><span style="font-weight:600;">Signature:</span> ${inlineSignatureField(P, ['checklistDeclaration', 'signature'], '220px', true)}
    <span style="font-weight:600;margin-left:16px;">Date:</span> ${inlineDateField(P, ['checklistDeclaration', 'date'], '100px', true)}</p>`;
}

function enrolObj(P: Record<string, unknown> | null): Record<string, unknown> {
  if (!P || typeof P.enrolment !== 'object' || !P.enrolment) return {};
  return P.enrolment as Record<string, unknown>;
}

function fi(e: Record<string, unknown>, key: string): string {
  const v = e[key];
  if (v == null || String(v).trim() === '') return '&nbsp;';
  return esc(String(v));
}

function fiDate(e: Record<string, unknown>, key: string): string {
  const v = e[key];
  if (v == null || String(v).trim() === '') return '&nbsp;';
  const d = formatDatePdf(String(v));
  return d ? esc(d) : '&nbsp;';
}

function buildEnrolmentTableBody(P: Record<string, unknown> | null): string {
  const e = enrolObj(P);
  const g = String(e.gender ?? '');
  const male = g === 'male';
  const female = g === 'female';
  const dobTxt = fiDate(e, 'dateOfBirth');
  const dobLine =
    dobTxt === '&nbsp;'
      ? `________________&nbsp;&nbsp;&nbsp;&nbsp;Gender (please tick): ☐ Male ☐ Female`
      : `${dobTxt}&nbsp;&nbsp;&nbsp;&nbsp;Gender (please tick): ${male ? '☑' : '☐'} Male ${female ? '☑' : '☐'} Female`;

  const rawSig = String(e.declarationSignature ?? '').trim();
  const rawDeclDate = String(e.declarationDate ?? '').trim();
  const sigSpan = rawSig
    ? `<span style="border-bottom:1px solid #000;display:inline-block;min-width:55%;"><span style="${PDF_SIGNATURE_STYLE}">${esc(rawSig)}</span></span>`
    : '<span style="border-bottom:1px solid #000;display:inline-block;min-width:55%;">&nbsp;</span>';
  const dateSpan = rawDeclDate
    ? `<span style="border-bottom:1px solid #000;display:inline-block;min-width:100px;">${esc(formatDatePdf(rawDeclDate))}</span>`
    : '<span style="border-bottom:1px solid #000;display:inline-block;min-width:100px;">&nbsp;</span>';

  const officeSpan = (minW: string, key: string) => {
    const inner = fi(e, key);
    if (inner === '&nbsp;')
      return `<span style="border-bottom:1px dotted #64748b;display:inline-block;min-width:${minW};">&nbsp;</span>`;
    return `<span style="border-bottom:1px dotted #64748b;display:inline-block;min-width:${minW};">${inner}</span>`;
  };

  const officeSpanDate = (minW: string, key: string) => {
    const inner = fiDate(e, key);
    if (inner === '&nbsp;')
      return `<span style="border-bottom:1px dotted #64748b;display:inline-block;min-width:${minW};">&nbsp;</span>`;
    return `<span style="border-bottom:1px dotted #64748b;display:inline-block;min-width:${minW};">${inner}</span>`;
  };

  return `<tr><td colspan="2" class="form-hdr">Personal Details</td></tr>
        <tr><td class="form-lbl">Family Name</td><td class="form-inp">${fi(e, 'familyName')}</td></tr>
        <tr><td class="form-lbl">Given Name/s</td><td class="form-inp">${fi(e, 'givenNames')}</td></tr>
        <tr><td class="form-lbl">Date of Birth</td><td class="form-inp">${dobLine}</td></tr>
        <tr><td class="form-lbl">Student ID</td><td class="form-inp">${fi(e, 'studentId')}</td></tr>
        <tr><td class="form-lbl">Passport Number</td><td class="form-inp">${fi(e, 'passportNumber')}</td></tr>
        <tr><td class="form-lbl">Visa Number</td><td class="form-inp">${fi(e, 'visaNumber')}</td></tr>
        <tr><td class="form-lbl">Visa Expiry Date</td><td class="form-inp">${fiDate(e, 'visaExpiry')}</td></tr>
        <tr><td class="form-lbl">Residential Address</td><td class="form-inp">${fi(e, 'residentialAddress')}</td></tr>
        <tr><td class="form-lbl">Phone</td><td class="form-inp">${fi(e, 'phone')}</td></tr>
        <tr><td class="form-lbl">Email</td><td class="form-inp">${fi(e, 'email')}</td></tr>
        <tr><td class="form-lbl">USI Number</td><td class="form-inp">${fi(e, 'usiNumber')}</td></tr>
        <tr><td colspan="2" class="form-hdr">Emergency Contact Details</td></tr>
        <tr><td class="form-lbl">Name</td><td class="form-inp">${fi(e, 'emergencyName')}</td></tr>
        <tr><td class="form-lbl">Address</td><td class="form-inp">${fi(e, 'emergencyAddress')}</td></tr>
        <tr><td class="form-lbl">Telephone Number</td><td class="form-inp">${fi(e, 'emergencyPhone')}</td></tr>
        <tr><td class="form-lbl">Relationship to you</td><td class="form-inp">${fi(e, 'emergencyRelationship')}</td></tr>
        <tr><td colspan="2" class="form-decl">I declare the information provided by myself, on this form is true and correct.</td></tr>
        <tr><td class="form-lbl">Signature</td><td class="form-inp">${sigSpan} &nbsp; <strong>Date:</strong> ${dateSpan}</td></tr>
        <tr><td colspan="2" class="form-hdr">OFFICE USE ONLY</td></tr>
        <tr><td class="form-lbl">Updated in SMS by</td><td class="form-inp">${officeSpan('45%', 'officeSmsBy')} &nbsp; <strong>Date:</strong> ${officeSpanDate('90px', 'officeSmsDate')}</td></tr>
        <tr><td class="form-lbl">Updated in PRISMS by</td><td class="form-inp">${officeSpan('45%', 'officePrismsBy')} &nbsp; <strong>Date:</strong> ${officeSpanDate('90px', 'officePrismsDate')}</td></tr>`;
}

function gv(o: Record<string, unknown>, k: string): string {
  return String(o[k] ?? '').trim();
}

function buildMediaPageHtml(P: Record<string, unknown> | null): string {
  const a = P && typeof P.mediaAck === 'object' && P.mediaAck ? (P.mediaAck as Record<string, unknown>) : {};
  const m = P && typeof P.mediaConsent === 'object' && P.mediaConsent ? (P.mediaConsent as Record<string, unknown>) : {};
  const ink = (v: string) => (v ? esc(v) : '&nbsp;');
  const inkSig = (v: string) =>
    v ? `<span style="${PDF_SIGNATURE_STYLE}">${esc(v)}</span>` : '&nbsp;';
  const inkDate = (v: string) => {
    const t = String(v ?? '').trim();
    if (!t) return '&nbsp;';
    const d = formatDatePdf(t);
    return d ? esc(d) : '&nbsp;';
  };
  const nameBlock = (v: string) =>
    v
      ? `<span class="media-sig-block" style="border-bottom:1px solid #000;display:block;width:240px;margin:0;min-height:14px;line-height:1.2;">${esc(v)}</span>`
      : `<span class="media-sig-block"></span>`;
  const nameBlockSig = (v: string) =>
    v
      ? `<span class="media-sig-block" style="border-bottom:1px solid #000;display:block;width:240px;margin:0;min-height:14px;line-height:1.2;"><span style="${PDF_SIGNATURE_STYLE}">${esc(v)}</span></span>`
      : `<span class="media-sig-block"></span>`;

  return `<p style="margin:10px 0 0 0;"><strong>Student Name:</strong> <span class="media-sig media-sig-ww">${ink(gv(a, 'studentName'))}</span></p>
    <p style="margin:7px 0 0 0;"><strong>Student Signature:</strong> <span class="media-sig media-sig-ww">${inkSig(gv(a, 'studentSignature'))}</span></p>
    <p style="margin:7px 0 0 0;"><strong>Date:</strong> <span class="media-sig media-sig-w">${inkDate(gv(a, 'date'))}</span></p>
    <p style="text-align:center;font-size:11pt;font-weight:bold;text-decoration:underline;margin:18px 0 10px 0;">CONSENT FORM</p>
    <p style="margin:0 0 7px 0;">This section is voluntary — you do not need to complete it to submit your induction. You may choose to consent or decline. Your decision will not affect your enrolment, academic standing, or access to services.</p>
    <p style="margin:8px 0 0 0;">I <span class="media-sig media-sig-ww">${ink(gv(m, 'consentorNameOnLine'))}</span></p>
    <p style="margin:2px 0 0 0;text-align:left;font-size:8.5pt;font-weight:600;">Name of person giving consent</p>
    <p style="margin:8px 0 0 0;">Consent to the use of photographs or video footage for use on the SKYLINE INSTITUTE OF TECHNOLOGY website, social media, in newsletters and publications as well as promotional material for the Institute.</p>
    <p style="margin:7px 0 0 0;">Consent to the use of photographs or video footage being used to promote future events by SKYLINE INSTITUTE OF TECHNOLOGY.</p>
    <p style="margin:7px 0 0 0;">I further understand that this consent may be withdrawn by me at any time, upon written notice. I give this consent voluntarily.</p>
    <div style="margin:12px 0 0 0;text-align:left;">${nameBlock(gv(m, 'name'))}<p style="margin:2px 0 0 0;text-align:left;font-size:8.5pt;font-weight:600;">Name of person giving consent</p></div>
    <div style="margin:8px 0 0 0;text-align:left;">${nameBlockSig(gv(m, 'signature'))}<p style="margin:2px 0 0 0;text-align:left;font-size:8.5pt;font-weight:600;">Signature of person giving consent</p></div>
    <p style="margin:8px 0 0 0;"><strong>Date:</strong> <span class="media-sig media-sig-w">${inkDate(gv(m, 'date'))}</span></p>`;
}

export function buildInductionPdfHtml(input: {
  title: string;
  startAt: string;
  endAt: string;
  crestImg: string;
  textImg: string;
  /** When set, renders submitted checklist / enrolment / media values (admin filled PDF). */
  formPayload?: Record<string, unknown> | null;
}): { html: string } {
  const period = melbourneMonthYearUpper(input.startAt);
  const inlineHeader = buildSlitPdfInlineHeaderHtml(input.crestImg, input.textImg);

  const watermark = (inner: string) => `
    <div style="position:relative;overflow:hidden;min-height:1px;">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0;">
        <span style="font-size:120pt;font-weight:bold;color:rgba(229,231,235,0.45);text-transform:uppercase;line-height:1;">SKYLINE</span>
      </div>
      <div style="position:relative;z-index:1;">${inner}</div>
    </div>`;

  let policyRowsHtml = '';
  for (const label of POLICY_ROWS) {
    policyRowsHtml += `<tr><td style="border:1px solid #000;padding:6px 8px;text-decoration:underline;">${esc(label)}</td><td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td></tr>`;
  }
  let handbookRowsHtml = '';
  for (const label of HANDBOOK_ROWS) {
    handbookRowsHtml += `<tr><td style="border:1px solid #000;padding:6px 8px;text-decoration:underline;">${esc(label)}</td><td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td></tr>`;
  }

  const P = input.formPayload ?? null;
  const checklistHeaderBlock = buildChecklistHeaderHtml(P);
  const checklistTbody = P ? buildFilledChecklistTbody(P) : buildBlankChecklistTbody(policyRowsHtml, handbookRowsHtml);
  const checklistDecl = buildChecklistDeclarationHtml(P);
  const enrolmentTbody = buildEnrolmentTableBody(P);
  const mediaInner = buildMediaPageHtml(P);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Calibri', 'Calibri Light', Arial, Helvetica, sans-serif;
      font-size: 12pt;
      line-height: 1.35;
      color: #000000;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Fill each A4 sheet: content area ≈ 297mm − 24mm margins; footer pinned to bottom */
    .induction-pdf-page {
      page-break-after: always;
      padding: 0;
      display: flex;
      flex-direction: column;
      min-height: 273mm;
      box-sizing: border-box;
    }
    .induction-pdf-page:last-child { page-break-after: auto; }
    .induction-pdf-page-body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .induction-pdf-page-spacer {
      flex: 1 1 auto;
      min-height: 0;
    }
    .induction-inner-footer {
      margin-top: auto;
      flex-shrink: 0;
      padding-top: 8px;
      border-top: 1px solid #d1d5db;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    ul.induction-ul { list-style: disc; margin: 6px 0 10px 0; padding-left: 1.25rem; }
    ul.induction-nested { list-style: circle; margin: 4px 0; padding-left: 1.25rem; }
    .step-title {
      font-weight: bold;
      text-decoration: underline;
      text-transform: uppercase;
      margin-top: 7px;
      margin-bottom: 3px;
      font-size: 12pt;
    }
    .induction-pdf-page--instruction ul.induction-ul { margin: 3px 0 5px 0; }
    .induction-pdf-page--instruction ul.induction-nested { margin: 2px 0; }
    table.chk { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 8px; }
    table.chk th, table.chk td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    table.chk th { background: #F28E40; color: #000; font-weight: bold; text-align: left; }
    .cell-blue { background: #eff6ff; }
    table.form-tbl { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 8px; }
    table.form-tbl td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    .form-hdr { background: #e60000; color: #fff; font-weight: bold; padding: 6px 8px; }
    .form-lbl { width: 34%; font-weight: 600; }
    .form-inp { background: #F0F4F8; min-height: 20px; }
    .form-decl { color: #e60000; font-weight: 600; padding: 8px 6px !important; }
    ul.media-ul { list-style: disc; margin: 4px 0 0 0; padding-left: 1.1rem; line-height: 1.28; }
    ul.media-ul li { margin: 2px 0; }
    .induction-pdf-page--media { font-size: 10pt; line-height: 1.33; }
    .induction-pdf-page--media h2 { text-align: center; font-size: 12pt !important; margin: 0 0 6px 0 !important; }
    .induction-pdf-page--media ul.media-ul { margin: 5px 0 2px 0; padding-left: 1.12rem; line-height: 1.32; }
    .induction-pdf-page--media ul.media-ul li { margin: 3px 0; }
    /* F12 page: natural height only — avoids min-height + spacer forcing a 5th sheet */
    .induction-pdf-page.induction-pdf-page--media { min-height: auto; }
    .induction-pdf-page--media .induction-pdf-page-body { flex: 0 0 auto; }
    .induction-pdf-page--media .induction-pdf-page-spacer { display: none; }
    .induction-pdf-page--media .induction-inner-footer { margin-top: 10px; }
    .media-sig { border-bottom: 1px solid #000; display: inline-block; vertical-align: bottom; }
    .media-sig-w { width: 220px; }
    .media-sig-ww { width: 240px; }
    .media-sig-block { border-bottom: 1px solid #000; display: block; width: 240px; margin: 0; height: 10px; }
  </style>
</head>
<body>
  <div class="induction-pdf-page induction-pdf-page--instruction">
    <div class="induction-pdf-page-body">
    ${inlineHeader}
    ${watermark(`
    <h2 style="text-align:center;font-size:16pt;font-weight:bold;text-transform:uppercase;text-decoration:underline;margin:0 0 10px 0;line-height:1.15;">Induction instruction</h2>
    <p class="step-title">Step 1: Forms</p>
    <ul class="induction-ul">
      <li><strong>Fill out and sign</strong> the following forms:
        <ul class="induction-nested">
          <li><strong>Student Induction Checklist</strong></li>
          <li><strong>Student Enrolment Form</strong></li>
          <li><strong>Media Consent Form</strong></li>
        </ul>
      </li>
    </ul>
    <p class="step-title">Step 2: LLN quiz</p>
    <ul class="induction-ul"><li>Complete the <strong>LLN quiz</strong></li></ul>
    <p style="margin:4px 0 0 4px;font-size:11pt;line-height:1.35;"><strong>Note:</strong> Link to the quiz is shared via email. If unable to find it, please contact the administrator.</p>
    <p class="step-title">Step 3: Submit documents</p>
    <ul class="induction-ul"><li>Share the following documents to the email address <a href="mailto:studentsupport@slit.edu.au" style="color:#2563eb;">studentsupport@slit.edu.au</a>:</li></ul>
    <ul class="induction-nested" style="margin-left:12px;">
      <li><strong>Health insurance</strong></li>
      <li><strong>Passport sized photograph</strong> for student ID card</li>
      <li><strong>Academic records</strong> (previous from grade 10)</li>
      <li><strong>Current visa copy</strong></li>
      <li><strong>PTE or IELTS score</strong> (if given any)</li>
    </ul>
    <p class="step-title">Step 4: Login setup</p>
    <ul class="induction-ul"><li>Install the following apps</li></ul>
    <ul class="induction-nested" style="margin-left:12px;">
      <li><strong>Microsoft Outlook</strong></li>
      <li><strong>Microsoft Teams</strong></li>
    </ul>
    <ul class="induction-ul"><li>Log in using the student login details sent to your personal email with the subject &quot;Student Login&quot;.</li></ul>
    <div style="border:1px solid #000;padding:10px 12px;margin-top:12px;">
      <p style="text-align:center;font-size:12pt;font-weight:bold;text-transform:uppercase;text-decoration:underline;margin:0 0 6px 0;">Important information</p>
      <ul class="induction-ul" style="margin:0;line-height:1.35;">
        <li>From now onwards, every email regarding the course or related to the student will be sent to the institutional email. So, always check emails regularly.</li>
        <li>Training plan and payment plan will be shared via the institutional email after the induction.</li>
        <li>Instructions and link to LMS will be provided shortly after induction.</li>
        <li>In case of any query, please contact <strong>03 9125 1661</strong> or email us on <a href="mailto:studentsupport@slit.edu.au" style="color:#2563eb;font-weight:bold;">studentsupport@slit.edu.au</a></li>
      </ul>
    </div>
    <p style="text-align:center;font-size:9pt;font-weight:600;text-transform:uppercase;color:#4b5563;margin-top:12px;">${esc(period)}</p>
    `)}
    <div class="induction-pdf-page-spacer" aria-hidden="true"></div>
    </div>
    <div class="induction-inner-footer"><span>Induction instructions</span><span>Page 1 of 4</span></div>
  </div>

  <div class="induction-pdf-page induction-pdf-page--checklist">
    <div class="induction-pdf-page-body">
    ${inlineHeader}
    <h2 style="text-align:center;font-size:14pt;font-weight:bold;text-transform:uppercase;color:#374151;margin:0 0 8px 0;line-height:1.15;">Student induction checklist</h2>
    ${checklistHeaderBlock}
    <table class="chk">
      <thead>
        <tr>
          <th style="text-align:left;">Information topic</th>
          <th style="width:48px;text-align:center;">Yes</th>
          <th style="width:48px;text-align:center;">No</th>
          <th style="width:100px;text-align:center;">Student initial</th>
        </tr>
      </thead>
      <tbody>
        ${checklistTbody}
      </tbody>
    </table>
    <p style="font-weight:bold;text-transform:uppercase;margin-top:10px;font-size:10pt;">Declaration</p>
    <p style="margin:4px 0;line-height:1.35;font-size:10pt;">I have attended the induction program at Skyline Institute of Technology. I acknowledge that I have understood the information mentioned above.</p>
    ${checklistDecl}
    <div class="induction-pdf-page-spacer" aria-hidden="true"></div>
    </div>
    <div class="induction-inner-footer"><span>Induction instructions</span><span>Page 2 of 4</span></div>
  </div>

  <div class="induction-pdf-page">
    <div class="induction-pdf-page-body">
    ${inlineHeader}
    <h2 style="text-align:left;font-size:18pt;font-weight:bold;color:#000;margin:0 0 8px 0;">Student Enrolment Form (International)</h2>
    <table class="form-tbl">
      <tbody>
        ${enrolmentTbody}
      </tbody>
    </table>
    <div class="induction-pdf-page-spacer" aria-hidden="true"></div>
    </div>
    <div class="induction-inner-footer"><span>Induction instructions</span><span>Page 3 of 4</span></div>
  </div>

  <div class="induction-pdf-page induction-pdf-page--media">
    <div class="induction-pdf-page-body">
    ${inlineHeader}
    <h2>F12 Photographic / Media Consent Form</h2>
    <p style="text-align:center;font-size:11pt;font-weight:bold;text-decoration:underline;margin:0 0 8px 0;">ACKNOWLEDGEMENT</p>
    <p style="margin:0 0 5px 0;">I acknowledge and understand that:</p>
    <ul class="media-ul">
      <li>SKYLINE INSTITUTE OF TECHNOLOGY may operate <strong>CCTV / video surveillance systems</strong> on campus premises for safety, security, incident prevention, and investigation purposes.</li>
      <li>Video footage may be recorded, monitored, stored, and reviewed in the event of an incident, complaint, misconduct allegation, safety concern, or official investigation.</li>
      <li>Footage may be shared with authorized personnel, regulatory bodies, or law enforcement if required by law or for investigative purposes.</li>
      <li>Surveillance is conducted to maintain a secure learning environment and to protect students, staff, and institutional property.</li>
    </ul>
    <p style="margin:8px 0 0 0;">I understand that video surveillance is a condition of being present on campus premises. By signing below, I acknowledge that I have been informed of and understand the Institute&apos;s use of CCTV surveillance for safety and security purposes.</p>
    ${mediaInner}
    <div class="induction-pdf-page-spacer" aria-hidden="true"></div>
    </div>
    <div class="induction-inner-footer"><span>Induction instructions</span><span>Page 4 of 4</span></div>
  </div>
</body>
</html>`;

  return { html };
}
