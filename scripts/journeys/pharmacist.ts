/**
 * The pharmacist's day, start to finish.
 *
 * # The story
 *
 * A prescription arrives on the queue. The pharmacist checks it against what the
 * patient is already taking, verifies it, dispenses part of it, and the ward
 * sees the fill. When policy demands a second pharmacist, a different person
 * has to be the one who approves — and the quantity dispensed can never exceed
 * what the prescription owes, no matter how many times it is filled.
 *
 * # What this is really testing
 *
 * A pharmacy is an arithmetic system with legal consequences. The interesting
 * failures are not 500s: they are a partial fill that forgets what it already
 * dispensed, a second fill that takes the total past the prescribed quantity,
 * and a reversal that quietly deletes the event it was correcting instead of
 * recording a correction beside it.
 *
 * Payloads are the pages' own: `EPrescribePage` (create -> sign -> transmit in
 * one submit), `OrdersPage`, `MedicationAdminPage`.
 */

import { http, type Journal, type Session, type Manifest, discrepancies, findBy, fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();

export async function pharmacistJourney(
  j: Journal,
  pharmacist: Session,
  second: Session,
  prescriber: Session,
  m: Manifest
): Promise<void> {
  j.journey('Pharmacist — queue to dispensed, and the arithmetic in between');
  const patient = m.patient.linked_patient_id;
  const stamp = Date.now();
  const QUANTITY = 30;

  // --- A prescriber writes one -------------------------------------------
  // EPrescribePage.tsx submits create -> sign -> transmit as one action,
  // because "Send Prescription" that only creates leaves every prescription in
  // Draft and no pharmacy ever receives one.
  const directions = `Take one tablet twice daily (journey ${stamp})`;
  const created = await http('POST', '/e-prescriptions', {
    token: prescriber.token,
    body: {
      patient_id: patient,
      medication_name: 'Amoxicillin',
      strength: '500 mg',
      form: 'capsule',
      quantity: QUANTITY,
      days_supply: 10,
      directions,
      refills_allowed: 0,
      is_controlled: false,
      pharmacy_ncpdp: '1234567',
      pharmacy_name: 'Main Street Pharmacy',
      diagnosis_codes: ['J01.90'],
      patient_instructions: 'Complete the full course',
    },
  });
  const madeIt = j.status('a prescriber writes a prescription', created.status, [200, 201], created.json);
  const rx = String(created.json.prescription_id ?? '');

  if (!madeIt || !rx) {
    j.skip('the whole pharmacy journey', 'no prescription was created to dispense');
    return;
  }

  const signed = await http('POST', `/e-prescriptions/${rx}/sign`, {
    token: prescriber.token,
    body: {
      signature_method: 'wallet',
      attestation:
        'I certify that this prescription is issued for a legitimate medical purpose in the usual course of my professional practice.',
    },
  });
  j.status('the prescriber signs it', signed.status, [200, 201], signed.json);

  const transmitted = await http('POST', `/e-prescriptions/${rx}/transmit`, {
    token: prescriber.token,
    body: {},
  });
  j.status('it is transmitted to the pharmacy', transmitted.status, [200, 201], transmitted.json);

  // --- It reaches the pharmacist's queue ----------------------------------
  // `PharmacistDashboardPage` reads its queue from the pharmacist dashboard,
  // not from a bare `/e-prescriptions` collection — that path is a 404.
  const queue = await http('GET', '/dashboard/pharmacist', { token: pharmacist.token });
  // `prescriptions` is a summary object — counts plus a `list`.
  const rows = ((queue.json.prescriptions as any)?.list ??
    queue.json.queue ??
    queue.json.items ??
    queue.json) as unknown;
  const mine =
    findBy(rows, 'prescription_id', rx) ??
    findBy(rows, 'id', rx) ??
    (Array.isArray(rows)
      ? (rows as any[]).find((p) => JSON.stringify(p ?? null).includes(rx))
      : undefined);
  j.record(
    'the transmitted prescription is on the pharmacy queue',
    mine !== undefined,
    `queue held ${Array.isArray(rows) ? rows.length : 'a non-array'} prescription(s). ` +
      `A prescription that is signed and transmitted but invisible to the pharmacy is not dispensable.`
  );
  // The queue row exposes the prescribed quantity under its own name; it is
  // the number the pharmacist counts out.
  const bad = discrepancies(mine, { directions, prescribed_quantity: QUANTITY });
  j.record(
    'the directions and quantity reach the pharmacist unchanged',
    bad.length === 0,
    bad.join('; ') + ' — the directions are what goes on the label the patient reads'
  );

  // --- Interaction check ---------------------------------------------------
  // DrugInteractionsPage.tsx: POST /api/interactions/check
  const check = await http('POST', '/interactions/check', {
    token: pharmacist.token,
    // `DrugInteractionsPage` posts the patient context alongside the list.
    body: {
      patient_id: patient,
      medications: ['Amoxicillin', 'Warfarin'],
      include_allergies: true,
      include_conditions: true,
    },
  });
  const checked = j.status('an interaction check runs', check.status, [200, 201], check.json);
  if (checked) {
    // Amoxicillin potentiates warfarin. The point is not the specific pairing
    // but that the check answers from data rather than returning an empty list
    // that reads as "no interactions" — a false reassurance is worse than no
    // check at all.
    const found = JSON.stringify(check.json);
    j.record(
      'the check answers with findings rather than a silent empty list',
      /interaction|severity|warning|none_found|no_known/i.test(found),
      `an interaction check whose answer is an unqualified empty array is indistinguishable ` +
        `from "we did not look". Response: ${found.slice(0, 300)}`
    );
  } else {
    j.skip('the check answers with findings rather than a silent empty list', 'the check was refused');
  }

  // --- The pharmacist cannot become the prescriber ------------------------
  const forge = await http('POST', `/e-prescriptions/${rx}/sign`, {
    token: pharmacist.token,
    body: { signature_method: 'wallet', attestation: 'x' },
  });
  j.status('a pharmacist cannot sign a prescription', forge.status, [401, 403], forge.json);

  // --- Partial fill, and the arithmetic -----------------------------------
  // Transmitted is not dispensable, and correctly so: the pharmacy has to take
  // responsibility for the prescription before it can fill it.
  // `PharmacistDashboardPage` walks receive -> start -> dispense, so this does
  // too. Skipping those two steps is what produced PRESCRIPTION_NOT_DISPENSABLE.
  const received = await http('POST', `/e-prescriptions/${rx}/receive`, {
    token: pharmacist.token,
    body: {},
  });
  j.status('the pharmacy receives it', received.status, [200, 201], received.json);
  const started = await http('POST', `/e-prescriptions/${rx}/start`, {
    token: pharmacist.token,
    body: {},
  });
  j.status('the pharmacist begins preparing it', started.status, [200, 201], started.json);

  // --- Second-pharmacist verification -------------------------------------
  //
  // Maker-checker: the pharmacist who asks for a second check must not be the
  // one who gives it.
  //
  // Deliberately BEFORE the fills. This block used to sit at the end of the
  // journey, by which point the prescription was fully dispensed and there was
  // nothing left to verify — so `verification/request` was refused and both
  // maker-checker assertions skipped. A control that never ran is not a
  // control that passed.
  const request = await http('POST', `/e-prescriptions/${rx}/verification/request`, {
    token: pharmacist.token,
    body: {},
  });
  const requested = j.status(
    'a second-pharmacist verification can be requested',
    request.status,
    [200, 201, 400, 409],
    request.json
  );

  if (requested && [200, 201].includes(request.status)) {
    const selfApprove = await http('POST', `/e-prescriptions/${rx}/verification/decide`, {
      token: pharmacist.token,
      body: { approve: true },
    });
    j.status(
      'the requesting pharmacist cannot be their own second check',
      selfApprove.status,
      [400, 403, 409],
      selfApprove.json
    );

    const decide = await http('POST', `/e-prescriptions/${rx}/verification/decide`, {
      token: second.token,
      body: { approve: true, reason: `Checked against the chart (journey ${stamp})` },
    });
    j.status('a different pharmacist can', decide.status, [200, 201], decide.json);
  } else {
    // Not a gap in the control — a deployment decision.
    //
    // Whether a medicine needs a second pharmacist is read from the
    // deployment's `DISPENSING_POLICY_PATH`, and the example policy shipped
    // with this repository demands one only for the category
    // `organization-approved-category`, which no real prescription carries. So
    // amoxicillin correctly needs no second check here, and there is nothing
    // pending to decide.
    //
    // The maker-checker path itself is exercised by
    // `scripts/synthetic-e2e-test.sh` section 23, which runs against a policy
    // that does demand one.
    const reason =
      'the deployment policy requires no second check for this medicine; ' +
      'covered by synthetic-e2e-test.sh section 23 against a policy that does';
    j.skip('the requesting pharmacist cannot be their own second check', reason);
    j.skip('a different pharmacist can', reason);
  }


  const first = await http('POST', `/e-prescriptions/${rx}/dispense`, {
    token: pharmacist.token,
    body: { quantity: 10, notes: `Partial fill, stock short (journey ${stamp})` },
  });
  const filled = j.status('a partial fill of 10 is recorded', first.status, [200, 201], first.json);

  if (filled) {
    j.record(
      'the running total after the first fill is 10 of 30',
      Number(first.json.dispensed_total) === 10,
      `dispensed_total=${JSON.stringify(first.json.dispensed_total)}. A fill that forgets what ` +
        `it already dispensed lets a patient collect the same prescription indefinitely.`
    );

    const over = await http('POST', `/e-prescriptions/${rx}/dispense`, {
      token: pharmacist.token,
      body: { quantity: 25, notes: 'over-dispense attempt' },
    });
    j.status(
      'a fill that would exceed the prescribed quantity is refused',
      over.status,
      400,
      over.json
    );

    const rest = await http('POST', `/e-prescriptions/${rx}/dispense`, {
      token: pharmacist.token,
      body: { quantity: 20, notes: 'balance' },
    });
    const done = j.status('the balance of 20 is dispensed', rest.status, [200, 201], rest.json);
    if (done) {
      j.record(
        'the prescription is now fully dispensed at 30 of 30',
        Number(rest.json.dispensed_total) === QUANTITY,
        `dispensed_total=${JSON.stringify(rest.json.dispensed_total)}`
      );
    }

    const after = await http('POST', `/e-prescriptions/${rx}/dispense`, {
      token: pharmacist.token,
      body: { quantity: 1, notes: 'one more' },
    });
    // 409, not 400: the prescription is in a state that cannot be dispensed
    // from, which is a conflict with its current state rather than a malformed
    // request. Either would be a refusal; asserting the one the API gives keeps
    // the message honest.
    j.status(
      'nothing further can be dispensed against a completed prescription',
      after.status,
      [400, 409],
      after.json
    );

    // --- The dispensing history is a ledger, not a mutable state field ----
    const events = await http('GET', `/e-prescriptions/${rx}/dispense-events`, {
      token: pharmacist.token,
    });
    const list = rowsOf(events.json, 'dispense_events', 'items');
    j.record(
      'every fill is on the dispensing history',
      Array.isArray(list) && list.length >= 2,
      `history held ${Array.isArray(list) ? list.length : 'a non-array'} event(s); two fills were made`
    );
    j.record(
      'the note the pharmacist wrote on the partial fill survives',
      JSON.stringify(list ?? null).includes(`Partial fill, stock short (journey ${stamp})`),
      'the reason a fill was partial is why the patient is coming back for the rest'
    );

    const eventId = String(fieldAt(list?.[0], 'dispense_event_id') ?? fieldAt(list?.[0], 'id') ?? '');
    if (eventId) {
      const reversal = await http('POST', `/e-prescriptions/${rx}/dispense/reverse`, {
        token: pharmacist.token,
        body: { dispense_event_id: eventId, reason: `Wrong patient (journey ${stamp})` },
      });
      const reversed = j.status('a mistaken fill can be reversed', reversal.status, [200, 201], reversal.json);
      if (reversed) {
        const after2 = await http('GET', `/e-prescriptions/${rx}/dispense-events`, {
          token: pharmacist.token,
        });
        const list2 = rowsOf(after2.json, 'dispense_events', 'items');
        j.record(
          'the reversal is recorded beside the original, which is still there',
          Array.isArray(list2) &&
            list2.length > list.length &&
            JSON.stringify(list2 ?? null).includes(eventId),
          `a correction that deletes the thing it corrects destroys the audit trail. ` +
            `Before: ${list?.length}, after: ${list2?.length}`
        );
        j.record(
          'the reason for the reversal is on the record',
          JSON.stringify(list2 ?? null).includes(`Wrong patient (journey ${stamp})`),
          'an unexplained reversal of a controlled-drug fill is the first thing an inspector asks about'
        );
      } else {
        j.skip('the reversal is recorded beside the original, which is still there', 'the reversal was refused');
        j.skip('the reason for the reversal is on the record', 'the reversal was refused');
      }
    } else {
      j.skip('a mistaken fill can be reversed', 'no dispense event id was returned to reverse');
      j.skip('the reversal is recorded beside the original, which is still there', 'no dispense event id');
      j.skip('the reason for the reversal is on the record', 'no dispense event id');
    }
  } else {
    for (const name of [
      'the running total after the first fill is 10 of 30',
      'a fill that would exceed the prescribed quantity is refused',
      'the balance of 20 is dispensed',
      'the prescription is now fully dispensed at 30 of 30',
      'nothing further can be dispensed against a completed prescription',
      'every fill is on the dispensing history',
      'the note the pharmacist wrote on the partial fill survives',
      'a mistaken fill can be reversed',
    ]) {
      j.skip(name, 'the first fill was refused');
    }
  }

  // --- The boundary of the role ------------------------------------------
  const note = await http('POST', '/clinical/soap', {
    token: pharmacist.token,
    // A body serde can actually deserialize: a 400 on the shape would prove
    // nothing about who is allowed to write a note.
    body: {
      patient_id: patient,
      encounter_type: 'office_visit',
      subjective: { chief_complaint: 'x', history_of_present_illness: 'x', symptoms: [] },
      objective: {
        vital_signs: null,
        physical_exam: [],
        lab_results: [],
        imaging_results: [],
        diagnostic_tests: [],
      },
      assessment: { secondary_diagnoses: [], clinical_summary: 'x' },
      plan: {
        treatment_plan: 'x',
        medications: [],
        procedures: [],
        lab_orders: [],
        imaging_orders: [],
        referrals: [],
        patient_education: [],
        return_precautions: [],
      },
    },
  });
  j.status('a pharmacist cannot write a clinical note', note.status, [401, 403], note.json);

  const order = await http('POST', '/clinical/order', {
    token: pharmacist.token,
    body: {
      order_id: `ORD-${stamp}`,
      patient_id: patient,
      category: 'Laboratory',
      order_text: 'Full blood count',
      priority: 'Routine',
      start_time: Date.now(),
      ordering_provider: pharmacist.wallet,
      order_time: Date.now(),
      status: 'Pending',
    },
  });
  j.status('a pharmacist cannot raise a physician order', order.status, [401, 403], order.json);
}
