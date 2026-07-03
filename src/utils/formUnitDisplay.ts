export type FormUnitDisplayInput = {
  name?: string | null;
  unit_code?: string | null;
  unit_name?: string | null;
};

export type FormUnitDisplay = {
  /** Primary heading — usually the form name. */
  title: string;
  unitCode: string | null;
  unitName: string | null;
};

function norm(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function looksLikeUnitCode(value: string): boolean {
  const t = value.trim();
  if (t.length < 5) return false;
  return /[A-Za-z]/.test(t) && /\d/.test(t);
}

/** Parse `QUAL_UNITCODE_Unit title…` form names. */
export function parseUnitFromFormName(name: string): { unitCode: string; unitName: string } | null {
  const n = norm(name);
  if (!n) return null;
  const parts = n.split('_');
  if (parts.length < 3) return null;
  const unitCode = parts[1].trim();
  const unitName = parts.slice(2).join('_').trim();
  if (!looksLikeUnitCode(unitCode) || !unitName) return null;
  return { unitCode, unitName };
}

function storedCodeMatchesName(storedCode: string, name: string): boolean {
  if (!storedCode || !name) return false;
  return name.toUpperCase().includes(storedCode.toUpperCase());
}

/**
 * Canonical unit labels for trainer navigation.
 * When stored unit_code/unit_name disagree with the form name, prefer the name
 * (form.name is the stable identifier used for submissions and documents).
 */
export function resolveFormUnitDisplay(input: FormUnitDisplayInput): FormUnitDisplay {
  const name = norm(input.name);
  const storedCode = norm(input.unit_code) || null;
  const storedName = norm(input.unit_name) || null;
  const fromName = name ? parseUnitFromFormName(name) : null;

  const useStored =
    storedCode != null && (storedCodeMatchesName(storedCode, name) || fromName?.unitCode === storedCode);

  const unitCode = useStored ? storedCode : fromName?.unitCode ?? storedCode;
  const unitName = useStored ? storedName : fromName?.unitName ?? storedName;
  const title = name || [unitCode, unitName].filter(Boolean).join(' ') || 'Unit';

  return { title, unitCode, unitName };
}
