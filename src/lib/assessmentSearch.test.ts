import { describe, expect, it } from 'vitest';
import {
  isAssessmentSearchStudentIdToken,
  isAssessmentSearchUnitCodeToken,
  parseAssessmentSearch,
} from './assessmentSearch';

describe('assessmentSearch tokens', () => {
  it('recognises numeric student ids', () => {
    expect(isAssessmentSearchStudentIdToken('13013383')).toBe(true);
    expect(isAssessmentSearchStudentIdToken('12944626')).toBe(true);
    expect(isAssessmentSearchStudentIdToken('123')).toBe(false);
    expect(isAssessmentSearchStudentIdToken('CPCCCA3003')).toBe(false);
  });

  it('recognises unit codes without hard-coding CPC', () => {
    expect(isAssessmentSearchUnitCodeToken('CPCCCA3003')).toBe(true);
    expect(isAssessmentSearchUnitCodeToken('cpccca3003')).toBe(true);
    expect(isAssessmentSearchUnitCodeToken('HLTAID011')).toBe(true);
    expect(isAssessmentSearchUnitCodeToken('CPCCOM1012')).toBe(true);
    expect(isAssessmentSearchUnitCodeToken('13013383')).toBe(false);
    expect(isAssessmentSearchUnitCodeToken('AARON')).toBe(false);
    expect(isAssessmentSearchUnitCodeToken('flooring')).toBe(false);
  });
});

describe('parseAssessmentSearch', () => {
  it('parses empty / whitespace-only', () => {
    expect(parseAssessmentSearch('')).toMatchObject({
      studentId: null,
      unitCode: null,
      generalQuery: '',
    });
    expect(parseAssessmentSearch('   ')).toMatchObject({
      studentId: null,
      unitCode: null,
      generalQuery: '',
    });
  });

  it('parses student id only', () => {
    const r = parseAssessmentSearch('13013383');
    expect(r.studentId).toBe('13013383');
    expect(r.unitCode).toBeNull();
    expect(r.generalTerms).toEqual([]);
  });

  it('parses unit code only', () => {
    const r = parseAssessmentSearch('CPCCCA3003');
    expect(r.studentId).toBeNull();
    expect(r.unitCode).toBe('CPCCCA3003');
    expect(r.generalTerms).toEqual([]);
  });

  it('parses student id + unit code (preferred order)', () => {
    const r = parseAssessmentSearch('13013383 CPCCCA3003');
    expect(r.studentId).toBe('13013383');
    expect(r.unitCode).toBe('CPCCCA3003');
    expect(r.generalTerms).toEqual([]);
  });

  it('parses unit code + student id (reverse order)', () => {
    const r = parseAssessmentSearch('CPCCCA3003 13013383');
    expect(r.studentId).toBe('13013383');
    expect(r.unitCode).toBe('CPCCCA3003');
  });

  it('normalises multiple / leading / trailing whitespace', () => {
    const a = parseAssessmentSearch('13013383      CPCCCA3003');
    const b = parseAssessmentSearch('  13013383 CPCCCA3003  ');
    expect(a.studentId).toBe('13013383');
    expect(a.unitCode).toBe('CPCCCA3003');
    expect(b.studentId).toBe('13013383');
    expect(b.unitCode).toBe('CPCCCA3003');
  });

  it('preserves lowercase unit code token (comparison is case-insensitive downstream)', () => {
    const r = parseAssessmentSearch('13013383 cpccca3003');
    expect(r.studentId).toBe('13013383');
    expect(r.unitCode).toBe('cpccca3003');
  });

  it('keeps name phrases as general query', () => {
    const r = parseAssessmentSearch('AARON BINU');
    expect(r.studentId).toBeNull();
    expect(r.unitCode).toBeNull();
    expect(r.generalQuery).toBe('AARON BINU');
    expect(r.generalTerms).toEqual(['AARON', 'BINU']);
  });

  it('keeps single name as general', () => {
    const r = parseAssessmentSearch('Vishal');
    expect(r.studentId).toBeNull();
    expect(r.unitCode).toBeNull();
    expect(r.generalQuery).toBe('Vishal');
  });

  it('supports student + unit + remaining general term', () => {
    const r = parseAssessmentSearch('13013383 CPCCCA3003 flooring');
    expect(r.studentId).toBe('13013383');
    expect(r.unitCode).toBe('CPCCCA3003');
    expect(r.generalQuery).toBe('flooring');
  });

  it('treats form/unit name phrase as general', () => {
    const r = parseAssessmentSearch('Install flooring systems');
    expect(r.studentId).toBeNull();
    expect(r.unitCode).toBeNull();
    expect(r.generalQuery).toBe('Install flooring systems');
  });
});
