export type ReceiptExtension = 'pdf' | 'jpg' | 'png';

export const RECEIPT_ALLOWED_MIME_TO_EXT: Record<string, ReceiptExtension> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function getExtensionFromFileName(fileName: string): ReceiptExtension | null {
  const base = String(fileName ?? '').split(/[/\\]/).pop() ?? '';
  const m = base.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return null;
  const ext = m[1];
  if (ext === 'pdf') return 'pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'png') return 'png';
  return null;
}

export function sanitizeSharePointFolderSegment(input: string): string {
  const raw = String(input ?? '').trim();
  // SharePoint tolerates many characters, but we still prevent path-like inputs.
  const noSeparators = raw.replace(/[\\/]/g, '_');
  const noTraversal = noSeparators.replace(/\.\.+/g, '_').replace(/\.\./g, '_').replace(/\./g, '');
  const cleaned = noTraversal.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.replace(/^_+|_+$/g, '');
}

export function sanitizeOriginalFileName(originalFileName: string): string {
  const base = String(originalFileName ?? '').split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  return cleaned || 'receipt.bin';
}

export function buildReceiptServerFileName(args: {
  externalStudentId: string;
  paymentTransactionId: number | string;
  extension: ReceiptExtension;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const sec = String(now.getUTCSeconds()).padStart(2, '0');
  const safeExternalStudentId = sanitizeSharePointFolderSegment(args.externalStudentId);
  return `Receipt_${safeExternalStudentId}_${args.paymentTransactionId}_${yyyy}${mm}${dd}_${hh}${min}${sec}.${args.extension}`;
}

export function encodeSharePointPath(segments: string[]): string {
  return segments
    .map((s) => String(s ?? ''))
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

export type ValidateReceiptFileResult =
  | { ok: true; extension: ReceiptExtension; normalizedMimeType: string }
  | { ok: false; code: 'INVALID_FILE_TYPE' | 'FILE_TOO_LARGE'; message: string };

export function validateReceiptFile(args: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
}): ValidateReceiptFileResult {
  const { fileName, mimeType, sizeBytes, maxBytes } = args;

  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return { ok: false, code: 'INVALID_FILE_TYPE', message: 'Invalid receipt file size.' };
  }
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Receipt file exceeds the maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`,
    };
  }

  const ext = getExtensionFromFileName(fileName);
  const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase();
  const allowedExt = RECEIPT_ALLOWED_MIME_TO_EXT[normalizedMimeType];
  if (!ext || !allowedExt) {
    return { ok: false, code: 'INVALID_FILE_TYPE', message: 'Unsupported receipt file type.' };
  }
  if (ext !== allowedExt) {
    return { ok: false, code: 'INVALID_FILE_TYPE', message: 'Receipt file extension and MIME type mismatch.' };
  }
  return { ok: true, extension: ext, normalizedMimeType };
}

