import { logMemory } from './pdfMemory.js';
import { buildSharePointStoragePath, sanitizeSharePointFolderSegment } from './pdfFileNaming.js';

export const SHAREPOINT_UPLOAD_TIMEOUT_MS = 60_000;

export type SharePointUploadOptions = {
  fileName: string;
  unitCode?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export type SharePointUploadResult = {
  webUrl: string;
  publicUrl: string | null;
  driveItemId: string;
  siteId: string;
  driveId: string;
  storagePath: string;
};

type GraphTokenResponse = { access_token?: string; error?: string; error_description?: string };

function requireEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseSiteUrl(siteUrl: string): { hostname: string; sitePath: string } {
  const u = new URL(siteUrl);
  const hostname = u.hostname;
  const sitePath = u.pathname.replace(/^\/+/, '');
  if (!hostname || !sitePath) {
    throw new Error(`Invalid SHAREPOINT_SITE_URL: ${siteUrl}`);
  }
  return { hostname, sitePath };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getGraphAccessToken(): Promise<string> {
  const tenantId = requireEnv('SHAREPOINT_TENANT_ID');
  const clientId = requireEnv('SHAREPOINT_CLIENT_ID');
  const clientSecret = requireEnv('SHAREPOINT_CLIENT_SECRET');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetchWithTimeout(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
  );
  const json = (await res.json()) as GraphTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Graph token error HTTP ${res.status}`);
  }
  return json.access_token;
}

/**
 * Upload PDF buffer to SharePoint via Microsoft Graph (client credentials).
 * Public link creation is optional — upload succeeds even when anonymous links are disabled.
 */
export async function uploadPdfToSharePoint(
  buffer: Buffer,
  options: SharePointUploadOptions,
): Promise<SharePointUploadResult> {
  return withTimeout(
    uploadPdfToSharePointWork(buffer, options),
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
    () => new Error(`SharePoint upload timed out after ${SHAREPOINT_UPLOAD_TIMEOUT_MS}ms`),
  );
}

async function uploadPdfToSharePointWork(
  buffer: Buffer,
  options: SharePointUploadOptions,
): Promise<SharePointUploadResult> {
  const fileName = String(options.fileName ?? '').trim();
  if (!fileName) throw new Error('SharePoint upload fileName is required');

  logMemory(`sharepoint-upload-start file=${fileName} unit=${options.unitCode ?? ''} bytes=${buffer.length}`);
  const token = await getGraphAccessToken();
  const siteUrl = requireEnv('SHAREPOINT_SITE_URL');
  const libraryName = requireEnv('SHAREPOINT_LIBRARY_NAME');
  const folderPath = String(process.env.SHAREPOINT_FOLDER_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
  const { hostname, sitePath } = parseSiteUrl(siteUrl);

  const headers = { Authorization: `Bearer ${token}` };

  const siteRes = await fetchWithTimeout(
    `https://graph.microsoft.com/v1.0/sites/${hostname}:/${sitePath}`,
    { headers },
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
  );
  if (!siteRes.ok) {
    throw new Error(`Graph site resolve failed HTTP ${siteRes.status}: ${await siteRes.text()}`);
  }
  const siteJson = (await siteRes.json()) as { id?: string };
  const siteId = siteJson.id;
  if (!siteId) throw new Error('Graph site id missing');

  const drivesRes = await fetchWithTimeout(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`,
    { headers },
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
  );
  if (!drivesRes.ok) {
    throw new Error(`Graph drives list failed HTTP ${drivesRes.status}`);
  }
  const drivesJson = (await drivesRes.json()) as { value?: Array<{ id?: string; name?: string }> };
  const drive = (drivesJson.value ?? []).find(
    (d) => String(d.name ?? '').toLowerCase() === libraryName.toLowerCase(),
  );
  if (!drive?.id) {
    throw new Error(`Drive/library not found: ${libraryName}`);
  }
  const driveId = drive.id;

  const storagePath = buildSharePointStoragePath({
    baseFolderPath: folderPath,
    unitCode: options.unitCode,
    fileName,
  });
  await ensureSharePointFolderExists(driveId, folderPath, options.unitCode, headers);
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeSharePointPath(storagePath)}:/content`;

  const uploadRes = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/pdf' },
      body: new Uint8Array(buffer),
    },
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
  );
  if (!uploadRes.ok) {
    throw new Error(`SharePoint upload failed HTTP ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 400)}`);
  }
  const item = (await uploadRes.json()) as { id?: string; webUrl?: string };
  if (!item.id || !item.webUrl) {
    throw new Error('SharePoint upload response missing id/webUrl');
  }

  let publicUrl: string | null = null;
  const createPublic = String(process.env.SHAREPOINT_CREATE_PUBLIC_LINK ?? 'false').toLowerCase() === 'true';
  if (createPublic) {
    try {
      const linkRes = await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${item.id}/createLink`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
        },
        SHAREPOINT_UPLOAD_TIMEOUT_MS,
      );
      if (linkRes.ok) {
        const linkJson = (await linkRes.json()) as { link?: { webUrl?: string } };
        publicUrl = linkJson.link?.webUrl ?? null;
      } else {
        console.warn(
          '[sharepoint] Public link creation failed (tenant may disallow anonymous links):',
          await linkRes.text(),
        );
      }
    } catch (e) {
      console.warn('[sharepoint] Public link creation error (non-fatal):', e);
    }
  }

  logMemory(`sharepoint-upload-done path=${storagePath}`);
  return {
    webUrl: item.webUrl,
    publicUrl,
    driveItemId: item.id,
    siteId,
    driveId,
    storagePath,
  };
}

function encodeSharePointPath(relativePath: string): string {
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Ensure unit-code folder exists under the library base path (creates if missing). */
async function ensureSharePointFolderExists(
  driveId: string,
  baseFolderPath: string,
  unitCode: string | undefined,
  headers: Record<string, string>,
): Promise<void> {
  const unitFolder = sanitizeSharePointFolderSegment(String(unitCode ?? ''));
  if (!unitFolder) return;

  const folderSegments = [baseFolderPath, unitFolder].filter(Boolean);
  const folderPath = folderSegments.join('/');
  const checkUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeSharePointPath(folderPath)}`;

  const existing = await fetchWithTimeout(checkUrl, { headers }, SHAREPOINT_UPLOAD_TIMEOUT_MS);
  if (existing.ok) return;

  const parentSegments = baseFolderPath ? [baseFolderPath] : [];
  const parentPath = parentSegments.join('/');
  const createUrl = parentPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeSharePointPath(parentPath)}:/children`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;

  const createRes = await fetchWithTimeout(
    createUrl,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: unitFolder,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    },
    SHAREPOINT_UPLOAD_TIMEOUT_MS,
  );

  if (createRes.ok || createRes.status === 409) return;

  const errText = await createRes.text();
  throw new Error(`SharePoint unit folder create failed HTTP ${createRes.status}: ${errText.slice(0, 300)}`);
}
