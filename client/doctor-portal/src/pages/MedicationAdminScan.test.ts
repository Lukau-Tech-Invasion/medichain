import { describe, expect, it } from 'vitest';
import { labelMatchesOrder } from './MedicationAdminPage';

describe('labelMatchesOrder', () => {
  it("accepts this order's label, alone or among other label fields", () => {
    expect(labelMatchesOrder('MED-123', 'MED-123')).toBe(true);
    expect(labelMatchesOrder(' med-123 ', 'MED-123')).toBe(true);
    expect(labelMatchesOrder('PAT-9|MED-123|500mg', 'MED-123')).toBe(true);
  });

  it('refuses another order, a partial id, and an empty order id', () => {
    expect(labelMatchesOrder('MED-1234', 'MED-123')).toBe(false);
    expect(labelMatchesOrder('MED-124', 'MED-123')).toBe(false);
    expect(labelMatchesOrder('anything', '')).toBe(false);
  });
});
