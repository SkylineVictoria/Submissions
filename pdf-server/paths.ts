import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(__filename);

/**
 * pdf-server package root.
 * - tsx watch: module lives beside index.ts → this directory
 * - node dist/index.js: paths module is in dist/ → parent of dist/
 */
export const serverDir =
  path.basename(moduleDir) === 'dist' ? path.dirname(moduleDir) : moduleDir;

/** Monorepo / repo root (parent of pdf-server). */
export const projectRoot = path.join(serverDir, '..');

/** Logo/static assets — pdf-server/public, then repo public/. */
export function resolvePublicDir(): string {
  const local = path.join(serverDir, 'public');
  const rootPublic = path.join(projectRoot, 'public');
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(rootPublic)) return rootPublic;
  return local;
}

export const publicDir = resolvePublicDir();

/** @deprecated Use publicDir — kept for callers passing _basePath into buildHtml. */
export function getAssetBasePath(): string {
  return serverDir;
}
