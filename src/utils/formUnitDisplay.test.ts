import { describe, expect, it } from 'vitest';
import { parseUnitFromFormName, resolveFormUnitDisplay } from './formUnitDisplay';

describe('parseUnitFromFormName', () => {
  it('parses qual_unitCode_title pattern', () => {
    expect(
      parseUnitFromFormName('CPC30220_CPCCCA3028_Erect and dismantle formwork for footings and slabs on ground'),
    ).toEqual({
      unitCode: 'CPCCCA3028',
      unitName: 'Erect and dismantle formwork for footings and slabs on ground',
    });
  });
});

describe('resolveFormUnitDisplay', () => {
  it('keeps stored fields when they match the form name', () => {
    expect(
      resolveFormUnitDisplay({
        name: 'CPC30220_CPCCCM2002_Carry out hand excavation',
        unit_code: 'CPCCCM2002',
        unit_name: 'Carry out hand excavation',
      }),
    ).toEqual({
      title: 'CPC30220_CPCCCM2002_Carry out hand excavation',
      unitCode: 'CPCCCM2002',
      unitName: 'Carry out hand excavation',
    });
  });

  it('prefers unit metadata parsed from name when stored code is swapped', () => {
    expect(
      resolveFormUnitDisplay({
        name: 'CPC30220_CPCCCA3028_Erect and dismantle formwork for footings and slabs on ground',
        unit_code: 'CPCCCM3005',
        unit_name: 'Calculate costs of construction work',
      }),
    ).toEqual({
      title: 'CPC30220_CPCCCA3028_Erect and dismantle formwork for footings and slabs on ground',
      unitCode: 'CPCCCA3028',
      unitName: 'Erect and dismantle formwork for footings and slabs on ground',
    });
  });

  it('fixes the paired swapped form', () => {
    expect(
      resolveFormUnitDisplay({
        name: 'CPC30220_CPCCCM3005_Calculate costs of construction work',
        unit_code: 'CPCCCA3028',
        unit_name: 'Erect and dismantle formwork for footings and slabs on ground',
      }),
    ).toEqual({
      title: 'CPC30220_CPCCCM3005_Calculate costs of construction work',
      unitCode: 'CPCCCM3005',
      unitName: 'Calculate costs of construction work',
    });
  });
});
