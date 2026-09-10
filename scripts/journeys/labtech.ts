/**
 * The lab technician's day, start to finish.
 *
 * # The story
 *
 * A specimen is collected at the bedside and labelled. Its chain of custody is
 * opened. The analyser's control is run and recorded before any patient sample
 * is reported off it. A result comes out critically abnormal, so the technician
 * raises a critical value and it reaches the ordering clinician. A type-and-
 * screen is ordered for a patient who needs blood, and the transfusion is
 * documented against it. Finally the result the technician submitted is
 * reviewed — by somebody else, because a lab that signs off its own work is not
 * a lab.
 *
 * # Why this role in particular
 *
 * Of the nine screens in `LAB_TECH_NAV`, exactly one had ever had its Save
 * button driven against a live server. The lab is also the role whose output
 * other people act on without seeing how it was produced: a potassium of 6.9
 * changes what a doctor prescribes, and nobody re-runs it.
 *
 * Every payload below is the object the corresponding page builds.
 */

import { http, type Journal, type Session, type Manifest, discrepancies, findBy, fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export async function labTechJourney(
  j: Journal,
  lab: Session,
  reviewer: Session,
  m: Manifest
): Promise<void> {
  j.journey('Lab technician — collection to reported result');
  const patient = m.patient.linked_patient_id;
  const stamp = Date.now();

  // --- Specimen collection ------------------------------------------------
  // SpecimenPage.tsx: POST /api/clinical/specimen
  const collectionNote = `Journey harness collection ${stamp}`;
  const spec = await http('POST', '/clinical/specimen', {
    token: lab.token,
    body: {
      patient_id: patient,
      specimen_type: 'blood',
      priority: 'stat',
      tests_ordered: 'Urea and electrolytes, Full blood count',
      collection_site: 'Left antecubital fossa',
      notes: collectionNote,
      checklist: ['identity confirmed', 'label applied', 'tube inverted'],
    },
  });
  const collected = j.status('a specimen is collected', spec.status, [200, 201], spec.json);
  const collectionId = String(spec.json.collection_id ?? '');
  const submissionId = String(spec.json.submission_id ?? '');

  if (collected) {
    j.record(
      'the collection raises the lab submission it belongs to',
      submissionId.startsWith('LAB-'),
      `a specimen cannot stand alone — specimen_collections.submission_id is a NOT NULL ` +
        `foreign key. Response: ${JSON.stringify(spec.json)}`
    );
    const list = await http('GET', '/clinical/specimens', { token: lab.token });
    const rows = rowsOf(list.json, 'specimens', 'items');
    const mine =
      findBy(rows, 'collection_id', collectionId) ??
      findBy(rows, 'id', collectionId) ??
      (Array.isArray(rows)
        ? (rows as any[]).find((r) => JSON.stringify(r ?? null).includes(collectionNote))
        : undefined);
    const bad = discrepancies(mine, { patient_id: patient });
    j.record(
      'the specimen is on the collection worklist',
      bad.length === 0,
      bad.join('; ') + ` — worklist held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s)`
    );
    j.record(
      'the collection site and the safety checklist survive the write',
      mine !== undefined &&
        JSON.stringify(mine ?? null).includes('antecubital') &&
        JSON.stringify(mine ?? null).includes('identity confirmed'),
      `the checklist is the record that the right blood came out of the right arm. ` +
        `Stored: ${JSON.stringify(mine ?? {}).slice(0, 400)}`
    );
  } else {
    j.skip('the collection raises the lab submission it belongs to', 'collection was refused');
    j.skip('the specimen is on the collection worklist', 'collection was refused');
    j.skip('the collection site and the safety checklist survive the write', 'collection was refused');
  }

  // --- Chain of custody ---------------------------------------------------
  // ChainOfCustodyPage.tsx: POST via createChainOfCustody, camelCase throughout.
  const custodyId = `COC-${stamp}`;
  const seal = `SEAL-${stamp}`;
  const custody = await http('POST', '/clinical/chain-of-custody', {
    token: lab.token,
    body: {
      custodyId,
      patientId: patient,
      patientName: 'Thandiwe Browser-Test',
      specimenType: 'blood',
      specimenDescription: 'Two EDTA tubes, one clotted',
      collectionDate: today(),
      collectionTime: '08:15',
      collectedBy: lab.wallet,
      collectionLocation: 'Ward 3',
      purpose: 'clinical',
      caseNumber: '',
      investigatingAgency: '',
      status: 'collected',
      sealNumber: seal,
      containerType: 'vacutainer',
      quantity: '2 x 4 mL',
      currentCustodian: lab.userId,
      currentLocation: 'Ward 3',
      storageConditions: 'refrigerated',
      integrityVerified: true,
      transfers: [],
      notes: `Journey harness ${stamp}`,
    },
  });
  const custodyOk = j.status('a chain of custody is opened', custody.status, [200, 201], custody.json);

  if (custodyOk) {
    const list = await http('GET', '/platform/list/chain-of-custody', { token: lab.token });
    const rows = rowsOf(list.json, 'records', 'items');
    const carries = JSON.stringify(rows ?? null).includes(seal);
    j.record(
      'the seal number is readable on the custody register',
      carries,
      `an unbroken seal number is the whole point of a chain of custody. ` +
        `Register held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s).`
    );
  } else {
    j.skip('the seal number is readable on the custody register', 'the custody record was refused');
  }

  // --- Quality control ----------------------------------------------------
  // LabQCPage.tsx: POST via createLabQc. A control that fails Westgard rules is
  // the interesting case: the run is the reason patient results are held.
  const qcId = `QC-${stamp}`;
  const qc = await http('POST', '/clinical/lab-qc', {
    token: lab.token,
    body: {
      testId: qcId,
      date: today(),
      time: '07:45',
      instrument: 'Cobas c311',
      analyte: 'Potassium',
      level: 'Level 2',
      lotNumber: `LOT-${stamp}`,
      expiryDate: '2027-01-31',
      observedValue: 6.4,
      expectedMean: 5.0,
      expectedSD: 0.2,
      unit: 'mmol/L',
      result: 'fail',
      violatedRules: ['1_3s'],
      performedBy: lab.userId,
      correctiveAction: 'Recalibrated, control repeated',
      comments: `Journey harness ${stamp}`,
    },
  });
  const qcOk = j.status('a failed QC run is recorded', qc.status, [200, 201], qc.json);

  if (qcOk) {
    const list = await http('GET', '/platform/list/lab-qc', { token: lab.token });
    const rows = rowsOf(list.json, 'records', 'items');
    const mine =
      findBy(rows, 'test_id', qcId) ??
      findBy(rows, 'id', qcId) ??
      (Array.isArray(rows)
        ? (rows as any[]).find((r) => JSON.stringify(r ?? null).includes(String(stamp)))
        : undefined);
    j.record(
      'the QC run is on the register',
      mine !== undefined || JSON.stringify(rows ?? null).includes(qcId),
      `register held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s)`
    );
    j.record(
      'the Westgard rule that failed, and what was done about it, survive',
      JSON.stringify(rows ?? null).includes('1_3s') && JSON.stringify(rows ?? null).includes('Recalibrated'),
      `a failed control with no rule and no corrective action is an audit finding, not a QC record`
    );
  } else {
    j.skip('the QC run is on the register', 'the QC run was refused');
    j.skip('the Westgard rule that failed, and what was done about it, survive', 'the QC run was refused');
  }

  // --- Critical value -----------------------------------------------------
  // CriticalValuePage.tsx: POST via createCriticalValue, camelCase.
  const cvId = `CV-${stamp}`;
  const cv = await http('POST', '/clinical/critical-value', {
    token: lab.token,
    body: {
      notificationId: cvId,
      patientId: patient,
      patientName: 'Thandiwe Browser-Test',
      analyte: 'Potassium',
      value: 6.9,
      unit: 'mmol/L',
      criticalLevel: 'critical-high',
      thresholdExceeded: 6.0,
      reportedBy: lab.userId,
      reportedAt: iso(),
      orderingProvider: reviewer.wallet,
      notificationStatus: 'pending',
    },
  });
  const cvOk = j.status('a critical value is raised', cv.status, [200, 201], cv.json);

  if (cvOk) {
    // The clinician's worklist, not the lab's. A critical value that only the
    // lab can see has not been communicated, and communication is the entire
    // regulatory obligation attached to one.
    const list = await http('GET', '/platform/list/critical-values', { token: reviewer.token });
    const rows = rowsOf(list.json, 'values', 'items');
    // The server generates the notification id — a client-supplied one would
    // let a second submission overwrite the first — so the record is found by
    // the value that was raised.
    const mine = (rows as any[]).find(
      (row) => JSON.stringify(row ?? null).includes(String(stamp)) || Number(fieldAt(row, 'value')) === 6.9
    );
    j.record(
      'the ordering clinician can see the critical value',
      mine !== undefined,
      `the clinician's list held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s)`
    );
    const bad = discrepancies(mine, { value: 6.9, unit: 'mmol/L' });
    j.record(
      'the value and its unit read back exactly',
      bad.length === 0,
      bad.join('; ') + ' — a potassium with no unit is a number nobody can act on'
    );
  } else {
    j.skip('the ordering clinician can see the critical value', 'the critical value was refused');
    j.skip('the value and its unit read back exactly', 'the critical value was refused');
  }

  // --- Blood bank ---------------------------------------------------------
  // BloodBankPage.tsx: createBloodTypeScreen then createTransfusion.
  const bbId = `BB-${stamp}`;
  const screen = await http('POST', '/surgical/blood-type', {
    token: lab.token,
    body: {
      orderId: bbId,
      patientId: patient,
      patientName: 'Thandiwe Browser-Test',
      bloodType: 'O+',
      orderDate: today(),
      orderTime: '09:00',
      orderedBy: lab.userId,
      product: 'packed_red_cells',
      units: 2,
      indication: `Symptomatic anaemia (journey ${stamp})`,
      priority: 'routine',
      status: 'ordered',
    },
  });
  const screenOk = j.status('a type-and-screen is ordered', screen.status, [200, 201], screen.json);

  if (screenOk) {
    const transfusion = await http('POST', '/surgical/transfusion', {
      token: lab.token,
      body: {
        orderId: bbId,
        patientId: patient,
        bloodType: 'O+',
        product: 'packed_red_cells',
        units: 2,
        status: 'completed',
        transfusionInfo: {
          startTime: '10:00',
          endTime: '13:30',
          administeredBy: lab.userId,
          witnessedBy: reviewer.userId,
          preVitals: { bp: '118/74', hr: 88, temp: 36.8, rr: 16 },
          postVitals: { bp: '122/78', hr: 82, temp: 37.0, rr: 15 },
          reactions: [],
          notes: `Journey harness ${stamp}`,
        },
      },
    });
    const txOk = j.status('the transfusion is documented', transfusion.status, [200, 201], transfusion.json);

    if (txOk) {
      const list = await http('GET', '/platform/list/blood-bank', { token: lab.token });
      // Screens and transfusions both live on the register.
      const rows = [
        ...rowsOf(list.json, 'screens'),
        ...rowsOf(list.json, 'transfusions'),
      ];
      const carries = JSON.stringify(rows ?? null).includes(String(stamp));
      j.record(
        'the transfusion is on the register',
        Boolean(carries),
        `register held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s)`
      );
      // Pre- and post-transfusion observations are the reaction surveillance.
      // A transfusion record without them cannot answer the one question asked
      // after an incident.
      j.record(
        'the pre- and post-transfusion observations survive',
        JSON.stringify(rows ?? null).includes('118/74') && JSON.stringify(rows ?? null).includes('122/78'),
        'pre/post vitals are how a transfusion reaction is detected and later proven'
      );
      j.record(
        'the second person who checked the unit is recorded',
        JSON.stringify(rows ?? null).includes(reviewer.userId),
        'a two-person check with only one name is a one-person check'
      );
    } else {
      j.skip('the transfusion is on the register', 'the transfusion was refused');
      j.skip('the pre- and post-transfusion observations survive', 'the transfusion was refused');
      j.skip('the second person who checked the unit is recorded', 'the transfusion was refused');
    }
  } else {
    j.skip('the transfusion is documented', 'the type-and-screen was refused');
    j.skip('the transfusion is on the register', 'the type-and-screen was refused');
    j.skip('the pre- and post-transfusion observations survive', 'the type-and-screen was refused');
    j.skip('the second person who checked the unit is recorded', 'the type-and-screen was refused');
  }

  // --- The result leaves the lab -----------------------------------------
  // `LabResultsPage.tsx`: POST /api/lab/submissions/{id}/review with
  // `{action: 'approve'}`.
  //
  // The submission reviewed here is a RESULT submission
  // (`POST /api/lab/submit`), not the lab ORDER that `create_specimen` raises.
  // They are different stores and different things: `lab_submissions` is the
  // order the collection implies, `lab_result_submissions` is the result a
  // technician offers for a clinician to approve. Reviewing an order id is a
  // correct 404, and the journey used to do exactly that.
  const resultValue = `14.${stamp % 10}`;
  const submitted = await http('POST', '/lab/submit', {
    token: lab.token,
    body: {
      patient_id: patient,
      test_name: 'Full blood count',
      test_category: 'Haematology',
      results: [
        {
          parameter: 'Haemoglobin',
          value: resultValue,
          unit: 'g/dL',
          reference_range: '12.0-17.5',
          flag: null,
        },
      ],
      notes: `Journey harness ${stamp}`,
    },
  });
  const submittedOk = j.status('a result is submitted for review', submitted.status, [200, 201], submitted.json);
  const resultId = String(submitted.json.submission_id ?? submitted.json.id ?? '');

  if (submittedOk && resultId) {
    const self = await http('POST', `/lab/submissions/${resultId}/review`, {
      token: lab.token,
      body: { action: 'approve' },
    });
    j.status(
      'the technician who raised the submission cannot approve it',
      self.status,
      403,
      self.json
    );

    const review = await http('POST', `/lab/submissions/${resultId}/review`, {
      token: reviewer.token,
      body: { action: 'approve' },
    });
    const approved = j.status('a clinician approves it', review.status, [200, 201], review.json);

    if (approved) {
      const subs = await http('GET', '/lab/submissions?status=approved', { token: lab.token });
      const rows = rowsOf(subs.json, 'submissions', 'items');
      const mine = findBy(rows, 'id', resultId) ?? findBy(rows, 'submission_id', resultId);
      j.record(
        'the approved submission shows who approved it and when',
        mine !== undefined &&
          fieldAt(mine, 'reviewed_by') === reviewer.wallet &&
          Boolean(fieldAt(mine, 'reviewed_at')),
        `an approved result with no reviewer and no time on it cannot be audited. ` +
          `Stored: ${JSON.stringify(mine ?? null).slice(0, 300)}`
      );
      j.record(
        'the value the technician measured is what the clinician approved',
        JSON.stringify(mine ?? null).includes(resultValue),
        `a review that approves a different number than the one submitted is worse ` +
          `than no review`
      );

      const again = await http('POST', `/lab/submissions/${resultId}/review`, {
        token: reviewer.token,
        body: { action: 'reject', rejection_reason: 'changed my mind' },
      });
      j.status(
        'an approved result cannot be quietly overturned',
        again.status,
        [400, 403, 409],
        again.json
      );
    } else {
      for (const n of [
        'the approved submission shows who approved it and when',
        'the value the technician measured is what the clinician approved',
        'an approved result cannot be quietly overturned',
      ]) {
        j.skip(n, 'the review was refused');
      }
    }
  } else {
    for (const n of [
      'the technician who raised the submission cannot approve it',
      'a clinician approves it',
      'the approved submission shows who approved it and when',
      'the value the technician measured is what the clinician approved',
      'an approved result cannot be quietly overturned',
    ]) {
      j.skip(n, 'no result was submitted');
    }
  }

  // --- The boundary of the role ------------------------------------------
  // A lab technician analyses samples. They do not prescribe, and they do not
  // chart observations at the bedside.
  const rx = await http('POST', '/e-prescriptions', {
    token: lab.token,
    body: {
      patient_id: patient,
      medication_name: 'Amoxicillin',
      strength: '500 mg',
      form: 'capsule',
      quantity: 21,
      days_supply: 7,
      directions: 'One three times daily',
      refills_allowed: 0,
      is_controlled: false,
      pharmacy_ncpdp: '1234567',
      pharmacy_name: 'Main Street Pharmacy',
      diagnosis_codes: ['J01.90'],
      patient_instructions: 'Complete the full course',
    },
  });
  j.status('a lab technician cannot write a prescription', rx.status, [401, 403], rx.json);

  const vitals = await http('POST', '/clinical/vitals', {
    token: lab.token,
    body: { patient_id: patient, heart_rate: 80 },
  });
  j.status('a lab technician cannot chart observations', vitals.status, [401, 403], vitals.json);
}
