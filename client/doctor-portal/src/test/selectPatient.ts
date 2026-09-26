import { fireEvent, screen, waitFor, within } from '@testing-library/react';

/**
 * Choose a patient through the searchable picker.
 *
 * Screens used to ask for a patient with a bare text box or a native
 * `<select>`, so a test set the value in one `fireEvent.change`. `PatientSelect`
 * is a combobox: it queries the server as the clinician types and the choice is
 * made by pressing a result. Tests drive it the way a person does.
 *
 * The calling test must have `getPatients` mocked to return the patient it is
 * about to choose — which is also what makes the test honest, because the page
 * can only file a record against a patient the server knows.
 */
export async function selectPatient(
  label: RegExp | string,
  fullName: string,
  /** The picker's `id`, when a screen carries several "Patient" labels. */
  inputId?: string
) {
  const input = inputId
    ? (document.getElementById(inputId) as HTMLInputElement)
    : screen.getByLabelText(label);
  if (!input) throw new Error(`No patient picker ${inputId ?? String(label)}`);
  fireEvent.change(input, { target: { value: fullName.slice(0, 4) } });

  // The picker debounces its query, so the option appears a tick later.
  const option = await waitFor(() =>
    screen.getByRole('button', { name: new RegExp(fullName, 'i') })
  );
  fireEvent.click(option);

  // WP10: the first time a patient is picked in a tab, the clinician says why
  // and the server opens an access context. Answer the way a clinician does.
  // The calling test's fetch mock answers the access-context POST.
  const reasonDialog = screen.queryByRole('dialog');
  if (reasonDialog) {
    fireEvent.click(within(reasonDialog).getByRole('button', { name: 'Treatment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  // `getAllBy`: a page may echo the chosen patient's name elsewhere (the AMA
  // form shows it under the picker), and one match is enough to prove the
  // selection landed.
  await waitFor(() => expect(screen.getAllByText(fullName).length).toBeGreaterThan(0));
}

/** The shape `PatientSelect` reads, for a test's `getPatients` mock. */
export function patientFixture(overrides: Partial<{
  patient_id: string;
  full_name: string;
  health_id: string;
  date_of_birth: string;
}> = {}) {
  return {
    patient_id: 'PAT-001',
    full_name: 'Test Patient',
    health_id: 'HID-001',
    date_of_birth: '1980-01-01',
    ...overrides,
  };
}

