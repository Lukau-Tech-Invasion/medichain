import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from '@medichain/shared';

describe('csv', () => {
  it('quotes every cell so a comma or quote cannot shift the columns', () => {
    expect(csvRow(['a,b', 'say "hi"', 3])).toBe('"a,b","say ""hi""","3"');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    for (const formula of ['=HYPERLINK("x")', '+1+1', '-2', '@SUM(A1)']) {
      expect(csvCell(formula).startsWith(`"'`)).toBe(true);
    }
  });

  it('writes nothing for an absent value, never "undefined"', () => {
    expect(csvRow([null, undefined, false])).toBe('"","","false"');
  });
});
