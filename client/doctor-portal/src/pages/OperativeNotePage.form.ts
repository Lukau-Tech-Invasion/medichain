/**
 * The operative note form: what the surgeon has entered, how each control
 * changes it, and the record it is filed as. Pure: the surgeon, today's date,
 * a new specimen's id and the filing time are all passed in, so each rule can
 * be tested without mounting the page or reading the clock.
 */

export type AnesthesiaType = 'general' | 'spinal' | 'epidural' | 'regional' | 'local' | 'mac' | 'none';
export type WoundClass = 'clean' | 'clean-contaminated' | 'contaminated' | 'dirty';

export interface Specimen {
  id: string;
  description: string;
  disposition: 'pathology' | 'culture' | 'cytology' | 'discarded';
}

export interface OperativeNote {
  id: string;
  patientId: string;
  patientName: string;
  surgeon: string;
  assistant: string;
  anesthesiologist: string;
  scrubNurse: string;
  circulator: string;
  procedureDate: string;
  preOpDiagnosis: string;
  postOpDiagnosis: string;
  procedureName: string;
  cptCodes: string;
  /** Absent when not recorded -- never a guessed "general". */
  anesthesiaType?: AnesthesiaType;
  incision: string;
  findings: string;
  procedure: string;
  closure: string;
  drains: string;
  /** Millilitres; absent when not measured, which is not 0 mL (rule 12). */
  ebl?: number;
  urineOutput?: number;
  fluidIn?: number;
  specimens: Specimen[];
  woundClass?: WoundClass;
  implants: string;
  complications: string;
  disposition: string;
  createdAt: string;
}

/** Everything the surgeon enters. The patient is chosen outside the note. */
export interface OperativeForm {
  surgeon: string;
  assistant: string;
  anesthesiologist: string;
  scrubNurse: string;
  circulator: string;
  procedureDate: string;
  preOpDiagnosis: string;
  postOpDiagnosis: string;
  procedureName: string;
  cptCodes: string;
  // Nothing pre-selected and no measurement pre-filled: an untouched form
  // used to file "general anaesthetic, clean wound, EBL 0 mL" (rule 9).
  anesthesiaType: AnesthesiaType | '';
  incision: string;
  findings: string;
  procedureText: string;
  closure: string;
  drains: string;
  /** Measurements are kept as typed; an empty box is "not measured". */
  ebl: string;
  urineOutput: string;
  fluidIn: string;
  specimens: Specimen[];
  woundClass: WoundClass | '';
  implants: string;
  complications: string;
  disposition: string;
}

/** What a new note starts from: the signed-in surgeon and today's date. */
export interface OperativeDefaults {
  surgeon: string;
  /** `YYYY-MM-DD`. */
  today: string;
}

export function emptyOperativeForm({ surgeon, today }: OperativeDefaults): OperativeForm {
  return {
    surgeon, assistant: '', anesthesiologist: '', scrubNurse: '', circulator: '',
    procedureDate: today,
    preOpDiagnosis: '', postOpDiagnosis: '', procedureName: '', cptCodes: '',
    anesthesiaType: '', incision: '', findings: '', procedureText: '',
    closure: '', drains: '', ebl: '', urineOutput: '', fluidIn: '',
    specimens: [], woundClass: '', implants: '', complications: '', disposition: '',
  };
}

export type OperativeFormAction =
  | { [K in keyof OperativeForm]: { type: 'set'; field: K; value: OperativeForm[K] } }[keyof OperativeForm]
  | ({ type: 'reset' } & OperativeDefaults)
  | { type: 'addSpecimen'; specimen: Specimen }
  | { type: 'removeSpecimen'; id: string };

export function operativeFormReducer(form: OperativeForm, action: OperativeFormAction): OperativeForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'reset':
      return emptyOperativeForm(action);
    case 'addSpecimen':
      return { ...form, specimens: [...form.specimens, action.specimen] };
    case 'removeSpecimen':
      return { ...form, specimens: form.specimens.filter((s) => s.id !== action.id) };
  }
}

/** A number the surgeon entered, or nothing when the box was left empty. */
export function measured(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The record the note is filed as. An unchosen anaesthetic or wound class and
 * an unmeasured volume are absent, not a default and not zero.
 */
export function toOperativeNote(
  form: OperativeForm,
  filing: { patientId: string; patientName: string; createdAt: string },
): OperativeNote {
  const { procedureText, anesthesiaType, woundClass, ebl, urineOutput, fluidIn, ...text } = form;
  return {
    // Assigned by the server.
    id: '',
    patientId: filing.patientId,
    patientName: filing.patientName,
    ...text,
    anesthesiaType: anesthesiaType || undefined,
    procedure: procedureText,
    ebl: measured(ebl),
    urineOutput: measured(urineOutput),
    fluidIn: measured(fluidIn),
    woundClass: woundClass || undefined,
    createdAt: filing.createdAt,
  };
}
