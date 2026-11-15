import { describe, expect, it } from 'vitest';
import { interactionsFor } from './PharmacistDashboardPage';

const warfarin = { id: 'I1', drug1: 'Warfarin', drug2: 'Aspirin', severity: 'Major' as const, description: '', patient_id: 'P1' };

describe('interactionsFor', () => {
  it("shows the patient's interaction on the prescription for either drug", () => {
    expect(interactionsFor([warfarin], { patient_id: 'P1', medication_name: 'aspirin' })).toHaveLength(1);
    expect(interactionsFor([warfarin], { patient_id: 'P1', medication_name: 'Warfarin 5 mg' })).toHaveLength(1);
  });
  it("never shows another patient's interaction or an unrelated drug", () => {
    expect(interactionsFor([warfarin], { patient_id: 'P2', medication_name: 'Aspirin' })).toHaveLength(0);
    expect(interactionsFor([warfarin], { patient_id: 'P1', medication_name: 'Paracetamol' })).toHaveLength(0);
  });
});
