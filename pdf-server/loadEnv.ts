import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { serverDir } from './paths.js';

/** Trim whitespace — handles "KEY= value" lines in .env files. */
export function envTrim(name: string): string {
  return String(process.env[name] ?? '').trim();
}

/**
 * Load pdf-server environment variables.
 * 1. pdf-server/.env (path.resolve(process.cwd(), ".env") when run from pdf-server, or module-adjacent .env)
 * 2. ../.env (repo root) only when pdf-server/.env does not exist
 */
export function loadPdfServerEnv(): string {
  const pdfServerEnvByModule = path.join(serverDir, '.env');
  const pdfServerEnvByCwd = path.resolve(process.cwd(), '.env');
  const parentEnv = path.join(serverDir, '..', '.env');

  let envPath: string | null = null;

  if (fs.existsSync(pdfServerEnvByModule)) {
    envPath = pdfServerEnvByModule;
  } else if (
    fs.existsSync(pdfServerEnvByCwd) &&
    path.resolve(path.dirname(pdfServerEnvByCwd)) === path.resolve(serverDir)
  ) {
    envPath = pdfServerEnvByCwd;
  } else if (fs.existsSync(parentEnv)) {
    envPath = parentEnv;
  }

  if (!envPath) {
    console.warn('[pdf-server] No .env file found (checked pdf-server/.env and ../.env); using process env only');
    return '';
  }

  const result = config({ path: envPath, quiet: true });
  if (result.error) {
    console.error(`[pdf-server] Failed to load env from ${envPath}:`, result.error.message);
    process.exit(1);
  }

  const fallback = envPath === parentEnv ? ' (fallback)' : '';
  console.log(`[pdf-server] Loaded environment from ${envPath}${fallback}`);

  const hasWorkerSecret = Boolean(envTrim('PDF_WORKER_SECRET'));
  console.log(
    `[pdf-server] Env keys present: SUPABASE_URL=${Boolean(envTrim('SUPABASE_URL'))}, ` +
      `SUPABASE_SERVICE_ROLE_KEY=${Boolean(envTrim('SUPABASE_SERVICE_ROLE_KEY'))}, ` +
      `PDF_WORKER_SECRET=${hasWorkerSecret}`,
  );

  return envPath;
}
