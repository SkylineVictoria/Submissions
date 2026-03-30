import React, { useState } from 'react';

/**
 * Matches pdf-server `buildSlitPdfHeaderHtml`: crest left, logo-text centred, address right,
 * Calibri, rule at 110px (#8b95a5).
 */
export const SlitDocumentHeader: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [crestErr, setCrestErr] = useState(false);
  const [textErr, setTextErr] = useState(false);

  const address = (
    <>
      <div>Level 8, 310 King Street</div>
      <div>Melbourne VIC – 3000</div>
      <div className="mt-1">RTO: 45989 CRICOS: 04114B</div>
      <div className="mt-1">
        Email:{' '}
        <a href="mailto:info@slit.edu.au" className="text-[#2563eb] underline">
          info@slit.edu.au
        </a>
      </div>
      <div>Phone: +61 3 9125 1661</div>
    </>
  );

  const textFallback = (
    <div className="flex flex-col items-center text-center">
      <span className="text-[22pt] font-bold tracking-[2px] text-[#f97316]">SKYLINE</span>
      <span className="mt-0.5 text-[9pt] font-semibold tracking-[2px] text-[#374151]">
        INSTITUTE OF TECHNOLOGY
      </span>
    </div>
  );

  return (
    <header
      className={`font-[Calibri,'Calibri_Light',Arial,sans-serif] font-normal leading-tight text-[#374151] ${className}`}
    >
      {/* Match assessment PDF: one rule at 110px behind crest (z-0 line, z-1 crest); no extra border-b/pb below logo */}
      {/* Grid (not all-absolute): centered logo had w-auto with no max-width and overlapped the address in Chrome */}
      <div className="relative mb-2 hidden min-h-[165px] w-full md:grid md:grid-cols-[minmax(0,210px)_minmax(0,1fr)_minmax(0,250px)] md:items-start md:gap-x-3">
        <div className="pointer-events-none absolute left-0 right-0 top-[110px] z-0 h-0 border-t border-[#8b95a5]" aria-hidden />
        <div className="relative z-[1] shrink-0">
          {!crestErr ? (
            <img
              src="/logo-crest.png"
              alt="Skyline Institute of Technology"
              className="block h-[165px] w-[210px] max-w-full object-contain"
              onError={() => setCrestErr(true)}
            />
          ) : (
            <img
              src="/logo.jpg"
              alt="Skyline Institute of Technology"
              className="block h-[165px] w-[210px] max-w-full object-contain"
            />
          )}
        </div>
        <div className="relative z-[1] flex min-w-0 justify-center px-1 pt-[18px]">
          {!textErr ? (
            <img
              src="/logo-text.png"
              alt="SKYLINE INSTITUTE OF TECHNOLOGY"
              className="block h-[100px] max-h-[100px] w-auto max-w-full object-contain object-center"
              onError={() => setTextErr(true)}
            />
          ) : (
            <div className="min-w-0 max-w-full text-center">{textFallback}</div>
          )}
        </div>
        <address className="relative z-[1] w-full min-w-0 pt-2 text-right text-[10pt] font-light leading-[1.25] not-italic">
          {address}
        </address>
      </div>

      <div className="mb-2 flex flex-col gap-2 border-b border-[#8b95a5] pb-2 md:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="shrink-0">
            {!crestErr ? (
              <img
                src="/logo-crest.png"
                alt="Skyline Institute of Technology"
                className="block h-auto max-h-[140px] w-[min(210px,55vw)] object-contain"
                onError={() => setCrestErr(true)}
              />
            ) : (
              <img
                src="/logo.jpg"
                alt="Skyline Institute of Technology"
                className="block h-auto max-h-[140px] w-[min(210px,55vw)] object-contain"
              />
            )}
          </div>
          <address className="max-w-[250px] text-right text-[10pt] font-light leading-[1.25] not-italic">{address}</address>
        </div>
        <div className="flex justify-center">
          {!textErr ? (
            <img
              src="/logo-text.png"
              alt="SKYLINE INSTITUTE OF TECHNOLOGY"
              className="h-[min(100px,20vw)] w-auto object-contain"
              onError={() => setTextErr(true)}
            />
          ) : (
            textFallback
          )}
        </div>
      </div>
    </header>
  );
};
