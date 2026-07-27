import { describe, expect, it } from 'vitest';
import {
  buildReceiptServerFileName,
  encodeSharePointPath,
  getExtensionFromFileName,
  sanitizeOriginalFileName,
  sanitizeSharePointFolderSegment,
  validateReceiptFile,
} from '../../supabase/functions/skyline-upload-payment-receipt/paymentReceiptHelpers';
import {
  extractLibraryPathSegment,
  normalizeLibraryName,
  parseLibraryAliases,
  parseSharePointSiteUrl,
  selectDriveForLibraryName,
  selectListForLibraryName,
  SharePointResolutionError,
} from '../../supabase/functions/skyline-upload-payment-receipt/sharePointResolution';

describe('paymentReceiptHelpers', () => {
  it('extracts supported extensions', () => {
    expect(getExtensionFromFileName('receipt.pdf')).toBe('pdf');
    expect(getExtensionFromFileName('receipt.JPG')).toBe('jpg');
    expect(getExtensionFromFileName('receipt.jpeg')).toBe('jpg');
    expect(getExtensionFromFileName('receipt.png')).toBe('png');
    expect(getExtensionFromFileName('receipt.exe')).toBeNull();
  });

  it('validates pdf', () => {
    const res = validateReceiptFile({
      fileName: 'bank-transfer.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      maxBytes: 10 * 1024 * 1024,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.extension).toBe('pdf');
      expect(res.normalizedMimeType).toBe('application/pdf');
    }
  });

  it('rejects exe', () => {
    const res = validateReceiptFile({
      fileName: 'evil.exe',
      mimeType: 'application/octet-stream',
      sizeBytes: 100,
      maxBytes: 10 * 1024 * 1024,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects extension/mime mismatch', () => {
    const res = validateReceiptFile({
      fileName: 'receipt.pdf',
      mimeType: 'image/png',
      sizeBytes: 100,
      maxBytes: 10 * 1024 * 1024,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects oversized file', () => {
    const res = validateReceiptFile({
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 11 * 1024 * 1024,
      maxBytes: 10 * 1024 * 1024,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FILE_TOO_LARGE');
  });

  it('sanitizes SharePoint folder segments', () => {
    expect(sanitizeSharePointFolderSegment('../abc/def')).toBe('abc_def'.replace('/', '_'));
    expect(sanitizeSharePointFolderSegment('..\\..\\test')).toBe('test');
  });

  it('sanitizes original file name', () => {
    expect(sanitizeOriginalFileName('../../evil.png')).toMatch(/evil\.png|evil_png|evil\.bin/);
  });

  it('builds controlled server file name', () => {
    const dt = new Date('2026-07-27T05:30:00Z');
    const name = buildReceiptServerFileName({
      externalStudentId: '13030243',
      paymentTransactionId: 981,
      extension: 'pdf',
      now: dt,
    });
    expect(name).toMatch(/^Receipt_13030243_981_20260727_053000\.pdf$/);
  });

  it('encodes sharepoint path segments', () => {
    expect(encodeSharePointPath(['a b', 'c/d'])).toBe(`${encodeURIComponent('a b')}/${encodeURIComponent('c/d')}`);
  });
});

describe('sharePointResolution', () => {
  it('parses SharePoint site URL into hostname and site path', () => {
    const parsed = parseSharePointSiteUrl(
      'https://skylineinstituteoftechnology.sharepoint.com/sites/SkylineSubmissions'
    );
    expect(parsed.hostname).toBe('skylineinstituteoftechnology.sharepoint.com');
    expect(parsed.sitePath).toBe('sites/SkylineSubmissions');
  });

  it('rejects invalid SharePoint site URL', () => {
    expect(() => parseSharePointSiteUrl('')).toThrow(SharePointResolutionError);
    expect(() => parseSharePointSiteUrl('not-a-url')).toThrow(SharePointResolutionError);
  });

  it('parses library aliases from SHAREPOINT_LIBRARY_NAME', () => {
    expect(parseLibraryAliases('PaymentReceipts,PaymentReciepts')).toEqual([
      'PaymentReceipts',
      'PaymentReciepts',
    ]);
  });

  it('extracts library path segment from SharePoint URL', () => {
    expect(
      extractLibraryPathSegment(
        'https://skylineinstituteoftechnology.sharepoint.com/sites/SkylineSubmissions/PaymentReciepts/Forms/AllItems.aspx'
      )
    ).toBe('PaymentReciepts');
  });

  it('normalizes library names for spaced variants', () => {
    expect(normalizeLibraryName('Payment Receipts')).toBe('paymentreceipts');
    expect(normalizeLibraryName('  PaymentReceipts  ')).toBe('paymentreceipts');
  });

  it('selects drive by library name case-insensitively', () => {
    const drive = selectDriveForLibraryName(
      [
        { id: 'drive-1', name: 'Documents' },
        { id: 'drive-2', name: 'PaymentReceipts' },
      ],
      'paymentreceipts'
    );
    expect(drive.id).toBe('drive-2');
  });

  it('selects drive when only normalized names match', () => {
    const drive = selectDriveForLibraryName(
      [{ id: 'drive-2', name: 'Payment Receipts' }],
      'PaymentReceipts'
    );
    expect(drive.id).toBe('drive-2');
  });

  it('selects drive when display title differs from URL segment via aliases', () => {
    const drive = selectDriveForLibraryName(
      [
        {
          id: 'drive-x',
          name: 'PaymentReceipts',
          webUrl:
            'https://skylineinstituteoftechnology.sharepoint.com/sites/SkylineSubmissions/PaymentReciepts/Forms/AllItems.aspx',
        },
      ],
      'PaymentReceipts,PaymentReciepts'
    );
    expect(drive.id).toBe('drive-x');
  });

  it('selects drive by webUrl path segment when Graph name uses internal spelling', () => {
    const drive = selectDriveForLibraryName(
      [
        {
          id: 'drive-x',
          name: 'PaymentReciepts',
          webUrl:
            'https://skylineinstituteoftechnology.sharepoint.com/sites/SkylineSubmissions/PaymentReciepts',
        },
      ],
      'PaymentReceipts,PaymentReciepts'
    );
    expect(drive.id).toBe('drive-x');
  });

  it('selects document library list by displayName and webUrl', () => {
    const list = selectListForLibraryName(
      [
        {
          id: 'list-1',
          name: 'PaymentReciepts',
          displayName: 'PaymentReceipts',
          webUrl:
            'https://skylineinstituteoftechnology.sharepoint.com/sites/SkylineSubmissions/PaymentReciepts/Forms/AllItems.aspx',
          isDocumentLibrary: true,
        },
      ],
      'PaymentReceipts,PaymentReciepts'
    );
    expect(list.id).toBe('list-1');
  });

  it('rejects ambiguous library matches', () => {
    expect(() =>
      selectDriveForLibraryName(
        [
          { id: 'a', name: 'PaymentReceipts' },
          { id: 'b', name: 'paymentreceipts' },
        ],
        'PaymentReceipts'
      )
    ).toThrow(SharePointResolutionError);
  });

  it('rejects missing library', () => {
    expect(() =>
      selectDriveForLibraryName([{ id: 'a', name: 'Documents' }], 'PaymentReceipts')
    ).toThrow(SharePointResolutionError);
  });
});

