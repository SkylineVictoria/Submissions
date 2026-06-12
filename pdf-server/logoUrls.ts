import path from 'path';
import fs from 'fs';

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

function fileToDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const mime = filePath.endsWith('.png')
    ? 'png'
    : filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')
      ? 'jpeg'
      : 'png';
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

/**
 * Embed SLIT logos as data URLs so they render in Playwright setContent pages
 * and in PDF header/footer templates (file:// does not work there).
 */
export function resolveSlitLogoDataUrls(baseDir: string): { crestImg: string; textImg: string } {
  let crestImg = '';
  let textImg = '';
  try {
    const crestPath =
      resolveLogoPath(baseDir, 'logo-crest.png') ??
      resolveLogoPath(baseDir, 'logo.png') ??
      resolveLogoPath(baseDir, 'logo.jpeg') ??
      resolveLogoPath(baseDir, 'logo.jpg');
    if (crestPath) {
      crestImg = fileToDataUrl(crestPath);
    } else {
      crestImg = SVG_FALLBACK;
    }
    const textPath = resolveLogoPath(baseDir, 'logo-text.png');
    if (textPath) {
      textImg = fileToDataUrl(textPath);
    }
  } catch {
    if (!crestImg) crestImg = SVG_FALLBACK;
  }
  return { crestImg, textImg };
}

/** Alias — always returns embeddable data URLs (not file://). */
export function resolveSlitLogoUrls(baseDir: string): { crestImg: string; textImg: string } {
  return resolveSlitLogoDataUrls(baseDir);
}
