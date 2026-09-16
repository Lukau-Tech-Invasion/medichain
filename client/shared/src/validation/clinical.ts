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
