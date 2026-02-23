import React from 'react';
import type { FormSectionWithQuestions } from '../../lib/formEngine';

const SCALE = [1, 2, 3, 4, 5] as const;
const SCALE_LABELS = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];

const getSectionCode = (title: string): string => {
  const t = title.toLowerCase();
  if (t.includes('logistics')) return 'A';
  if (t.includes('trainer') || t.includes('assessor')) return 'B';
  if (t.includes('learning')) return 'C';
  return '';
};

interface SectionLikertTableProps {
  section: FormSectionWithQuestions;
  getAnswer: (questionId: number, rowId: number) => string | null;
  onChange: (questionId: number, rowId: number, value: string) => void;
  disabled?: boolean;
}

export const SectionLikertTable: React.FC<SectionLikertTableProps> = ({
  section,
  getAnswer,
  onChange,
  disabled,
}) => {
  const likertQuestions = section.questions.filter((q) => q.type === 'likert_5' && q.rows.length > 0);
  if (likertQuestions.length === 0) return null;

  const sectionCode = getSectionCode(section.title);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[500px] border-collapse border border-gray-300 text-xs" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th className="border border-gray-300 bg-[#5E5E5E] text-white p-1.5 text-center font-semibold w-10 text-xs">
              No.
            </th>
            <th className="border border-gray-300 bg-[#5E5E5E] text-white p-1.5 text-left font-semibold text-xs">
              Criteria/Question
            </th>
            {SCALE_LABELS.map((label) => (
              <th
                key={label}
                className="border border-gray-300 bg-[#5E5E5E] text-white p-1.5 text-center font-semibold text-[10px] min-w-[60px]"
              >
                {label}
              </th>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-300 bg-[#595959] text-white p-1.5 text-center font-semibold w-10 text-xs">
              {sectionCode}
            </td>
            <td className="border border-gray-300 bg-[#595959] text-white p-1.5 font-semibold text-xs" colSpan={6}>
              {section.title}
            </td>
          </tr>
        </thead>
        <tbody>
          {likertQuestions.flatMap((q, qIdx) =>
            (q.rows.length > 0 ? q.rows : [{ id: q.id, row_label: q.label, row_help: null, row_image_url: null, sort_order: 0 }]).map((row, rowIdx) => {
              const currentVal = getAnswer(q.id, row.id);
              let rowNum = 1;
              for (let i = 0; i < qIdx; i++) rowNum += likertQuestions[i].rows.length || 1;
              rowNum += rowIdx;
              return (
                <tr key={`${q.id}-${row.id}`} className={rowNum % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="border border-gray-300 p-1.5 text-center font-medium text-gray-700 bg-gray-100 text-xs align-middle">
                    {rowNum}
                  </td>
                  <td className="border border-gray-300 p-1.5 text-gray-700 bg-gray-100 text-xs align-middle">
                    {row.row_label ?? q.label}
                  </td>
                  {SCALE.map((n) => (
                    <td key={n} className="border border-gray-300 p-1.5 text-center align-middle">
                      <label className="flex items-center justify-center cursor-pointer">
                        <input
                          type="radio"
                          name={`q-${q.id}-${row.id}`}
                          checked={currentVal === String(n)}
                          onChange={() => onChange(q.id, row.id, String(n))}
                          disabled={disabled}
                          className="w-3.5 h-3.5 accent-[var(--brand)]"
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
