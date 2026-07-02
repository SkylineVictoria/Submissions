import { Font } from '@react-pdf/renderer';

// Font registration for PDF generation
// Fonts should be placed in public/assets/fonts/ directory
// In dev, missing static assets can return index.html with 200; we validate bytes to avoid
// registering HTML as a "font" (which triggers "Unknown font format" from fontkit).

function isLikelyFontBytes(bytes: Uint8Array): boolean {
  // TTF: 00 01 00 00, 'true', 'typ1'
  // OTF: 'OTTO'
  // WOFF: 'wOFF'
  // WOFF2: 'wOF2'
  if (bytes.length < 4) return false;

  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];

  // 0x00010000
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;

  const tag = String.fromCharCode(b0, b1, b2, b3);
  return tag === 'OTTO' || tag === 'true' || tag === 'typ1' || tag === 'wOFF' || tag === 'wOF2';
}

async function validateFontUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load font: ${url} (${response.status})`);
    }

  // If Vite falls back to index.html, content-type is usually text/html
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`Font URL resolved to HTML (check file exists in public): ${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isLikelyFontBytes(bytes)) {
    throw new Error(`Unknown font format (bad bytes) for: ${url}`);
  }

  // Return the original URL string; @react-pdf/font expects src to be string (URL or data URL)
  return url;
}

let fontsRegistered = false;
let fontsRegistering = false;

export const registerPdfFonts = async (): Promise<void> => {
  // Prevent multiple simultaneous registrations
  if (fontsRegistered) {
    return Promise.resolve();
  }
  
  if (fontsRegistering) {
    // Wait for ongoing registration (with cap — avoid infinite wait if font fetch hangs).
    return new Promise((resolve) => {
      const started = Date.now();
      const checkInterval = setInterval(() => {
        if (fontsRegistered || Date.now() - started > 30_000) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  fontsRegistering = true;

  try {
    // Validate fonts exist and are real font bytes before registering.
    const [montserratRegular, montserratBold, interRegular, interItalic] = await Promise.all([
      validateFontUrl('/assets/fonts/Montserrat-Regular.ttf').catch(() => null),
      validateFontUrl('/assets/fonts/Montserrat-Bold.ttf').catch(() => null),
      validateFontUrl('/assets/fonts/Inter-Regular.ttf').catch(() => null),
      validateFontUrl('/assets/fonts/Inter-Italic.ttf').catch(() => null),
    ]);

    // Register Montserrat font family
    if (montserratRegular && montserratBold) {
      Font.register({
        family: 'Montserrat',
        fonts: [
          {
            src: montserratRegular,
            fontWeight: 'normal',
          },
          {
            src: montserratBold,
            fontWeight: 'bold',
          },
        ],
      });
      console.log('✅ Montserrat fonts registered');
    } else {
      console.warn('⚠️ Montserrat fonts not found, using fallback');
    }

    // Register Inter font family
    if (interRegular) {
      const interFonts: Array<{ src: string; fontWeight?: 'normal' | 'bold' | number; fontStyle?: 'normal' | 'italic' }> = [
        {
          src: interRegular,
          fontWeight: 'normal',
          fontStyle: 'normal',
        },
      ];

      // Add italic variant if available
      if (interItalic) {
        interFonts.push({
          src: interItalic,
          fontWeight: 'normal',
          fontStyle: 'italic',
        });
      }

      Font.register({
        family: 'Inter',
        fonts: interFonts,
      });
      console.log(`✅ Inter font registered${interItalic ? ' (with italic)' : ' (italic not available)'}`);
    } else {
      console.warn('⚠️ Inter font not found, using fallback');
    }

    fontsRegistered = true;
  } catch (error) {
    console.warn('Custom fonts could not be registered. Using system fonts as fallback:', error);
    fontsRegistered = true; // Mark as registered to prevent retry loops
  } finally {
    fontsRegistering = false;
  }
};

// Pre-register fonts on module load (non-blocking)
registerPdfFonts().catch(() => {
  // Silently fail - fonts will be registered when PDF is generated
});

