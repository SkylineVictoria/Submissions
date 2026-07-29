export type GraphSite = {
  id: string;
  displayName?: string;
  webUrl?: string;
};

export type GraphDrive = {
  id: string;
  name: string;
  webUrl?: string;
  driveType?: string;
};

export type GraphList = {
  id: string;
  name: string;
  displayName: string;
  webUrl?: string;
  isDocumentLibrary: boolean;
};

export type SharePointErrorCode =
  | 'SHAREPOINT_CONFIG_MISSING'
  | 'SHAREPOINT_SITE_NOT_FOUND'
  | 'SHAREPOINT_LIBRARY_NOT_FOUND'
  | 'SHAREPOINT_LIBRARY_DRIVE_RESOLUTION_FAILED';

export class SharePointResolutionError extends Error {
  readonly code: SharePointErrorCode;

  constructor(code: SharePointErrorCode, message: string) {
    super(message);
    this.name = 'SharePointResolutionError';
    this.code = code;
  }
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_GRAPH_PAGES = 50;

/** Split SHAREPOINT_LIBRARY_NAME into aliases (comma/semicolon/pipe). */
export function parseLibraryAliases(libraryNameConfig: string): string[] {
  const aliases = String(libraryNameConfig ?? '')
    .split(/[,|;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set(aliases)];
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Normalize for comparison: trim, lowercase, decode URI, remove spaces. */
export function normalizeLibraryName(value: string): string {
  return decodeSafe(String(value ?? '').trim())
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Last meaningful SharePoint library segment from a library/drive URL. */
export function extractLibraryPathSegment(webUrl: string | undefined): string | null {
  const raw = String(webUrl ?? '').trim();
  if (!raw) return null;

  try {
    const pathname = new URL(raw).pathname;
    const parts = pathname
      .split('/')
      .map((part) => decodeSafe(part.trim()))
      .filter((part) => part.length > 0);

    const filtered = parts.filter(
      (part) => !/^forms$/i.test(part) && !/^allitems\.aspx$/i.test(part) && !/^sitepages$/i.test(part)
    );

    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
  } catch {
    const withoutQuery = raw.split('?')[0] ?? '';
    const parts = withoutQuery
      .split('/')
      .map((part) => decodeSafe(part.trim()))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }
}

function exactLibraryNameMatch(candidate: string, alias: string): boolean {
  return candidate.trim().toLowerCase() === alias.trim().toLowerCase();
}

function normalizedLibraryNameMatch(candidate: string, alias: string): boolean {
  return normalizeLibraryName(candidate) === normalizeLibraryName(alias);
}

type MatchQuality = 'exact' | 'normalized';

function matchCandidatesToAliases(candidates: string[], aliases: string[]): MatchQuality | null {
  const uniqueCandidates = [...new Set(candidates.map((c) => c.trim()).filter(Boolean))];
  if (uniqueCandidates.length === 0 || aliases.length === 0) return null;

  for (const candidate of uniqueCandidates) {
    for (const alias of aliases) {
      if (exactLibraryNameMatch(candidate, alias)) return 'exact';
    }
  }

  for (const candidate of uniqueCandidates) {
    for (const alias of aliases) {
      if (normalizedLibraryNameMatch(candidate, alias)) return 'normalized';
    }
  }

  return null;
}

function collectDriveMatchCandidates(drive: GraphDrive): string[] {
  const candidates = new Set<string>();
  if (drive.name) candidates.add(drive.name);
  const segment = extractLibraryPathSegment(drive.webUrl);
  if (segment) candidates.add(segment);
  return [...candidates];
}

function collectListMatchCandidates(list: GraphList): string[] {
  const candidates = new Set<string>();
  if (list.displayName) candidates.add(list.displayName);
  if (list.name) candidates.add(list.name);
  const segment = extractLibraryPathSegment(list.webUrl);
  if (segment) candidates.add(segment);
  return [...candidates];
}

function driveMatchesLibrary(drive: GraphDrive, aliases: string[]): MatchQuality | null {
  return matchCandidatesToAliases(collectDriveMatchCandidates(drive), aliases);
}

function listMatchesLibrary(list: GraphList, aliases: string[]): MatchQuality | null {
  return matchCandidatesToAliases(collectListMatchCandidates(list), aliases);
}

function selectUniqueMatch<T>(
  items: T[],
  aliases: string[],
  matcher: (item: T, aliases: string[]) => MatchQuality | null,
  label: string
): T {
  if (aliases.length === 0) {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SHAREPOINT_LIBRARY_NAME is required.');
  }

  const exactMatches = items.filter((item) => matcher(item, aliases) === 'exact');
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new SharePointResolutionError(
      'SHAREPOINT_LIBRARY_NOT_FOUND',
      `Multiple document libraries matched "${label}".`
    );
  }

  const normalizedMatches = items.filter((item) => matcher(item, aliases) === 'normalized');
  if (normalizedMatches.length === 1) return normalizedMatches[0];
  if (normalizedMatches.length > 1) {
    throw new SharePointResolutionError(
      'SHAREPOINT_LIBRARY_NOT_FOUND',
      `Multiple document libraries matched "${label}".`
    );
  }

  throw new SharePointResolutionError(
    'SHAREPOINT_LIBRARY_NOT_FOUND',
    `Document library not found: ${label}.`
  );
}

/** Pick a drive using name, webUrl path segment, and configured aliases. */
export function selectDriveForLibraryName(drives: GraphDrive[], libraryNameConfig: string): GraphDrive {
  const aliases = parseLibraryAliases(libraryNameConfig);
  const label = aliases.join(', ') || libraryNameConfig;
  return selectUniqueMatch(drives, aliases, driveMatchesLibrary, label);
}

export function selectListForLibraryName(lists: GraphList[], libraryNameConfig: string): GraphList {
  const aliases = parseLibraryAliases(libraryNameConfig);
  const label = aliases.join(', ') || libraryNameConfig;

  const documentLibraries = lists.filter((l) => l.isDocumentLibrary);
  try {
    return selectUniqueMatch(documentLibraries, aliases, listMatchesLibrary, label);
  } catch (e) {
    if (
      e instanceof SharePointResolutionError &&
      e.code === 'SHAREPOINT_LIBRARY_NOT_FOUND' &&
      documentLibraries.length < lists.length
    ) {
      return selectUniqueMatch(lists, aliases, listMatchesLibrary, label);
    }
    throw e;
  }
}

async function fetchGraphCollection<T>(
  initialUrl: string,
  graphToken: string,
  mapItem: (row: Record<string, unknown>) => T | null
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = initialUrl;
  let pages = 0;

  while (url && pages < MAX_GRAPH_PAGES) {
    pages += 1;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${graphToken}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[sharePointResolution] Graph collection request failed', {
        status: res.status,
        url: url.split('?')[0],
        bodyPreview: text.slice(0, 250),
      });
      throw new SharePointResolutionError(
        'SHAREPOINT_LIBRARY_NOT_FOUND',
        'Could not list SharePoint document libraries.'
      );
    }

    const json = (await res.json().catch(() => ({}))) as {
      value?: Array<Record<string, unknown>>;
      '@odata.nextLink'?: string;
    };

    for (const row of json.value ?? []) {
      const mapped = mapItem(row);
      if (mapped != null) items.push(mapped);
    }

    url = typeof json['@odata.nextLink'] === 'string' ? json['@odata.nextLink'] : null;
  }

  return items;
}

function mapGraphDrive(row: Record<string, unknown>): GraphDrive | null {
  const id = String(row.id ?? '').trim();
  const name = String(row.name ?? '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    webUrl: row.webUrl != null ? String(row.webUrl) : undefined,
    driveType: row.driveType != null ? String(row.driveType) : undefined,
  };
}

function mapGraphList(row: Record<string, unknown>): GraphList | null {
  const id = String(row.id ?? '').trim();
  const name = String(row.name ?? '').trim();
  const displayName = String(row.displayName ?? row.name ?? '').trim();
  if (!id || !displayName) return null;

  const listMeta = row.list as { template?: string } | undefined;
  const template = String(listMeta?.template ?? '').toLowerCase();
  const isDocumentLibrary = template === 'documentlibrary' || template === 'document library';

  return {
    id,
    name: name || displayName,
    displayName,
    webUrl: row.webUrl != null ? String(row.webUrl) : undefined,
    isDocumentLibrary,
  };
}

async function fetchSiteDrives(siteId: string, graphToken: string): Promise<GraphDrive[]> {
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`;
  return fetchGraphCollection(url, graphToken, mapGraphDrive);
}

async function fetchSiteLists(siteId: string, graphToken: string): Promise<GraphList[]> {
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/lists?$select=id,name,displayName,webUrl,list`;
  return fetchGraphCollection(url, graphToken, mapGraphList);
}

async function fetchDriveForList(siteId: string, listId: string, graphToken: string): Promise<GraphDrive> {
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/drive`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${graphToken}` },
  });

  if (!res.ok) {
    console.error('[sharePointResolution] list drive resolution failed', {
      siteId,
      listId,
      status: res.status,
    });
    throw new SharePointResolutionError(
      'SHAREPOINT_LIBRARY_DRIVE_RESOLUTION_FAILED',
      'The payment receipt library could not be resolved for upload.'
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const drive = mapGraphDrive(json);
  if (!drive) {
    throw new SharePointResolutionError(
      'SHAREPOINT_LIBRARY_DRIVE_RESOLUTION_FAILED',
      'The payment receipt library could not be resolved for upload.'
    );
  }
  return drive;
}

function logResolutionFailure(params: {
  libraryNameConfig: string;
  aliases: string[];
  drives: GraphDrive[];
  lists: GraphList[];
}): void {
  console.error('SharePoint library resolution failed', {
    requestedLibrary: params.libraryNameConfig,
    requestedAliases: params.aliases,
    drives: params.drives.map((d) => ({
      name: d.name,
      webUrl: d.webUrl,
      pathSegment: extractLibraryPathSegment(d.webUrl),
    })),
    lists: params.lists.map((l) => ({
      name: l.name,
      displayName: l.displayName,
      webUrl: l.webUrl,
      pathSegment: extractLibraryPathSegment(l.webUrl),
      isDocumentLibrary: l.isDocumentLibrary,
    })),
  });
}

/** Parse SHAREPOINT_SITE_URL into Graph site lookup parts (matches pdf-server/sharepointUpload). */
export function parseSharePointSiteUrl(siteUrl: string): { hostname: string; sitePath: string } {
  const trimmed = String(siteUrl ?? '').trim();
  if (!trimmed) {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SHAREPOINT_SITE_URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SHAREPOINT_SITE_URL is invalid.');
  }

  const hostname = parsed.hostname.trim();
  const sitePath = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!hostname || !sitePath) {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SHAREPOINT_SITE_URL is invalid.');
  }

  return { hostname, sitePath };
}

export async function resolveSharePointSite(params: {
  siteUrl: string;
  graphToken: string;
}): Promise<GraphSite> {
  const { hostname, sitePath } = parseSharePointSiteUrl(params.siteUrl);
  const url = `${GRAPH_BASE}/sites/${hostname}:/${sitePath}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.graphToken}` },
  });

  if (!res.ok) {
    throw new SharePointResolutionError(
      'SHAREPOINT_SITE_NOT_FOUND',
      'The configured SharePoint site could not be resolved.'
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    displayName?: string;
    webUrl?: string;
  };

  const id = String(json.id ?? '').trim();
  if (!id) {
    throw new SharePointResolutionError(
      'SHAREPOINT_SITE_NOT_FOUND',
      'The configured SharePoint site could not be resolved.'
    );
  }

  return {
    id,
    displayName: json.displayName != null ? String(json.displayName) : undefined,
    webUrl: json.webUrl != null ? String(json.webUrl) : undefined,
  };
}

export async function resolveSharePointDrive(params: {
  siteId: string;
  libraryName: string;
  graphToken: string;
}): Promise<GraphDrive> {
  const siteId = String(params.siteId ?? '').trim();
  const libraryNameConfig = String(params.libraryName ?? '').trim();
  const aliases = parseLibraryAliases(libraryNameConfig);

  if (!siteId) {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SharePoint site id is required.');
  }
  if (aliases.length === 0) {
    throw new SharePointResolutionError('SHAREPOINT_CONFIG_MISSING', 'SHAREPOINT_LIBRARY_NAME is required.');
  }

  let drives: GraphDrive[] = [];
  try {
    drives = await fetchSiteDrives(siteId, params.graphToken);
    return selectDriveForLibraryName(drives, libraryNameConfig);
  } catch (e) {
    if (e instanceof SharePointResolutionError) {
      if (e.message.includes('Multiple document libraries')) throw e;
      if (e.code !== 'SHAREPOINT_LIBRARY_NOT_FOUND') throw e;
    } else {
      throw e;
    }
  }

  let lists: GraphList[] = [];
  try {
    lists = await fetchSiteLists(siteId, params.graphToken);
    const matchedList = selectListForLibraryName(lists, libraryNameConfig);
    return await fetchDriveForList(siteId, matchedList.id, params.graphToken);
  } catch (e) {
    if (e instanceof SharePointResolutionError) {
      if (e.message.includes('Multiple document libraries')) throw e;
      if (e.code === 'SHAREPOINT_LIBRARY_DRIVE_RESOLUTION_FAILED') throw e;
    } else {
      throw e;
    }
  }

  logResolutionFailure({ libraryNameConfig, aliases, drives, lists });

  throw new SharePointResolutionError(
    'SHAREPOINT_LIBRARY_NOT_FOUND',
    `Document library not found: ${libraryNameConfig}.`
  );
}
