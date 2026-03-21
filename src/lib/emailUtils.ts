/** Institutional email domains - only these are allowed for login */
const STUDENT_DOMAIN = '@student.slit.edu.au';
const STAFF_DOMAIN = '@slit.edu.au';

/** Master admin email - bypasses institutional domain check for login */
export const MASTER_EMAIL = 'gourav.gupta@siyanainfo.com';

const toTitleCase = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

/** Build student email from first + last name: Hardik.Amin@student.slit.edu.au */
export function buildStudentEmail(firstName: string, lastName: string): string {
  const first = toTitleCase(firstName).replace(/\s+/g, '');
  const last = toTitleCase(lastName).replace(/\s+/g, '');
  if (!first || !last) return '';
  return `${first}.${last}${STUDENT_DOMAIN}`.toLowerCase();
}

/** Build staff/user email from full name: Hardik Amin -> hardik.amin@slit.edu.au */
export function buildUserEmail(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  const first = toTitleCase(parts[0]).replace(/\s+/g, '');
  const last = parts
    .slice(1)
    .map((w) => toTitleCase(w).replace(/\s+/g, ''))
    .join('');
  return `${first}.${last}${STAFF_DOMAIN}`.toLowerCase();
}

/** Check if email is valid institutional (student or staff) or master - used for login */
export function isValidInstitutionalEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (e === MASTER_EMAIL.toLowerCase()) return true;
  return e.endsWith(STUDENT_DOMAIN) || e.endsWith(STAFF_DOMAIN);
}

/** Extract local part from student email for editing (part before @student.slit.edu.au) */
export function getStudentEmailLocalPart(email: string): string {
  const e = (email || '').trim();
  if (e.toLowerCase().endsWith(STUDENT_DOMAIN)) {
    return e.slice(0, -STUDENT_DOMAIN.length).trim();
  }
  return e.includes('@') ? e.split('@')[0] : e;
}

/** Build full student email from local part - domain is fixed */
export function buildStudentEmailFromLocal(localPart: string): string {
  const local = (localPart || '').trim().toLowerCase().replace(/\s+/g, '');
  return local ? `${local}${STUDENT_DOMAIN}` : '';
}

/** Extract local part from staff/user email for editing (part before @slit.edu.au) */
export function getUserEmailLocalPart(email: string): string {
  const e = (email || '').trim();
  if (e.toLowerCase().endsWith(STAFF_DOMAIN)) {
    return e.slice(0, -STAFF_DOMAIN.length).trim();
  }
  return e.includes('@') ? e.split('@')[0] : e;
}

/** Build full staff/user email from local part - domain is fixed */
export function buildUserEmailFromLocal(localPart: string): string {
  const local = (localPart || '').trim().toLowerCase().replace(/\s+/g, '');
  return local ? `${local}${STAFF_DOMAIN}` : '';
}

/** Build email from local part and selected domain */
export function buildEmailFromLocalAndDomain(
  localPart: string,
  domain: typeof STUDENT_DOMAIN | typeof STAFF_DOMAIN
): string {
  const local = (localPart || '').trim().toLowerCase().replace(/\s+/g, '');
  return local ? `${local}${domain}` : '';
}

/** Get institutional domain from email (for edit forms) */
export function getInstitutionalDomainFromEmail(
  email: string
): typeof STUDENT_DOMAIN | typeof STAFF_DOMAIN | null {
  const e = (email || '').trim().toLowerCase();
  if (e.endsWith(STUDENT_DOMAIN)) return STUDENT_DOMAIN;
  if (e.endsWith(STAFF_DOMAIN)) return STAFF_DOMAIN;
  return null;
}

/** Extract local part from any institutional email (handles both domains) */
export function getEmailLocalPartForEdit(email: string): string {
  const e = (email || '').trim();
  if (e.toLowerCase().endsWith(STUDENT_DOMAIN)) return e.slice(0, -STUDENT_DOMAIN.length).trim();
  if (e.toLowerCase().endsWith(STAFF_DOMAIN)) return e.slice(0, -STAFF_DOMAIN.length).trim();
  return e.includes('@') ? e.split('@')[0] : e;
}

/** Union type for institutional email domains */
export type InstitutionalDomain = typeof STUDENT_DOMAIN | typeof STAFF_DOMAIN;

export { STUDENT_DOMAIN, STAFF_DOMAIN };
