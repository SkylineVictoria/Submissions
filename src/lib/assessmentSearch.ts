/**
 * Shared assessment search parser for Admin Assessment Directory + Trainer Dashboard.
 * Whitespace-delimited tokens; Student ID + Unit Code combine with AND.
 */

export type AssessmentSearchParsed = {
  raw: string;
  /** External campus student id (skyline_students.student_id), exact match preferred. */
  studentId: string | null;
  /** Unit of competency code (skyline_forms.unit_code); partial ILIKE match. */
  unitCode: string | null;
  /** Remaining tokens for general OR search (name, form, workflow, etc.). */
  generalTerms: string[];
  /** Joined general terms for legacy whole-string ILIKE (empty string if none). */
  generalQuery: string;
};

/** Numeric-looking campus Student ID (e.g. 13013383). */
export function isAssessmentSearchStudentIdToken(token: string): boolean {
  const t = String(token ?? '').trim();
  return /^\d{4,}$/.test(t);
}

/**
 * Unit-code-like token (e.g. CPCCCA3003, HLTAID011, CPCCOM1012).
 * Requires letters + digits; not a pure number. Do not hard-code CPC prefixes.
 */
export function isAssessmentSearchUnitCodeToken(token: string): boolean {
  const t = String(token ?? '').trim();
  if (t.length < 5) return false;
  if (/\s/.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return /[A-Za-z]/.test(t) && /\d/.test(t) && /^[A-Za-z0-9._-]+$/.test(t);
}

/**
 * Parse assessment directory / trainer dashboard search.
 *
 * Preferred: `<Student ID> <Unit Code>` (also accepts reverse order).
 * Single tokens keep existing behaviour via studentId, unitCode, or generalTerms.
 */
export function parseAssessmentSearch(searchText: string | null | undefined): AssessmentSearchParsed {
  const raw = String(searchText ?? '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw: trimmed, studentId: null, unitCode: null, generalTerms: [], generalQuery: '' };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let studentId: string | null = null;
  let unitCode: string | null = null;
  const generalTerms: string[] = [];

  if (tokens.length === 1) {
    const t = tokens[0];
    if (isAssessmentSearchStudentIdToken(t)) {
      studentId = t;
    } else if (isAssessmentSearchUnitCodeToken(t)) {
      unitCode = t;
    } else {
      generalTerms.push(t);
    }
  } else {
    // Multi-token: pick at most one student id and one unit code (order-independent).
    // Remaining tokens stay as general (e.g. "13013383 CPCCCA3003 flooring").
    for (const t of tokens) {
      if (!studentId && isAssessmentSearchStudentIdToken(t)) {
        studentId = t;
        continue;
      }
      if (!unitCode && isAssessmentSearchUnitCodeToken(t)) {
        unitCode = t;
        continue;
      }
      generalTerms.push(t);
    }

    // "AARON BINU" — no structured tokens; keep as a single general phrase for name ILIKE.
    if (!studentId && !unitCode && generalTerms.length === tokens.length) {
      return {
        raw: trimmed,
        studentId: null,
        unitCode: null,
        generalTerms: [...tokens],
        generalQuery: tokens.join(' '),
      };
    }
  }

  return {
    raw: trimmed,
    studentId,
    unitCode,
    generalTerms,
    generalQuery: generalTerms.join(' '),
  };
}
