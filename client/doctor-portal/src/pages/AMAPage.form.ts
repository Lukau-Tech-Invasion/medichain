/**
 * The against-medical-advice discharge form: what the clinician has entered,
 * how each control changes it, and the request it is filed as. Pure: the
 * attending physician and the discharge time are passed in, so each rule can
 * be tested without mounting the page or reading the clock.
 */

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

export interface RiskDisclosure {
  id: string;
  category: string;
  risk: string;
  acknowledged: boolean;
}

export interface AmaForm {
  /** Which of the four steps is on screen. */
  formStep: number;
  patientId: string;
  patientName: string;
  diagnosis: string;
  recommendedTreatment: string;
  patientStatement: string;
  /**
   * The clinician's judgement of the risk of leaving. Unchosen until they
   * make it: the form used to open on "moderate", mark the field required,
   * and then never send it.
   */
  riskLevel: RiskLevel | '';
  riskDisclosures: RiskDisclosure[];
  witnessName: string;
  // Decision-making capacity is the legal precondition for an AMA discharge:
  // a refusal is only informed if the patient could understand the risks they
  // are accepting. The form captured the risk disclosures but never recorded
  // whether the clinician assessed capacity at all, so a record could assert a
  // valid refusal by a patient nobody had established could give one.
  hasCapacity: boolean;
  capacityBasis: string;
  patientRefusedAlternatives: boolean;
  amaFormSigned: boolean;
  witnessAttested: boolean;
  providerAttested: boolean;
  followUpOffered: boolean;
  patientContactInfoVerified: boolean;
}

/** The fields that are a single tick box. */
export type AmaFlag = {
  [K in keyof AmaForm]: AmaForm[K] extends boolean ? K : never
}[keyof AmaForm];

/** The risks every new record discloses, none yet acknowledged. */
export function defaultRiskDisclosures(): RiskDisclosure[] {
  return [
    { id: 'r1', category: 'General', risk: 'Condition may worsen without treatment', acknowledged: false },
    { id: 'r2', category: 'General', risk: 'Complications may become life-threatening', acknowledged: false },
    { id: 'r3', category: 'General', risk: 'Delayed treatment may reduce effectiveness of future care', acknowledged: false },
    { id: 'r4', category: 'Medical', risk: 'Risk of permanent disability or death', acknowledged: false },
    { id: 'r5', category: 'Medical', risk: 'May require emergency care in the future', acknowledged: false },
    { id: 'r6', category: 'Legal', risk: 'Insurance may not cover future related treatments', acknowledged: false },
  ];
}

export function emptyAmaForm(): AmaForm {
  return {
    formStep: 1, patientId: '', patientName: '', diagnosis: '',
    recommendedTreatment: '', patientStatement: '', riskLevel: '',
    riskDisclosures: defaultRiskDisclosures(), witnessName: '',
    hasCapacity: false, capacityBasis: '', patientRefusedAlternatives: false,
    amaFormSigned: false, witnessAttested: false, providerAttested: false,
    followUpOffered: false, patientContactInfoVerified: false,
  };
}

export type AmaFormAction =
  | { [K in keyof AmaForm]: { type: 'set'; field: K; value: AmaForm[K] } }[keyof AmaForm]
  | { type: 'toggle'; field: AmaFlag }
  | { type: 'acknowledgeRisk'; id: string }
  | { type: 'startNew' }
  | { type: 'reset' };

export function amaFormReducer(form: AmaForm, action: AmaFormAction): AmaForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'toggle':
      return { ...form, [action.field]: !form[action.field] };
    case 'acknowledgeRisk':
      return {
        ...form,
        riskDisclosures: form.riskDisclosures.map((r) =>
          (r.id === action.id ? { ...r, acknowledged: !r.acknowledged } : r)),
      };
    case 'startNew':
      // Opening the "new" tab clears who and what, and returns to step one. It
      // has never cleared the acknowledgements or attestations; `reset` does.
      return {
        ...form,
        formStep: 1, patientId: '', patientName: '', diagnosis: '',
        recommendedTreatment: '', patientStatement: '',
      };
    case 'reset':
      return {
        ...emptyAmaForm(),
        riskDisclosures: form.riskDisclosures.map((r) => ({ ...r, acknowledged: false })),
      };
  }
}

export const allRisksAcknowledged = (form: AmaForm): boolean =>
  form.riskDisclosures.every((r) => r.acknowledged);

/**
 * Signatures may only be collected once capacity is affirmed AND every risk is
 * acknowledged -- an unassessed patient cannot give an informed refusal.
 */
export const readyForSignatures = (form: AmaForm): boolean =>
  allRisksAcknowledged(form) && form.hasCapacity && form.patientRefusedAlternatives;

export const signaturesComplete = (form: AmaForm): boolean =>
  form.amaFormSigned && form.witnessAttested && Boolean(form.witnessName.trim()) && form.providerAttested;

/** The discharge as filed. */
export function toAmaDischargeRequest(
  form: AmaForm,
  filing: { attendingPhysicianId: string; dischargeDatetime: string },
) {
  return {
    patient_id: form.patientId,
    discharge_datetime: filing.dischargeDatetime,
    attending_physician_id: filing.attendingPhysicianId,
    reason_for_leaving: form.patientStatement,
    risk_level: form.riskLevel || undefined,
    risks_explained: form.riskDisclosures.map(({ category, risk, acknowledged }) => ({ category, risk, acknowledged })),
    specific_risks_discussed: form.riskDisclosures.filter((r) => r.acknowledged).map((r) => r.risk).join('\n'),
    patient_verbalized_understanding: allRisksAcknowledged(form),
    decision_making_capacity: form.hasCapacity,
    capacity_assessment: form.capacityBasis,
    alternatives_offered: [{ diagnosis: form.diagnosis, recommended_treatment: form.recommendedTreatment }],
    patient_refused_alternatives: form.patientRefusedAlternatives,
    ama_form_signed: form.amaFormSigned,
    witness_present: form.witnessAttested,
    witness_name: form.witnessName || undefined,
    follow_up_offered: form.followUpOffered,
    patient_contact_info_verified: form.patientContactInfoVerified,
    documentation_complete: form.providerAttested,
  };
}
