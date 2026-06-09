# MediChain Frontend Diff Audit

**Date:** 2026-06-09
**Reviewer:** Claude Sonnet 4.6 (automated read-only review)
**Scope:** 24 changed frontend files from the interrupted agent task
**Method:** `git diff HEAD~1` per file, cross-checked against shared source

---

## 1. Summary Table

| File | Classification | # Findings |
|---|---|---|
| `doctor-portal/src/pages/AdminDashboardPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/BarcodePage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/BurnPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/DashboardPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/LabTechDashboardPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/LoginPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/NurseDashboardPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/PharmacistDashboardPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/RegisterPatientPage.tsx` | Partial | 1 |
| `doctor-portal/src/pages/SepsisPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/pages/ShiftHandoffPage.tsx` | Production-ready | 0 |
| `doctor-portal/src/components/EmergencyPatientCard.tsx` | Production-ready | 0 |
| `doctor-portal/src/components/NFCTapSimulator.tsx` | Production-ready | 0 |
| `patient-app/src/pages/AppointmentsPage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/DashboardPage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/InsurancePage.tsx` | Partial | 1 |
| `patient-app/src/pages/LanguageSettingsPage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/LoginPage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/MedicationsPage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/MyProfilePage.tsx` | Production-ready | 0 |
| `patient-app/src/pages/SymptomTrackerPage.tsx` | Production-ready | 0 |
| `shared/src/components/EmergencyBanner.tsx` | Production-ready | 0 |
| `shared/src/components/PatientCard.tsx` | Production-ready | 0 |
| `shared/src/i18n/locales/en-US.ts` | Production-ready | 0 |

**Total findings: 2 (0 Critical, 0 High, 2 Medium, 0 Low)**

---

## 2. Findings

### Finding 1

**Severity:** Medium
**File:** `client/doctor-portal/src/pages/RegisterPatientPage.tsx:68`
**What:** `isValidPhoneNumber(formData.emergencyContactPhone)` is called as a hard gate before submission. The initial value of `emergencyContactPhone` is `''` (empty string). `isValidPhoneNumber('')` returns `false` because the guard `if (!phone ...)` fires first. This means a blank phone field blocks JS submission with a visible `phoneError` message — even though the HTML `required` attribute would have already prevented form submission via the browser's native validation. The two gates are not coordinated: on browsers where the native form validation is active, the HTML `required` fires first and the JS gate is never reached. On programmatic/synthetic submits the JS gate fires instead. The displayed error message ("Enter a valid phone number") is shown when the field is blank, but a blank field would be more informatively described as "Phone number is required".

**Why it matters:** The UX is confusing for the staff member registering a patient: if the field is blank, they see a phone-format error rather than a "field required" error. In an emergency registration workflow, a confusing error may slow down an already-stressed user.

**Suggested fix:** Add a separate blank check before the format check:
```tsx
if (!formData.emergencyContactPhone.trim()) {
  setPhoneError('Emergency contact phone number is required.');
  return;
}
if (!isValidPhoneNumber(formData.emergencyContactPhone)) {
  setPhoneError('Enter a valid phone number (e.g. +234 801 234 5678).');
  return;
}
```

---

### Finding 2

**Severity:** Medium
**File:** `client/patient-app/src/pages/InsurancePage.tsx:599-737`
**What:** All copay and claim amounts now use `formatCurrency(amount, undefined, locale)`. With `locale = 'en-US'` (the platform default), `LOCALE_CONFIGS['en-US'].currency` is `'ZAR'`, so amounts are formatted as South African Rand (e.g. `R 150.00`) via `Intl.NumberFormat`. The demo data for insurance copay amounts is expressed as small integers (e.g. `20`, `40`, `150`) that were previously displayed with a bare `$` prefix as US dollar copays. Those values have no ISO 4217 currency tag in the data model (`InsuranceCard.copay` and `InsuranceClaim.patientResponsibility` are plain `number` fields). The currency change is intentional (Africa-first design), but because the data layer carries no currency code, `formatCurrency` with `undefined` always applies the locale default. For demo users currently seeing the insurance screen with US-dollar-sized copay figures, they will now see `R 20.00`, `R 40.00`, etc., which is arithmetically misleading (R 20 ≈ $1.10) for any real data that originated as USD amounts.

**Why it matters:** A patient or insurer reviewing the insurance card tab may misread their financial obligation. This is not a code crash, but it is a data-display correctness issue that could cause financial confusion.

**Suggested fix:** Extend the `InsuranceCard` and `InsuranceClaim` data types to include a `currency: string` field (ISO 4217 code). Pass that field as the second argument to `formatCurrency`. Until the backend supplies currency metadata, a fallback to `'USD'` is safer for existing demo data than silently converting to ZAR.

---

## 3. Notes on Specific Areas

### LoginPage Verdicts (Auth-Sensitive)

**`doctor-portal/src/pages/LoginPage.tsx`**
The diff is confined entirely to the `DEMO_USERS` array: the `icon` field type changed from `string` (emoji) to `LucideIcon` (component reference), and the render site was updated accordingly to instantiate the icon as `<Icon />`. The auth flow — `login(user.walletAddress)`, `loginWithExtension()`, `clearError()`, `navigate('/dashboard')` — is completely unchanged. Auth state is set via `useAuthStore` as before. No credential handling, no token manipulation, no redirect logic was touched.

**Verdict: Auth logic is intact. No regression. Production-ready.**

**`patient-app/src/pages/LoginPage.tsx`**
Same pattern: `DEMO_PATIENTS.icon` changed from string emoji to `LucideIcon`. All auth paths (`login()`, `loginWithDemoWallet()`, `clearError()`, `navigate('/dashboard')`, the `isAuthenticated` redirect guard) are identical to pre-diff. No auth state mishandling was introduced.

**Verdict: Auth logic is intact. No regression. Production-ready.**

### EmergencyCardPage.tsx (Pre-Verified, Noted for Completeness)

Although this file was marked as already-verified, it was touched in the same commit and contains the new i18n key consumers. Cross-check: all 10 new keys added to `en-US.ts` (`dnrUnverified`, `noneRecorded`, `unverifiedNumber`, `qrAlt`, `qrError`, `refreshFailed`, `copySuccess`, `copyFailed`, `shareFailed`, `shareUnsupportedCopied`) are consumed in `EmergencyCardPage.tsx` and no key is referenced without a matching entry in the locale file.

One apparent ordering concern: `showInfoCopiedInstead` (a `const` arrow function defined at line 260) is called inside `handleShare` at line 240. Because both are `const` declarations within the same function component body, and `handleShare` is only invoked via a click event (well after component initialization), `showInfoCopiedInstead` is defined by the time `handleShare` runs. This is not a runtime bug; the ordering is only a minor style concern.

The `QRCode` library (`qrcode ^1.5.4`) is present in `client/package.json`. The QR generation `useEffect` correctly cancels with a cleanup flag (`cancelled = true`) to prevent stale state updates after unmount.

### LanguageSettingsPage.tsx

The `flag` property was removed from the `Language` interface and replaced with text-badge rendering via `languageBadge(code)`. The `currencySymbolFor` helper safely handles locales not in `SupportedLocale` (like `th-TH`, `nl-NL`, etc.) by falling back to `'R'`. The `handleLanguageSelect` function previously only updated `currencySymbol` for three locale groups (en-US, en-GB/de/fr, ar); all other locales left `currencySymbol` unchanged. This gap existed before the diff and was not introduced by it.

The `handleSaveSettings` function replaced a `setTimeout` simulation with a real `setLanguagePreference` API call. The `catch` block is intentionally empty (documented: "leave the selection applied locally"), which is acceptable since the language preference is a UX setting — not a medical record.

### RegisterPatientPage.tsx — Phone Validation Addition

Beyond Finding 1 (error message wording), the overall change is an improvement: previously no format validation existed for the emergency contact phone, meaning a junk value like "999" could be saved and would later render as a broken `tel:` link in the emergency card. The new gate prevents this. The `isValidPhoneNumber` regex (`/^\+?[1-9]\d{1,14}$/`) matches E.164-ish numbers and is consistent with the `normalizePhone` utility.

---

## 4. Files Confirmed Clean (Zero Findings)

The following 22 files had changes that are purely cosmetic (emoji → Lucide icon, heading `aria-hidden` additions, `EmptyState` component substitution for ad-hoc divs):

`AdminDashboardPage`, `BarcodePage`, `BurnPage`, `DashboardPage`, `LabTechDashboardPage`, `doctor-portal/LoginPage`, `NurseDashboardPage`, `PharmacistDashboardPage`, `SepsisPage`, `ShiftHandoffPage`, `EmergencyPatientCard`, `NFCTapSimulator`, `AppointmentsPage`, `patient-app/DashboardPage`, `patient-app/LoginPage`, `MedicationsPage`, `MyProfilePage`, `SymptomTrackerPage`, `EmergencyBanner`, `PatientCard`, `en-US.ts`, `shared/components/index.ts`.

No logic regressions, no broken handlers, no missing i18n keys, no `as any` / `@ts-ignore`, and no sensitive data in `console.log` calls were found in any of these files.
