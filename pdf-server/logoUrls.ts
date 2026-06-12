import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

export function resolveLogoPath(baseDir: string, filename: string): string | null {
  const dirs = [path.join(baseDir, 'public'), path.join(baseDir, '..', 'public')];
  for (const dir of dirs) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SVG_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><text x="10" y="55" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#f97316">SKYLINE</text></svg>'
  );

/**
 * Prefer file:// logo URLs in PDF HTML (avoids duplicating base64 in a 10MB document).
 * Playwright loads these from disk when rendering setContent pages.
 */
export function resolveSlitLogoUrls(baseDir: string): { crestImg: string; textImg: string } {
  let crestImg = '';
  let textImg = '';
  try {
    const crestPath =
      resolveLogoPath(baseDir, 'logo-crest.png') ??
      resolveLogoPath(baseDir, 'logo.png') ??
      resolveLogoPath(baseDir, 'logo.jpeg') ??
      resolveLogoPath(baseDir, 'logo.jpg');
    if (crestPath) {
      crestImg = pathToFileURL(crestPath).href;
    } else {
      crestImg = SVG_FALLBACK;
    }
    const textPath = resolveLogoPath(baseDir, 'logo-text.png');
    if (textPath) {
      textImg = pathToFileURL(textPath).href;
    }
  } catch {
    if (!crestImg) crestImg = SVG_FALLBACK;
  }
  return { crestImg, textImg };
}

/** @deprecated Use resolveSlitLogoUrls — kept for inductionHtml import name. */
export function resolveSlitLogoDataUrls(baseDir: string): { crestImg: string; textImg: string } {
  return resolveSlitLogoUrls(baseDir);
}
