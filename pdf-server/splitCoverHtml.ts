/** Split full assessment HTML into cover page + remainder (shared by live route and worker). */
export function splitCoverAndRestHtml(fullHtml: string): { coverHtml: string; restHtml: string } {
  const bodyOpenTag = '<body>';
  const bodyCloseTag = '</body>';
  const introMarker = '<div class="step-page intro-page">';
  const bodyStart = fullHtml.indexOf(bodyOpenTag);
  const bodyEnd = fullHtml.lastIndexOf(bodyCloseTag);

  if (bodyStart < 0 || bodyEnd < 0 || bodyEnd <= bodyStart) {
    return { coverHtml: fullHtml, restHtml: fullHtml };
  }

  const beforeBody = fullHtml.slice(0, bodyStart + bodyOpenTag.length);
  const bodyContent = fullHtml.slice(bodyStart + bodyOpenTag.length, bodyEnd);
  const introIndex = bodyContent.indexOf(introMarker);

  if (introIndex <= 0) {
    return { coverHtml: fullHtml, restHtml: fullHtml };
  }

  const coverContent = bodyContent.slice(0, introIndex);
  const restContent = bodyContent.slice(introIndex);
  const htmlClose = '\n</body>\n</html>';

  const coverHtml = `${beforeBody}${coverContent}${htmlClose}`;
  const restHtmlRaw = `${beforeBody}${restContent}${htmlClose}`;
  // restHtml starts at Student Pack intro — must not use @page :first { margin: 0 } or the
  // Playwright header template overlaps the first page body.
  const restHtml = restHtmlRaw.replace(
    /@page\s*:first\s*\{\s*margin:\s*0;\s*\}/,
    '@page :first { margin: 190px 15mm 70px 15mm; }',
  );

  return { coverHtml, restHtml };
}
