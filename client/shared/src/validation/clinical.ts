import { z } from 'zod';

/**
 * Clinical field validation.
 *
 * These are safety constraints, not form conveniences. Before this module the
 * frontend had no validation layer at all: a potassium of 640 mmol/L, a date of
 * birth in the future and a systolic below its own diastolic were all
 * submittable, and the only thing between them and the record was whatever the
 * API happened to check.
 *
 * Three rules govern what goes in here.
 *
 * **1. Ranges are physiological, not clerical.** The bounds below are set to
 * "outside this, the value is certainly a typo" — NOT to a normal reference
 * range. A potassium of 7.2 is a medical emergency and must be enterable; 640
 * is a slipped decimal point. Rejecting genuinely abnormal values would be
 * worse than accepting typos, because the abnormal ones are the ones that
 * matter. Where a bound is uncertain, it is set wide deliberately.
 *
 * **2. This is UX, not a security boundary.** Client validation exists to tell
 * a clinician about a mistake at the field, in the moment. The server must
 * validate independently, because the API is reachable without this code — see
 * `docs/OUTSTANDING_WORK.md` §3.1. Never let this be the only check.
 *
 * **3. Messages state the rule, not the failure.** "Invalid value" describes
 * the input; "Enter a value between 0 and 250" tells the user what to do. Apple
 * HIG puts it as: display the message close to the problem, avoid blame, and be
 * clear about what someone can do to fix it.
 */

/** A physiological bound, with the reason it sits where it does. */
interface Range {
  min: number;
  max: number;
  unit: string;
  /** Why these bounds — read when someone inevitably wants to change them. */
  rationale: string;
}

export const VITAL_RANGES = {
  systolic: {
    min: 40,
    max: 300,
    unit: 'mmHg',
    rationale: 'Survivable shock to hypertensive crisis. Below 40 is arrest, above 300 is unrecorded.',
  },
  diastolic: {
    min: 20,
    max: 200,
    unit: 'mmHg',
    rationale: 'Wide enough to admit severe hypotension and malignant hypertension.',
  },
  heartRate: {
    min: 20,
    max: 300,
    unit: 'bpm',
    rationale: 'Profound bradycardia to SVT. Admits both extremes a code team would see.',
  },
  respiratoryRate: {
    min: 4,
    max: 80,
    unit: 'breaths/min',
    rationale: 'Agonal breathing to severe tachypnoea.',
  },
  temperature: {
    min: 25,
    max: 45,
    unit: '°C',
    rationale: 'Severe hypothermia to hyperpyrexia. Celsius only — see temperatureSchema.',
  },
  oxygenSaturation: {
    min: 30,
    max: 100,
    unit: '%',
    rationale: 'A saturation cannot exceed 100. Below 30 is generally unmeasurable.',
  },
  weightKg: {
    min: 0.3,
    max: 500,
    unit: 'kg',
    rationale: 'Extreme prematurity (300g) to the heaviest recorded adults.',
  },
  heightCm: {
    min: 20,
    max: 260,
    unit: 'cm',
    rationale: 'Neonate to the tallest recorded adults.',
  },
} as const satisfies Record<string, Range>;

/** A number within a physiological range, with a message naming the range. */
export function rangedNumber(range: Range) {
  return z
    .number({ error: 'Enter a number' })
    .min(range.min, `Enter a value between ${range.min} and ${range.max} ${range.unit}`)
    .max(range.max, `Enter a value between ${range.min} and ${range.max} ${range.unit}`);
}

/**
 * Blood pressure, validated as a pair.
 *
 * Systolic and diastolic are individually plausible and jointly impossible when
 * systolic <= diastolic. Checking them separately — which is what any
 * per-field validator does — cannot catch a transposed pair, and a transposed
 * pair reads as profound hypotension.
 */
export const bloodPressureSchema = z
  .object({
    systolic: rangedNumber(VITAL_RANGES.systolic),
    diastolic: rangedNumber(VITAL_RANGES.diastolic),
  })
  .refine(bp => bp.systolic > bp.diastolic, {
    message: 'Systolic must be higher than diastolic — check the two are not swapped',
    path: ['systolic'],
  });

/**
 * A date that cannot be in the future.
 *
 * Compared at end-of-day in local time. Comparing against `now` rejects a birth
 * date entered earlier today in any timezone ahead of the server, which is a
 * real and confusing failure for a clinic in SAST.
 */
export const pastDateSchema = z
  .string()
  .min(1, 'Enter a date')
  .refine(value => !Number.isNaN(Date.parse(value)), 'Enter a valid date')
  .refine(value => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return new Date(value) <= endOfToday;
  }, 'This date cannot be in the future');

/** Date of birth: not in the future, and within a plausible human lifespan. */
export const dateOfBirthSchema = pastDateSchema.refine(value => {
  const years = (Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years <= 130;
}, 'Check the year — that date gives an age over 130');

/**
 * SS58 wallet address.
 *
 * Length and alphabet only. A checksum check belongs with the crypto module
 * that owns the encoding, not duplicated here — see `@medichain/shared`'s
 * wallet utilities.
 */
export const walletAddressSchema = z
  .string()
  .min(1, 'Enter a wallet address')
  .regex(/^[1-9A-HJ-NP-Za-km-z]{47,48}$/, 'A wallet address is 47-48 characters, no 0/O/I/l');

/** MediChain patient record id. */
export const patientIdSchema = z
  .string()
  .regex(/^PAT-[0-9a-f]{8}$/, 'A patient id looks like PAT- followed by 8 characters');

/**
 * Phone number, international or local.
 *
 * NOT South-Africa-only. An earlier version required `+27` or a leading `0`,
 * which would have rejected every Ethiopian and Ghanaian number — and this
 * product ships national-ID verifiers for Fayda and the Ghana Card, so those
 * are target markets, not edge cases. A validator that rejects a whole country
 * is worse than none.
 *
 * Accepts E.164 (`+` and 7-15 digits) or a local form of 7-15 digits, ignoring
 * spaces, hyphens and parentheses. Deliberately permissive: the purpose is to
 * catch a truncated or obviously-wrong number, not to prove reachability. Only
 * a test call can do that.
 */
export const phoneSchema = z
  .string()
  .min(1, 'Enter a phone number')
  .refine(value => {
    const digits = value.replace(/[\s\-().]/g, '');
    return /^\+?[0-9]{7,15}$/.test(digits);
  }, 'Enter a phone number with 7 to 15 digits, for example +27821234567 or 0821234567');

/** The stricter South African form, where a caller knows the number is local. */
export const southAfricanPhoneSchema = z
  .string()
  .min(1, 'Enter a phone number')
  .regex(/^(\+27|0)[1-8][0-9]{8}$/, 'Enter a number like 0821234567 or +27821234567');

export const emailSchema = z
  .string()
  .min(1, 'Enter an email address')
  .email('Email addresses need an @ symbol and a domain, like name@clinic.co.za');

/**
 * Free-text clinical note.
 *
 * The upper bound is a storage guard, not a clinical one. Clinicians write long
 * notes and truncating one silently would lose care information, so the limit
 * is generous and the message says the count.
 */
export const clinicalNoteSchema = (max = 10_000) =>
  z.string().max(max, `Notes are limited to ${max.toLocaleString()} characters`);

/** A required non-empty string, with a field-specific message. */
export const requiredText = (fieldLabel: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${fieldLabel}`)
    .max(max, `${fieldLabel} is limited to ${max} characters`);

/**
 * Patient registration.
 *
 * Defined here rather than in the page so the same shape can be reused by the
 * patient app's self-registration and by any future import tool — and so the
 * rules are reviewable in one place instead of spread through JSX.
 *
 * Optional fields are `''`-tolerant on purpose: a blank means "not recorded",
 * which the patient list renders by omission. Forcing a value would push
 * clinicians into entering "unknown" as data.
 */
export const patientRegistrationSchema = z.object({
  fullName: requiredText('the patient’s full name'),
  walletAddress: walletAddressSchema,
  dateOfBirth: dateOfBirthSchema,
  nationalId: requiredText('a national ID number', 64),
  gender: z.string(),
  bloodType: z.string(),
  allergies: clinicalNoteSchema(2_000),
  currentMedications: clinicalNoteSchema(2_000),
  chronicConditions: clinicalNoteSchema(2_000),
  emergencyContactName: requiredText('an emergency contact name'),
  // Not optional, and the strictest field on the form. A broken emergency
  // number is worse than a blank one: it looks usable until the moment someone
  // needs it.
  emergencyContactPhone: phoneSchema,
  emergencyContactRelationship: z.string(),
  organDonor: z.boolean(),
  dnrStatus: z.boolean(),
});

export type PatientRegistration = z.infer<typeof patientRegistrationSchema>;

/**
 * An electronic prescription.
 *
 * The highest-risk form in the product: a malformed dose reaches a pharmacy and
 * then a patient. Every message states the rule to satisfy rather than the
 * state that failed — "Enter a strength, such as 500 mg" rather than "Invalid
 * strength" — which is the difference between a validator's output and a
 * message someone can act on.
 */
export const prescriptionSchema = z.object({
  patient_id: patientIdSchema,
  medication_name: requiredText('the medication name'),
  strength: requiredText('a strength, such as 500 mg', 64),
  form: requiredText('a form', 32),
  /**
   * Quantity and days' supply are bounded because the realistic range is
   * narrow and a stray keystroke is not. A quantity of 1000 tablets is a
   * typo far more often than a prescription, and the pharmacy cannot tell.
   */
  quantity: z.coerce
    .number({ error: 'Enter the quantity to dispense as a number' })
    .int('Enter a whole number of units')
    .min(1, 'Enter a quantity of at least 1')
    .max(1000, 'Quantities above 1000 need a written order, not an e-prescription'),
  days_supply: z.coerce
    .number({ error: "Enter the days' supply as a number" })
    .int('Enter a whole number of days')
    .min(1, "Enter a days' supply of at least 1")
    .max(365, "Enter a days' supply of 365 or fewer"),
  /**
   * Repeats are capped at 12 by the form's own `max`, and stated here too: an
   * attribute the browser enforces is not a rule the server or a paste can be
   * relied on to respect.
   */
  refills_allowed: z.coerce
    .number({ error: 'Enter the number of repeats as a number' })
    .int('Enter a whole number of repeats')
    .min(0, 'Enter 0 repeats or more')
    .max(12, 'Enter 12 repeats or fewer'),
  /** The page's own field name; the API calls this the sig. */
  directions: requiredText('the directions for the patient', 500),
  patient_instructions: clinicalNoteSchema(2_000).optional(),
});

export type PrescriptionInput = z.infer<typeof prescriptionSchema>;

/**
 * A nursing care plan.
 *
 * The page checked `!form.patientId || !form.diagnosis.trim()` and set a banner
 * naming both. A banner cannot say *which* field is wrong, which is the whole
 * of WCAG 3.3.1, and it names two problems when the user has one.
 */
export const carePlanSchema = z.object({
  patientId: requiredText('a patient', 64),
  diagnosis: requiredText('the nursing diagnosis', 500),
  priority: z.enum(['high', 'medium', 'low']),
});

/**
 * A progress note.
 *
 * `hospital_day` is bounded: a stay of 400 days is a typo far more often than an
 * admission, and the note is a legal record of when care happened.
 */
/**
 * A progress note, ready to sign.
 *
 * All four SOAP sections are required *to sign*, because a signed note is the
 * legal record of the encounter and a missing assessment cannot be reconstructed
 * later.
 */
export const progressNoteSchema = z.object({
  patientId: requiredText('a patient', 64),
  noteType: requiredText('a note type', 32),
  subjective: requiredText('what the patient reports', 5_000),
  objective: requiredText('your examination findings', 5_000),
  assessment: requiredText('your assessment', 5_000),
  plan: requiredText('the plan', 5_000),
});

/**
 * The same note, saved as a draft.
 *
 * A draft needs only to know whose note it is. The page used to apply the full
 * requirement to both, so a clinician interrupted mid-note could not save what
 * they had — which is the entire purpose of a draft, and the reason notes get
 * written on paper instead.
 */
export const progressNoteDraftSchema = progressNoteSchema.partial().extend({
  patientId: requiredText('a patient', 64),
});

/**
 * An incident report.
 *
 * Severity and type are closed vocabularies on the server; a free-typed value
 * is stored and then never matches a filter, so the report is filed and
 * invisible to the safety review it exists for.
 */
export const incidentReportSchema = z.object({
  incidentType: requiredText('the incident type', 64),
  severity: requiredText('a severity', 32),
  dateTime: requiredText('when it happened', 64),
  department: requiredText('the department', 64),
  location: requiredText('exactly where it happened', 200),
  /**
   * The description is the report. A safety review reads this and nothing else
   * to decide whether the same thing can happen again, so an empty one files a
   * record that cannot be acted on.
   */
  description: requiredText('what happened', 5_000),
});

/**
 * A specimen collection.
 *
 * The collection time matters more than most timestamps here: a specimen's
 * result is interpreted against when it was taken, not when it reached the lab.
 */
export const specimenSchema = z.object({
  patientId: requiredText('a patient', 64),
  specimenType: requiredText('the specimen type', 64),
  priority: requiredText('a priority', 32),
  /**
   * Required, because a specimen with no test ordered is a tube the laboratory
   * cannot act on -- it is collected from the patient and then discarded.
   */
  testsOrdered: requiredText('the tests to run on this specimen', 500),
  /** Optional: not every specimen type has a meaningful site. */
  collectionSite: z.string().max(200).optional(),
});

/**
 * A wound assessment.
 *
 * Dimensions are in centimetres and bounded at 100: a wound larger than a metre
 * in any direction is a units mistake, and the measurement drives the dressing
 * plan.
 */
/**
 * A wound dimension in centimetres, or blank.
 *
 * **Blank is allowed and means "not measured"** — the page already sends `null`
 * for an empty box, and the record reads that as unmeasured rather than as
 * zero. Requiring a number here would force a nurse who measured length and
 * width but not depth to type a 0, which says the wound is flat (rule 12).
 *
 * When a number IS given it is bounded: a wound over a metre in any direction
 * is a units mistake, and the measurement drives the dressing plan.
 */
const woundDimension = (label: string) =>
  z
    .string()
    .trim()
    .refine(value => value === '' || !Number.isNaN(Number(value)), {
      message: `Enter the ${label} in centimetres, or leave it blank if it was not measured`,
    })
    .refine(value => value === '' || Number(value) >= 0, {
      message: `Enter a ${label} of 0 or more`,
    })
    .refine(value => value === '' || Number(value) <= 100, {
      message: `A ${label} above 100 cm is almost certainly a units mistake`,
    });

export const woundAssessmentSchema = z.object({
  patientId: requiredText('a patient', 64),
  woundType: requiredText('the wound type', 64),
  location: requiredText('where the wound is', 200),
  lengthCm: woundDimension('length'),
  widthCm: woundDimension('width'),
  depthCm: woundDimension('depth'),
});

/**
 * A SOAP note's required core.
 *
 * `SOAPNotePage` holds 26 separate `useState` variables rather than one form
 * object, so this validates an assembled subset: the four fields the note
 * cannot be filed without. The rest are optional by design — a note is written
 * across an encounter, not in one pass.
 */
export const soapNoteSchema = z.object({
  selectedPatientId: requiredText('a patient', 64),
  chiefComplaint: requiredText('the chief complaint', 500),
  clinicalSummary: requiredText('your clinical summary', 5_000),
  treatmentPlan: requiredText('the treatment plan', 5_000),
});

/**
 * Administering (or not administering) a dose.
 *
 * The requirements are conditional, and both directions matter clinically:
 *
 * * **Given** requires the five rights to have been verified. That check is the
 *   whole safety procedure — right patient, drug, dose, route, time — and a MAR
 *   entry claiming a dose was given without it records a verification that did
 *   not happen.
 * * **Not given, held or refused** requires a reason. A blank is the difference
 *   between "the nurse decided to hold this" and "nobody knows what happened to
 *   the 08:00 dose", and only the first is a clinical record.
 */
export const medicationAdministrationSchema = z
  .object({
    actualTime: requiredText('the time the dose was given', 16),
    status: z.enum(['given', 'not-given', 'held', 'refused']),
    fiveRightsVerified: z.boolean(),
    reasonNotGiven: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'given' && !value.fiveRightsVerified) {
      ctx.addIssue({
        code: 'custom',
        path: ['fiveRightsVerified'],
        message: 'Confirm the five rights before recording this dose as given',
      });
    }
    if (value.status !== 'given' && !value.reasonNotGiven.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonNotGiven'],
        message: 'Enter why the dose was not given',
      });
    }
  });

/**
 * One intake or output entry on the fluid balance chart.
 *
 * The amount is bounded at 5,000 mL for a single entry: fluid balance drives
 * resuscitation and diuresis decisions, and a stray zero turning 250 into 2500
 * moves a running total by two litres. A genuine larger volume is recorded as
 * the several administrations it actually was.
 */
export const intakeOutputSchema = z.object({
  amount: z.coerce
    .number({ error: 'Enter the amount as a number' })
    .positive('Enter an amount greater than 0')
    .max(5_000, 'Record volumes above 5,000 mL as separate entries'),
  category: requiredText('a category', 64),
});

/**
 * An operative note.
 *
 * The pre- and post-operative diagnoses are both required, and they are the
 * point of the document: the difference between them is what the operation
 * found. A note recording only one of them cannot answer the question a
 * morbidity review asks first.
 */
export const operativeNoteSchema = z.object({
  selectedPatient: requiredText('a patient', 64),
  procedureName: requiredText('the procedure performed', 300),
  preOpDiagnosis: requiredText('the pre-operative diagnosis', 2_000),
  postOpDiagnosis: requiredText('the post-operative diagnosis', 2_000),
});

/**
 * A history and physical, ready to sign.
 *
 * The chief complaint is the one field the rest of the document is organised
 * around; an H&P without it is a set of findings with no question attached.
 */
export const historyAndPhysicalSchema = z.object({
  patientId: requiredText('a patient', 64),
  chiefComplaint: requiredText('the chief complaint', 500),
});

/**
 * The same document, still in progress.
 *
 * An H&P is written across an admission, not in one sitting, so saving what
 * exists so far needs only to know whose it is. The page applied the full
 * requirement to both, which made 'in progress' mean the same as 'signed'.
 */
export const historyAndPhysicalDraftSchema = z.object({
  patientId: requiredText('a patient', 64),
});

/**
 * An anaesthesia record.
 *
 * The procedure is required because the record is read alongside it: an
 * anaesthetic technique is judged against what was being done, and a record
 * naming neither is not reviewable.
 */
export const anesthesiaRecordSchema = z.object({
  selectedPatient: requiredText('a patient', 64),
  procedure: requiredText('the procedure', 300),
});

/**
 * Acknowledging a critical laboratory value.
 *
 * Read-back is the safety procedure, not paperwork: the clinician who took the
 * call repeats the value so a mis-heard potassium is caught before it is acted
 * on. Recording an acknowledgement without it claims a verification that did
 * not happen -- the same failure as a MAR entry with the five rights unticked.
 */
export const criticalValueAckSchema = z.object({
  notifiedProvider: requiredText('who you notified', 200),
  readBackValue: requiredText('the value the provider read back to you', 200),
});

/**
 * The capacity determination behind an against-medical-advice discharge.
 *
 * A patient who lacks decision-making capacity cannot validly refuse treatment,
 * so an AMA filed without this is not a lawful AMA — the server refuses it with
 * CAPACITY_DETERMINATION_REQUIRED. The *basis* is the part that matters on
 * review: "capacity confirmed" with nothing behind it is an assertion, not a
 * determination.
 */
export const amaCapacitySchema = z.object({
  hasCapacity: z.literal(true, {
    error: 'Confirm the patient has decision-making capacity before filing an AMA',
  }),
  capacityBasis: requiredText('what your capacity determination was based on', 2_000),
});

/**
 * Pre-transfusion observations.
 *
 * All four are required because a transfusion reaction is detected by comparing
 * observations taken during the transfusion against these. A missing baseline
 * does not delay the transfusion — it makes the reaction unrecognisable when it
 * happens.
 */
export const preTransfusionVitalsSchema = z.object({
  preBP: requiredText('the pre-transfusion blood pressure', 16),
  preHR: requiredText('the pre-transfusion heart rate', 8),
  preTemp: requiredText('the pre-transfusion temperature', 8),
  preRR: requiredText('the pre-transfusion respiratory rate', 8),
});

/**
 * A death certificate's registrable core.
 *
 * These are the fields a registrar checks. A certificate missing any of them is
 * not a document with a gap -- it is one that cannot be registered, and the
 * family finds that out at the registry office.
 */
export const deathCertificateSchema = z.object({
  lastName: requiredText("the deceased's surname", 200),
  dateOfDeath: requiredText('the date of death', 32),
  /**
   * The condition that directly led to death, and the line the certificate
   * exists to record. Antecedent causes sit beneath it and are optional; this
   * is not.
   */
  immediateCause: requiredText('the immediate cause of death', 500),
  certifierName: requiredText('the certifying practitioner', 200),
  licenseNumber: requiredText("the certifier's registration number", 64),
});

/**
 * Taking a specimen into evidential custody.
 *
 * The seal number is what makes the chain checkable: it ties this record to the
 * physical container, so a later transfer can prove it handled the same
 * specimen. A break in the chain makes the specimen inadmissible.
 */
export const chainOfCustodySchema = z.object({
  patientId: requiredText('a patient', 64),
  specimenDescription: requiredText('a description of the specimen', 500),
  sealNumber: requiredText('the seal number on the container', 64),
});

/** Handing that specimen to somebody else. */
export const custodyTransferSchema = z.object({
  transferredTo: requiredText('who is taking custody', 200),
  location: requiredText('where the transfer happened', 200),
});

/**
 * Requesting a specialist consultation.
 *
 * The clinical question is the consultation. A referral saying only "please
 * review" makes the consultant guess what was being asked, and the answer comes
 * back addressing something else.
 */
export const consultRequestSchema = z.object({
  patientId: requiredText('a patient', 64),
  reason: requiredText('the reason for referral', 500),
  clinicalQuestion: requiredText('the specific question you want answered', 2_000),
});

/** An autopsy report's registrable core. */
export const autopsyReportSchema = z.object({
  patientId: requiredText('a patient', 64),
  dateOfDeath: requiredText('the date of death', 32),
  causeOfDeath: requiredText('the cause of death', 2_000),
});

/**
 * Administering a vaccine.
 *
 * The lot number is required because it is how a recall reaches the people who
 * received that lot. Without it a batch withdrawal cannot identify anybody.
 */
export const immunizationSchema = z.object({
  patientId: requiredText('a patient', 64),
  vaccineName: requiredText('the vaccine', 200),
  lotNumber: requiredText('the lot number', 64),
});

/**
 * A paediatric assessment.
 *
 * Weight is required and bounded because paediatric dosing is per kilogram: a
 * weight in pounds entered as kilograms roughly doubles every dose calculated
 * from it, and 250 kg is not a child.
 */
export const pediatricAssessmentSchema = z.object({
  patientId: requiredText('a patient', 64),
  weightKg: z
    .string()
    .trim()
    .min(1, 'Enter the weight in kilograms')
    .refine(v => !Number.isNaN(Number(v)), { message: 'Enter the weight as a number of kilograms' })
    .refine(v => Number(v) > 0, { message: 'Enter a weight greater than 0' })
    .refine(v => Number(v) <= 150, {
      message: 'A weight above 150 kg is almost certainly pounds entered as kilograms',
    }),
  heartRate: requiredText('the heart rate', 8),
});

/**
 * An imaging request.
 *
 * The clinical indication is what the radiologist reports against. "CT abdomen"
 * with no indication produces a description of an abdomen; with one it produces
 * an answer.
 */
export const imagingRequestSchema = z.object({
  selectedPatient: requiredText('a patient', 64),
  indication: requiredText('the clinical indication', 1_000),
});

/**
 * A shift handover.
 *
 * The incoming nurse is the point of the document: a handover with nobody named
 * as receiving it records that care was handed to no one, which is exactly the
 * gap a handover exists to close.
 */
export const shiftHandoffSchema = z.object({
  incomingNurse: requiredText('the nurse taking over', 200),
});

/**
 * A patient's own medication reminder.
 *
 * The dose is required alongside the name because the reminder is what the
 * patient acts on: "Metformin" at 08:00 does not say whether to take one tablet
 * or two, and a reminder that has to be checked against something else is not a
 * reminder.
 */
export const medicationReminderSchema = z.object({
  medication: requiredText('the medication name', 200),
  dosage: requiredText('the dose to take', 120),
  /** At least one time, or nothing will ever fire. */
  reminderTimeCount: z.number().min(1, 'Add at least one reminder time'),
});
