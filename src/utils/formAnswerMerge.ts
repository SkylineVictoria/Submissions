export type FormAnswersMap = Record<string, string | number | boolean | Record<string, unknown> | string[] | null | undefined>;

export type SaveValuePayload = {
  text?: string | null;
  number?: number | null;
  json?: unknown;
};

export function isEmptyFormValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return false;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return !Object.values(value as Record<string, unknown>).some((v) => !isEmptyFormValue(v));
  }
  return false;
}

export function mergeFormAnswersPreservingExisting(
  existing: FormAnswersMap | null | undefined,
  incoming: FormAnswersMap | null | undefined,
  options: { clearAllowedKeys?: string[]; source?: string } = {},
): FormAnswersMap {
  const clearAllowedKeys = new Set(options.clearAllowedKeys ?? []);
  const merged: FormAnswersMap = { ...(existing || {}) };

  for (const [key, value] of Object.entries(incoming || {})) {
    const existingValue = merged[key];
    const incomingIsEmpty = isEmptyFormValue(value);
    const existingIsNonEmpty = !isEmptyFormValue(existingValue);

    if (incomingIsEmpty && existingIsNonEmpty && !clearAllowedKeys.has(key)) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FormDataGuard] Prevented wipe of existing value', {
          key,
          existingValue,
          incomingValue: value,
          source: options.source || 'unknown',
        });
      }
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function mergeScalarPreservingExisting<T>(
  existing: T | null | undefined,
  incoming: T | null | undefined,
  allowClear: boolean,
): T | null {
  const incomingIsEmpty = incoming === undefined || incoming === null || (typeof incoming === 'string' && incoming.trim() === '');
  const existingIsNonEmpty =
    existing !== undefined && existing !== null && !(typeof existing === 'string' && existing.trim() === '');

  if (incomingIsEmpty && existingIsNonEmpty && !allowClear) {
    return existing as T;
  }
  if (incoming === undefined) return (existing ?? null) as T | null;
  return (incoming ?? null) as T | null;
}

/** Merge DB answer columns — never wipe text/json/number with empty incoming unless explicitly allowed. */
export function mergeSaveValuePreservingExisting(
  existing: SaveValuePayload | null | undefined,
  incoming: SaveValuePayload,
  options: { allowClear?: boolean; source?: string } = {},
): SaveValuePayload {
  const allowClear = Boolean(options.allowClear);
  const merged: SaveValuePayload = {
    text: mergeScalarPreservingExisting(existing?.text ?? null, incoming.text, allowClear),
    number: mergeScalarPreservingExisting(existing?.number ?? null, incoming.number, allowClear),
    json:
      incoming.json === undefined
        ? (existing?.json ?? null)
        : incoming.json === null && existing?.json != null && !allowClear
          ? existing.json
          : incoming.json,
  };

  if (
    !allowClear &&
    typeof console !== 'undefined' &&
    console.warn &&
    isEmptyFormValue(incoming.text) &&
    !isEmptyFormValue(existing?.text)
  ) {
    console.warn('[FormDataGuard] Preserved existing text value on save', {
      existingText: existing?.text,
      incomingText: incoming.text,
      source: options.source || 'saveAnswer',
    });
  }

  return merged;
}
