import { describe, it, expect } from 'vitest';
import {
  parseMixedContent,
  normalizePastedText,
  splitTableRow,
  normalizeHeader,
  isLikelyTableBlock,
  mergeContinuationLinesIntoRows,
  extractLeadingRowNumber,
  stripLeadingRowNumberColumn,
} from './parseMixedContent';

describe('normalizePastedText', () => {
  it('removes \\r and converts non-breaking spaces', () => {
    expect(normalizePastedText('hello\r\nworld\u00A0test')).toBe('hello\nworld test');
  });
  it('trims outer whitespace', () => {
    expect(normalizePastedText('  content  ')).toBe('content');
  });
});

describe('splitTableRow', () => {
  it('splits by tab when useTabs', () => {
    expect(splitTableRow('A\tB\tC', true)).toEqual(['A', 'B', 'C']);
  });
  it('splits by 2+ spaces when not useTabs', () => {
    expect(splitTableRow('A    B    C', false)).toEqual(['A', 'B', 'C']);
  });
});

describe('normalizeHeader', () => {
  it('converts to Title Case', () => {
    expect(normalizeHeader('risk category', 0)).toBe('Risk Category');
  });
  it('replaces underscores and hyphens with spaces', () => {
    expect(normalizeHeader('risk_category-item', 0)).toBe('Risk Category Item');
  });
  it('returns Column N for empty', () => {
    expect(normalizeHeader('', 2)).toBe('Column 3');
  });
});

describe('isLikelyTableBlock', () => {
  it('returns valid for tab-separated 2+ rows', () => {
    const lines = ['A\tB\tC', '1\t2\t3'];
    expect(isLikelyTableBlock(lines, true)).toMatchObject({ valid: true, numCols: 3 });
  });
  it('returns invalid for single row', () => {
    expect(isLikelyTableBlock(['A\tB'], true)).toEqual({ valid: false });
  });
  it('returns invalid when first line has no separator', () => {
    expect(isLikelyTableBlock(['A B', '1 2'], false)).toEqual({ valid: false });
  });
});

describe('mergeContinuationLinesIntoRows', () => {
  it('merges bullet continuations into last cell', () => {
    const lines = ['A\tB\tC', '1\t2\t', '• item 1', '• item 2'];
    const result = mergeContinuationLinesIntoRows(lines, true, 3);
    expect(result).toHaveLength(2);
    expect(result[1][2]).toBe('\n• item 1\n• item 2');
  });
});

describe('parseMixedContent', () => {
  it('parses Risk table with 4 columns', () => {
    const input = `Risk Category	Identified Risk	Potential Impact on Team	Required Team Response
Production Delay	Re-cut required due to measurement discrepancy	Reduced available production time	Reallocate tasks and adjust schedule
Equipment Downtime	Polishing machine temporarily unavailable	Workflow disruption	Seek assistance from Team Leader`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].headers).toEqual([
        'Risk Category',
        'Identified Risk',
        'Potential Impact on Team',
        'Required Team Response',
      ]);
      expect(result[0].rows).toHaveLength(2);
      expect(result[0].rows[0]).toEqual([
        'Production Delay',
        'Re-cut required due to measurement discrepancy',
        'Reduced available production time',
        'Reallocate tasks and adjust schedule',
      ]);
    }
  });

  it('parses Budget table with 3 columns', () => {
    const input = `Category    Item    Estimated Cost (AUD)
Materials    Glass panels    $500
Labour    Installation    $800`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].headers.length).toBe(3);
      expect(result[0].rows).toHaveLength(2);
    }
  });

  it('parses mixed content with headings + paragraphs + tables', () => {
    const input = `Project Specifications

To meet the performance evidence requirements, the candidate must participate actively.

Risk Category	Identified Risk
Production	Re-cut required`;

    const result = parseMixedContent(input);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const para = result.find((b) => b.type === 'paragraph');
    const table = result.find((b) => b.type === 'table');
    expect(para).toBeDefined();
    expect(table).toBeDefined();
    if (table && table.type === 'table') {
      expect(table.headers).toContain('Risk Category');
      expect(table.rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('parses table where one cell contains bullet points on multiple lines', () => {
    const input = `Instructions	Response
Task 1	Complete the following:
• Step one
• Step two
• Step three`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][1]).toContain('Step one');
      expect(result[0].rows[0][1]).toContain('• Step two');
    }
  });

  it('parses table where one cell contains numbered steps on multiple lines', () => {
    const input = `Task	Instructions
1	Follow these steps:
1. First action
2. Second action
3. Third action`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows[0][1]).toContain('1. First action');
      expect(result[0].rows[0][1]).toContain('2. Second action');
    }
  });

  it('parses Word-pasted content where Instructions cell wraps across several lines', () => {
    const input = `Action	Instructions
Re-cut	Measurement discrepancy requiring re-cut of one panel.
Coordinate with team and adjust schedule.
Notify supervisor.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows[0][1]).toContain('Coordinate with team');
      expect(result[0].rows[0][1]).toContain('Notify supervisor');
    }
  });

  it('treats numbered list as paragraph not table (avoids "1." as column header)', () => {
    const input = `1.	Review the skills application section/s of the learner workbook.
2.	Read the task performance requirements and foundation skills application for each task activity.
3.	Conduct research and review literature relevant to the unit.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('paragraph');
    if (result[0].type === 'paragraph') {
      expect(result[0].content).toContain('Review the skills application');
      expect(result[0].content).toContain('Read the task performance');
    }
  });

  it('keeps paragraph with bullets as paragraph, not table', () => {
    const input = `To meet the requirements, the candidate must:
• Participate actively in work teams
• Identify team tasks
• Prioritize allocated tasks

This is a normal paragraph.`;

    const result = parseMixedContent(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const first = result[0];
    expect(first.type).toBe('paragraph');
    if (first.type === 'paragraph') {
      expect(first.content).toContain('Participate actively');
      expect(first.content).toContain('Identify team tasks');
    }
  });

  it('handles content with \\r\\n and non-breaking spaces', () => {
    const input = 'Col1\u00A0\u00A0Col2\r\nA\u00A0\u00A0B';
    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
  });

  it('parses Assessment Information / Description table with numbered prefixes', () => {
    const input = `Assessment Information	Description
1	Assessment Method	Glass and Glazing Workshop Practical
2	Assessment Type	Summative
3	Assessment Description (What?)	This assessment task is designed to gather evidence.
4	Purpose (objective) of the Assessment (Why?)	To gather evidence of competency.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].headers).toEqual(['Assessment Information', 'Description']);
      expect(result[0].rows).toHaveLength(4);
      expect(result[0].rows[0]).toEqual(['Assessment Method', 'Glass and Glazing Workshop Practical']);
      expect(result[0].rows[1]).toEqual(['Assessment Type', 'Summative']);
      expect(result[0].rows[2]).toEqual(['Assessment Description (What?)', 'This assessment task is designed to gather evidence.']);
      expect(result[0].rows[3]).toEqual(['Purpose (objective) of the Assessment (Why?)', 'To gather evidence of competency.']);
    }
  });

  it('parses assessment rows where left label spans multiple lines like (What?)', () => {
    const input = `Assessment Information	Description
3	Assessment Description
(What?)	This assessment task is designed to gather evidence of competency.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Description');
      expect(result[0].rows[0][0]).toContain('(What?)');
      expect(result[0].rows[0][1]).toContain('This assessment task');
    }
  });

  it('parses Assessment Instructions row with multi-line numbered list in Description', () => {
    const input = `Assessment Information	Description
5	Assessment Instructions
(How?)	1. Review the assessment requirements.
2. Read the safety guidelines.
3. Complete the practical task.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Instructions');
      expect(result[0].rows[0][0]).toContain('(How?)');
      expect(result[0].rows[0][1]).toContain('1. Review');
      expect(result[0].rows[0][1]).toContain('2. Read');
      expect(result[0].rows[0][1]).toContain('3. Complete');
    }
  });

  it('keeps all 10 numbered instructions in single Description cell for Assessment Instructions (How?)', () => {
    const input = `Assessment Information	Description
5	Assessment Instructions
(How?)	1.	Review the skills application section/s of the learner workbook.
2.	Read the task performance requirements and foundation skills application for each task activity.
3.	Conduct research and review literature relevant to the unit.
4.	Provide solutions to each written and performance activity using skills and knowledge.
5.	This task requires you to play roles.
6.	The assessment is due on the date specified by your assessor.
7.	Any variations to this arrangement must be approved in writing.
8.	Submit your work with any required evidence attached.
9.	See the specifications below for details.
10.	Continue to read the following assessment requirements:`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Instructions');
      expect(result[0].rows[0][0]).toContain('(How?)');
      const desc = result[0].rows[0][1];
      expect(desc).toContain('1.');
      expect(desc).toContain('Review the skills application');
      expect(desc).toContain('2.');
      expect(desc).toContain('Read the task performance');
      expect(desc).toContain('10.');
      expect(desc).toContain('Continue to read');
    }
  });

  it('keeps point 10 "Specified timing for assessment" in Required Resources Description cell', () => {
    const input = `Assessment Information	Description
9	Required Resources
(What resources, equipment, tools, and materials)	1.	Assessment task with instruction and assessment information
2.	Learner workbook and other training handouts.
9.	Access to relevant legislation, regulations, standards, and code of practice
10.	Specified timing for assessment`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Required Resources');
      const desc = result[0].rows[0][1];
      expect(desc).toContain('10.');
      expect(desc).toContain('Specified timing for assessment');
      expect(desc).toContain('1.');
      expect(desc).toContain('Assessment task with instruction');
    }
  });

  it('merges parenthetical with label in left column: Assessment date/s (When?), Assessment Instructions (How?)', () => {
    const input = `Assessment Information	Description
6	Assessment Date/s and Timing/s
(When?)	•	Bullet content.
5	Assessment Instructions
(How?)	1. First step.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    if (result[0].type === 'table') {
      expect(result[0].rows[0][0]).toContain('Assessment Date/s and Timing/s');
      expect(result[0].rows[0][0]).toContain('(When?)');
      expect(result[0].rows[1][0]).toContain('Assessment Instructions');
      expect(result[0].rows[1][0]).toContain('(How?)');
    }
  });

  it('keeps bulleted list in single Description cell for Assessment Date/s and Timing/s', () => {
    const input = `Assessment Information	Description
6	Assessment Date/s and Timing/s
(When?)	•	This assessment will be conducted according to the training delivery session plan.
•	Assessor will specify the timings for assessment and evidence submission date/s and timing/s.
•	The time allowed for the assessment is 4 hours within 20 hours of last week training delivery.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Date/s and Timing/s');
      expect(result[0].rows[0][0]).toContain('(When?)');
      const desc = result[0].rows[0][1];
      expect(desc).toContain('This assessment will be conducted');
      expect(desc).toContain('Assessor will specify the timings');
      expect(desc).toContain('The time allowed for the assessment');
    }
  });

  it('keeps numbered list in table cell when blank line separates (How?) from list', () => {
    const input = `Assessment Information	Description
5	Assessment Instructions
(How?)

1. Review the skills application section/s of the learner workbook.
2. Read the task performance requirements.
3. Conduct research and review literature.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Instructions');
      expect(result[0].rows[0][0]).toContain('(How?)');
      expect(result[0].rows[0][1]).toContain('1. Review the skills application');
      expect(result[0].rows[0][1]).toContain('2. Read the task performance');
      expect(result[0].rows[0][1]).toContain('3. Conduct research');
    }
  });

  it('keeps Assessment Instructions (How?) + numbered list as ONE row, no extra row for 1. (space-separated)', () => {
    const input = `Assessment Information	Description
5	Assessment Instructions	(How?)
1. Review the skills application section/s of the learner workbook.
2. Read the task performance requirements and foundation skills application for each task activity.
3. Conduct research and review literature relevant to the unit.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Instructions');
      expect(result[0].rows[0][0]).toContain('(How?)');
      expect(result[0].rows[0][1]).toContain('1. Review the skills application');
      expect(result[0].rows[0][1]).toContain('2. Read the task performance');
      expect(result[0].rows[0][1]).toContain('3. Conduct research');
      expect(result[0].rows[0][1]).not.toContain('Assessment Information');
    }
  });

  it('does not add redundant standalone 1. when pasted content already has numbered list', () => {
    const input = `Assessment Information	Description
5	Assessment Instructions	(How?)
1.
1. Conduct research and review literature relevant to the unit.
2. Provide answers and solutions to each question using your own words.
3. Continue to read the following assessment requirements.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      const desc = result[0].rows[0]?.[1] ?? '';
      expect(desc).toContain('1. Conduct research');
      expect(desc).not.toMatch(/^1\.\s*$/m);
      expect(desc).not.toMatch(/\n1\.\s*\n1\./);
    }
  });

  it('keeps Assessment Instructions (How?) + numbered list as ONE row with space separators', () => {
    const input = `Assessment Information    Description
5    Assessment Instructions    (How?)
1. Review the skills application section/s of the learner workbook.
2. Read the task performance requirements and foundation skills application for each task activity.
3. Conduct research and review literature relevant to the unit.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows).toHaveLength(1);
      expect(result[0].rows[0][0]).toContain('Assessment Instructions');
      expect(result[0].rows[0][0]).toContain('(How?)');
      expect(result[0].rows[0][1]).toContain('1. Review the skills application');
      expect(result[0].rows[0][1]).toContain('2. Read the task performance');
      expect(result[0].rows[0][1]).toContain('3. Conduct research');
    }
  });

  it('parses Task / Instructions / Evidence table with multi-line bullets', () => {
    const input = `Task	Instructions	Evidence to submit
1	Complete the following:
• Step one
• Step two	Submit photos of completed work
2	Review and document:
- Item A
- Item B	Written report`;

    const result = parseMixedContent(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const table = result.find((b) => b.type === 'table');
    if (table && table.type === 'table') {
      expect(table.headers).toContain('Task');
      expect(table.headers).toContain('Instructions');
      expect(table.headers).toContain('Evidence to submit');
      expect(table.rows.length).toBeGreaterThanOrEqual(1);
      const firstRow = table.rows[0];
      expect(firstRow[1]).toContain('Step one');
      expect(firstRow[1]).toContain('Complete');
      if (table.rows.length >= 2) {
        expect(table.rows[1][1]).toContain('Item A');
      }
    } else {
      expect(result[0].type).toBe('table');
    }
  });

  it('creates separate heading block and table block when section title precedes table', () => {
    const input = `Project Risks
Risk Category	Identified Risk	Potential Impact on Team	Required Team Response
Production	Re-cut required	Workflow disruption	Adjust schedule`;

    const result = parseMixedContent(input);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const first = result[0];
    const second = result[1];
    expect(first.type).toBe('paragraph');
    if (first.type === 'paragraph') {
      expect(first.heading ?? first.content).toContain('Project Risks');
    }
    expect(second.type).toBe('table');
    if (second.type === 'table') {
      expect(second.headers).toContain('Risk Category');
      expect(second.rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('creates Project Budget as table with section heading', () => {
    const input = `Project Budget
Cost Category	Estimated Cost (AUD)	Budget Consideration
Materials	$500	Primary allocation
Labour	$800	Secondary`;

    const result = parseMixedContent(input);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const table = result.find((b) => b.type === 'table');
    expect(table).toBeDefined();
    if (table && table.type === 'table') {
      expect(table.headers).toContain('Cost Category');
      expect(table.headers).toContain('Estimated Cost (AUD)');
      expect(table.rows).toHaveLength(2);
    }
  });

  describe('comprehensive assessment table (spec section L.A)', () => {
    it('parses full Assessment Information table with all row types', () => {
      const input = `Assessment Information	Description
1	Assessment method	Written questioning
2	Assessment type	Summative
3	Assessment description	(What?)	This assessment task is designed to gather evidence.
5	Assessment Instructions	(How?)	1. Review the workbook. 2. Conduct research.
6	Assessment date/s and timing/s	(When?)	This assessment will be conducted according to plan.
7	Specifications	(What structure, format, and demonstration?)	1. Item one 2. Item two
9	Required resources	(What resources, equipment, tools, and materials?)	1. Workbook 2. Stationery
10	Evidence requirements/	(What the assessor is looking for?)	• Bullet one • Bullet two`;

      const result = parseMixedContent(input);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('table');
      if (result[0].type === 'table') {
        expect(result[0].headers).toEqual(['Assessment Information', 'Description']);
        expect(result[0].rows.length).toBeGreaterThanOrEqual(5);
        const row0 = result[0].rows.find((r) => r[0].includes('Assessment method'));
        expect(row0).toBeDefined();
        expect(row0?.[1]).toContain('Written questioning');
        const rowWithWhat = result[0].rows.find((r) => r[0].includes('(What?)'));
        expect(rowWithWhat).toBeDefined();
        expect(rowWithWhat?.[1]).toContain('gather evidence');
      }
    });
  });

  it('parses headerless Assessment Information table (no header row, single-space paste)', () => {
    const input = `1 Assessment method Carpentry Workshop Practical
2 Assessment type Summative
3 Assessment description (What?) This assessment task is designed to gather evidence.
5 Assessment Instructions (How?) 1. Review the workbook. 2. Conduct research.
6 Assessment date/s and timing/s (When?) This assessment will be conducted according to plan.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].headers).toEqual(['Assessment Information', 'Description']);
      expect(result[0].rows.length).toBeGreaterThanOrEqual(3);
      const methodRow = result[0].rows.find((r) => r[0].toLowerCase().includes('assessment method'));
      expect(methodRow?.[1]).toContain('Carpentry');
      const descRow = result[0].rows.find((r) => r[0].toLowerCase().includes('assessment description'));
      expect(descRow?.[0]).toContain('(What?)');
      expect(descRow?.[1]).toContain('gather evidence');
      const instrRow = result[0].rows.find((r) => r[0].toLowerCase().includes('assessment instructions'));
      expect(instrRow?.[0]).toContain('(How?)');
      expect(instrRow?.[1]).toContain('Review');
    }
  });

  it('parses headerless Assessment Information table even when blank lines separate rows', () => {
    const input = `1 Assessment method Carpentry Workshop Practical

2 Assessment type Summative

3 Assessment description (What?) This assessment task is designed to gather evidence.

5 Assessment Instructions (How?) 1. Review the workbook. 2. Conduct research.`;

    const result = parseMixedContent(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].rows.length).toBeGreaterThanOrEqual(3);
      const typeRow = result[0].rows.find((r) => r[0].toLowerCase().includes('assessment type'));
      expect(typeRow?.[1]).toContain('Summative');
    }
  });

  describe('comprehensive standard tables (spec section L.B)', () => {
    it('parses Project Risks 4-column table', () => {
      const input = `Project Risks
Risk Category	Identified Risk	Potential Impact on Team	Required Team Response
Production	Re-cut required	Reduced time	Adjust schedule
Equipment	Machine down	Disruption	Seek assistance`;

      const result = parseMixedContent(input);
      expect(result.length).toBeGreaterThanOrEqual(2);
      const table = result.find((b) => b.type === 'table');
      expect(table).toBeDefined();
      if (table && table.type === 'table') {
        expect(table.headers).toContain('Risk Category');
        expect(table.headers).toContain('Identified Risk');
        expect(table.headers).toContain('Potential Impact on Team');
        expect(table.headers).toContain('Required Team Response');
        expect(table.rows.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('parses Project Budget 3-column table', () => {
      const input = `Project Budget
Cost Category	Estimated Cost (AUD)	Budget Consideration
Laminated Glass Materials	$4,200	Must minimise waste during cutting
Labour	$1,500	Include buffer`;

      const result = parseMixedContent(input);
      expect(result.length).toBeGreaterThanOrEqual(2);
      const table = result.find((b) => b.type === 'table');
      expect(table).toBeDefined();
      if (table && table.type === 'table') {
        expect(table.headers).toContain('Cost Category');
        expect(table.headers).toContain('Estimated Cost (AUD)');
        expect(table.rows.some((r) => r[0].includes('Laminated'))).toBe(true);
      }
    });

    it('parses Task/Instructions/Evidence table with multiline bullets', () => {
      const input = `Task	Instructions	Evidence to submit
1	Complete the following:
• Step one
• Step two	Submit photos
2	Review and document:
- Item A
- Item B	Written report`;

      const result = parseMixedContent(input);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const table = result.find((b) => b.type === 'table');
      expect(table).toBeDefined();
      if (table && table.type === 'table') {
        expect(table.headers).toContain('Task');
        expect(table.headers).toContain('Instructions');
        expect(table.headers).toContain('Evidence to submit');
        expect(table.rows[0]?.[1]).toContain('Step one');
        expect(table.rows[0]?.[1]).toContain('Step two');
      }
    });
  });

  describe('mixed document (spec section L.C)', () => {
    it('parses heading, paragraph, heading+table, assessment table, and trailing paragraphs', () => {
      const input = `Introduction

This document contains assessment information.

Project Risks
Risk Category	Identified Risk
Production	Re-cut required

Assessment Information	Description
1	Assessment method	Written questioning

Conclusion paragraph here.`;

      const result = parseMixedContent(input);
      expect(result.length).toBeGreaterThanOrEqual(3);
      const paragraphs = result.filter((b) => b.type === 'paragraph');
      const tables = result.filter((b) => b.type === 'table');
      expect(paragraphs.length).toBeGreaterThanOrEqual(2);
      expect(tables.length).toBeGreaterThanOrEqual(2);
      const firstBlock = result[0];
      if (firstBlock.type === 'paragraph') {
        expect(firstBlock.content || firstBlock.heading).toMatch(/Introduction|This document/);
      }
      const riskTable = tables.find((t) => t.type === 'table' && t.headers?.includes('Risk Category'));
      expect(riskTable).toBeDefined();
      const assessmentTable = tables.find(
        (t) => t.type === 'table' && t.headers?.some((h) => h.includes('Assessment'))
      );
      expect(assessmentTable).toBeDefined();
    });
  });
});

describe('extractLeadingRowNumber', () => {
  it('detects plain numbers', () => {
    expect(extractLeadingRowNumber('1').isRowNumber).toBe(true);
    expect(extractLeadingRowNumber('2').isRowNumber).toBe(true);
  });
  it('detects number with period', () => {
    expect(extractLeadingRowNumber('3.').isRowNumber).toBe(true);
  });
  it('detects number with parenthesis', () => {
    expect(extractLeadingRowNumber('4)').isRowNumber).toBe(true);
  });
  it('rejects non-numbers', () => {
    expect(extractLeadingRowNumber('Assessment').isRowNumber).toBe(false);
    expect(extractLeadingRowNumber('1.5').isRowNumber).toBe(false);
  });
});

describe('stripLeadingRowNumberColumn', () => {
  it('strips leading numeric column when expectedCols is 2', () => {
    const rows = [
      { cells: ['1', 'Assessment Method', 'Glass and Glazing Workshop'] },
      { cells: ['2', 'Assessment Type', 'Summative'] },
    ];
    const result = stripLeadingRowNumberColumn(rows, 2);
    expect(result).toHaveLength(2);
    expect(result[0].cells).toEqual(['Assessment Method', 'Glass and Glazing Workshop']);
    expect(result[1].cells).toEqual(['Assessment Type', 'Summative']);
  });
  it('does not strip when expectedCols is not 2', () => {
    const rows = [{ cells: ['1', 'A', 'B', 'C'] }];
    const result = stripLeadingRowNumberColumn(rows, 4);
    expect(result[0].cells).toEqual(['1', 'A', 'B', 'C']);
  });
  it('preserves rows when first cell is not a row number', () => {
    const rows = [{ cells: ['Assessment', 'Description here'] }];
    const result = stripLeadingRowNumberColumn(rows, 2);
    expect(result[0].cells).toEqual(['Assessment', 'Description here']);
  });
  it('merges middle cells into left when 4+ cells with leading numeric (rule 21)', () => {
    const rows = [
      {
        cells: [
          '3',
          'Assessment description',
          '(What?)',
          'This assessment task is designed to gather evidence of competency.',
        ],
      },
    ];
    const result = stripLeadingRowNumberColumn(rows, 2);
    expect(result).toHaveLength(1);
    expect(result[0].cells[0]).toContain('Assessment description');
    expect(result[0].cells[0]).toContain('(What?)');
    expect(result[0].cells[1]).toContain('gather evidence');
  });
});
