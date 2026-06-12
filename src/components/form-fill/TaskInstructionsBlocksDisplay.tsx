import { normalizeRichTextForPage } from '../../utils/richText';
import type { TaskInstructionsData } from './TaskInstructionsModal';

function sanitizeInstructionHtml(html: string): string {
  return String(html || '')
    .replace(/\u00ad/g, '')
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
    .replace(/&shy;/gi, '')
    .replace(/&ZeroWidthSpace;|&#8203;|&#x200B;/gi, '')
    .replace(/<wbr\s*\/?>/gi, '')
    .replace(/-\s*<br\s*\/?>/gi, '')
    .replace(/-\s*\r?\n\s*/g, '')
    .replace(/([A-Za-z])\s*<br\s*\/?>\s*([A-Za-z])/gi, '$1$2')
    .replace(/([A-Za-z])\s*\r?\n\s*([A-Za-z])/g, '$1$2');
}

type InstructionBlock = NonNullable<TaskInstructionsData['blocks']>[number];

function renderBlockImage(b: InstructionBlock) {
  const imgUrl = String((b as { imageUrl?: string }).imageUrl || '').trim();
  if (!imgUrl) return null;
  const imageFullWidth = Boolean((b as { imageFullWidth?: boolean }).imageFullWidth);
  const imageLayout = String((b as { imageLayout?: string }).imageLayout || 'below') as 'above' | 'below' | 'side_by_side';
  const imageSide = (String((b as { imageSide?: string }).imageSide || 'right') as 'left' | 'right');
  const imgEl = (
    <img
      src={imgUrl}
      alt=""
      className="max-w-full h-auto object-contain rounded border border-gray-200"
      style={{ maxHeight: imageFullWidth ? 520 : 280, width: imageFullWidth ? '100%' : undefined }}
    />
  );
  if (imageFullWidth || imageLayout === 'above' || imageLayout === 'below') {
    return <div className="mt-2">{imgEl}</div>;
  }
  const left = imageSide === 'left';
  return (
    <div className="mt-2 flex flex-col sm:flex-row gap-3 items-start">
      {left ? <div className="sm:w-[40%] w-full shrink-0">{imgEl}</div> : null}
      <div className="flex-1 min-w-0" />
      {!left ? <div className="sm:w-[40%] w-full shrink-0">{imgEl}</div> : null}
    </div>
  );
}

const proseClass =
  'prose prose-sm max-w-none whitespace-normal break-normal [word-break:normal] [hyphens:none] [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_th]:whitespace-normal [&_th]:break-normal [&_th]:align-top [&_th]:[word-break:normal] [&_th]:[hyphens:none] [&_td]:whitespace-normal [&_td]:break-normal [&_td]:align-top [&_td]:[word-break:normal] [&_td]:[hyphens:none] [&_td>div]:[overflow-wrap:break-word] [&_td>p]:[overflow-wrap:break-word] [&_td>span]:[overflow-wrap:break-word]';

export function TaskInstructionsBlocksDisplay({
  instructions,
  title,
}: {
  instructions: TaskInstructionsData;
  title?: string;
}) {
  const customBlocks = Array.isArray(instructions.blocks) ? instructions.blocks : [];

  if (customBlocks.length > 0) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        {title ? (
          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">{title}</div>
        ) : null}
        <div className="p-4 space-y-4">
          {instructions.assessment_type ? (
            <div>
              <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">Assessment type</div>
              <div className="border border-gray-200 border-t-0 rounded-b p-3 bg-gray-50 prose prose-sm max-w-none whitespace-pre-line">
                {instructions.assessment_type}
              </div>
            </div>
          ) : null}
          {customBlocks.map((b, idx) => {
            const heading = String(b.heading || '').trim();
            if (b.type === 'table') {
              const rows = Array.isArray(b.rows) ? b.rows : [];
              const columnHeaders = Array.isArray(b.columnHeaders) ? b.columnHeaders : [];
              return (
                <div key={String(b.id || idx)}>
                  {heading ? (
                    <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">{heading}</div>
                  ) : null}
                  <div className={`border border-gray-200 ${heading ? 'border-t-0 rounded-b' : 'rounded'} overflow-x-hidden`}>
                    <table className="w-full table-fixed border-collapse text-sm">
                      {columnHeaders.length > 0 ? (
                        <thead>
                          <tr className="bg-gray-200">
                            {columnHeaders.map((h, hi) => (
                              <th key={hi} className="border border-gray-300 p-2 text-left font-semibold text-gray-700 whitespace-normal break-normal align-top">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                      ) : null}
                      <tbody>
                        {rows.map((r, ri) => {
                          const cells = r.cells;
                          const isMultiCol = Array.isArray(cells) && cells.length > 0;
                          return (
                            <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              {isMultiCol ? (
                                cells.map((cell, ci) => (
                                  <td key={ci} className="border border-gray-300 p-2 whitespace-normal break-normal align-top">
                                    <div className="[overflow-wrap:break-word]">
                                      <div
                                        lang="en"
                                        className={proseClass}
                                        dangerouslySetInnerHTML={{
                                          __html: normalizeRichTextForPage(
                                            sanitizeInstructionHtml(String(cell || '')).replace(/\n/g, '<br/>')
                                          ),
                                        }}
                                      />
                                    </div>
                                  </td>
                                ))
                              ) : (
                                <>
                                  <td className="border border-gray-300 p-2 align-top font-semibold w-[24%] whitespace-normal break-normal">
                                    {String(r.heading || '')}
                                  </td>
                                  <td className="border border-gray-300 border-r p-2 align-top w-[76%] whitespace-normal break-normal">
                                    <div className="[overflow-wrap:break-word]">
                                      <div
                                        lang="en"
                                        className={proseClass}
                                        dangerouslySetInnerHTML={{
                                          __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(r.content || ''))),
                                        }}
                                      />
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {renderBlockImage(b)}
                  </div>
                </div>
              );
            }
            const hasText = !!String(b.content || '').replace(/<[^>]*>/g, '').trim();
            const hasImg = !!String((b as { imageUrl?: string }).imageUrl || '').trim();
            if (!hasText && !hasImg) return null;
            return (
              <div key={String(b.id || idx)} className="overflow-x-hidden">
                {heading ? <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t mb-0">{heading}</div> : null}
                {hasText ? (
                  <div
                    lang="en"
                    className={`text-sm text-gray-700 ${proseClass}`}
                    dangerouslySetInnerHTML={{
                      __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(b.content || ''))),
                    }}
                  />
                ) : null}
                {renderBlockImage(b)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const escapeAndNlToBr = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
  const blocks: { title: string; content: string }[] = [
    { title: 'Assessment type', content: escapeAndNlToBr(String(instructions.assessment_type || '')) },
    { title: 'Instructions provided to the student:', content: String(instructions.task_description || '') },
    { title: 'Applicable conditions:', content: String(instructions.applicable_conditions || '') },
    { title: 'Resubmissions and reattempts:', content: String(instructions.resubmissions || '') },
    {
      title: 'Location:',
      content:
        String(instructions.location_intro || '') +
        (Array.isArray(instructions.location_options)
          ? '<ul><li>' + instructions.location_options.join('</li><li>') + '</li></ul>'
          : '') +
        String(instructions.location_note || ''),
    },
    { title: 'Instructions for answering the written questions:', content: String(instructions.answering_instructions || '') },
    { title: 'Purpose of the assessment', content: String(instructions.purpose_intro || '') + String(instructions.purpose_bullets || '') },
    { title: 'Task instructions', content: String(instructions.task_instructions || '') },
  ].filter((b) => b.content.replace(/<[^>]*>/g, '').trim());

  if (blocks.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {title ? <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">{title}</div> : null}
      <div className="p-4 space-y-4">
        {blocks.map((b, i) => (
          <div key={i}>
            <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">{b.title}</div>
            <div className="border border-gray-200 border-t-0 rounded-b p-3 bg-gray-50">
              <div className="overflow-x-hidden">
                <div
                  lang="en"
                  className={proseClass}
                  dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(b.content)) }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
