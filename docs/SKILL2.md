
# Testing Strategy for MediChain

A bug in MediChain isn't a UI annoyance — it's a leaked record or a paramedic seeing
the wrong allergies. Tests are non-negotiable.

---

## The Pyramid (MediChain version)

Aim: 100s of unit tests that run in <10 seconds. Dozens of integration tests in <2 minutes.
A handful of E2E tests in <10 minutes. CI feedback under 15 min total.

---

## Rust Unit Tests

```rust
// crates/shared/src/blood.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BloodType { OPos, ONeg, APos, ANeg, BPos, BNeg, ABPos, ABNeg }

pub fn can_donate_to(donor: BloodType, recipient: BloodType) -> bool {
    use BloodType::*;
    match (donor, recipient) {
        (ONeg, _) => true,                     // universal donor
        (_, ABPos) => true,                    // universal recipient
        // ... full compatibility matrix
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use BloodType::*;

    #[test]
    fn o_neg_donates_to_anyone() {
        for r in [OPos, ONeg, APos, ANeg, BPos, BNeg, ABPos, ABNeg] {
            assert!(can_donate_to(ONeg, r), "ONeg → {r:?} should be allowed");
        }
    }

    #[test]
    fn ab_pos_receives_from_anyone() {
        for d in [OPos, ONeg, APos, ANeg, BPos, BNeg, ABPos, ABNeg] {
            assert!(can_donate_to(d, ABPos), "{d:?} → ABPos should be allowed");
        }
    }

    #[test]
    fn a_pos_cannot_donate_to_o_pos() {
        assert!(!can_donate_to(APos, OPos));
    }
}
```

Run: `cargo nextest run` (faster than `cargo test`, better output).

---

## Property Testing for Arithmetic

For things that should hold over many inputs:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn checked_consent_duration_never_overflows(
        days in 0u32..u32::MAX,
        now in 0i64..i64::MAX / 2,
    ) {
        // duration in seconds = days * 86400
        let secs = (days as i64).checked_mul(86_400);
        match secs {
            Some(s) => prop_assert!(now.checked_add(s).is_some() || s > i64::MAX - now),
            None => prop_assert!(days > (u32::MAX / 86_400)),
        }
    }
}
```

Property tests catch the inputs you didn't think of — the empty list, the maximum value,
the off-by-one. Use them for any function with non-trivial input space.

---

## Backend Tests (axum)

```rust
// crates/backend/tests/consents_api.rs
use axum::http::StatusCode;
use axum_test::TestServer;
use medichain_backend::app;

#[tokio::test]
async fn grant_consent_requires_auth() {
    let server = TestServer::new(app(test_state())).unwrap();
    let response = server.post("/api/v1/patients/me/consents")
        .json(&serde_json::json!({ "grantee": "...", "scope": 6, "duration_days": 90 }))
        .await;
    assert_eq!(response.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn grant_consent_idempotency() {
    let server = TestServer::new(app(test_state())).unwrap();
    let key = "test-key-001";

    let r1 = server.post("/api/v1/patients/me/consents")
        .add_header("Authorization", "Bearer test-jwt")
        .add_header("Idempotency-Key", key)
        .json(&payload())
        .await;
    let r2 = server.post("/api/v1/patients/me/consents")
        .add_header("Authorization", "Bearer test-jwt")
        .add_header("Idempotency-Key", key)
        .json(&payload())
        .await;

    assert_eq!(r1.status_code(), StatusCode::CREATED);
    assert_eq!(r2.status_code(), StatusCode::CREATED);
    assert_eq!(r1.json::<serde_json::Value>(), r2.json::<serde_json::Value>());
}
```

---

## Frontend Tests

**Vitest + React Testing Library** for component/hook tests:

```tsx
// src/components/ConsentToggle.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsentToggle } from "./ConsentToggle";

test("shows confirm modal before revoking", async () => {
  const onRevoke = vi.fn();
  render(<ConsentToggle granted onRevoke={onRevoke} doctorName="Dr Smith" />);

  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText(/revoke access for Dr Smith/i)).toBeInTheDocument();
  expect(onRevoke).not.toHaveBeenCalled();           // not yet — needs confirm

  fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
  expect(onRevoke).toHaveBeenCalledOnce();
});
```

Test from the user's perspective: roles, labels, what they see — not implementation
details (state names, internal callbacks).

---

## E2E (Playwright)

For the critical paramedic flow:

```ts
// e2e/paramedic-emergency.spec.ts
test("paramedic reads emergency data within 3 seconds", async ({ page }) => {
  // Simulate NFC tap by navigating to the URL the tag would emit
  const cardUrl = await issueTestCard(testPatientId);

  const start = Date.now();
  await page.goto(cardUrl);
  await page.fill('[name="paramedic-id"]', "TEST-PARAMEDIC-001");
  await page.click('button:has-text("Confirm identity")');

  await expect(page.locator('[data-testid="blood-type"]')).toBeVisible();
  await expect(page.locator('[data-testid="blood-type"]')).toContainText("O+");

  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(3000);   // 3-second pitch promise
});
```

---

## The "Bug → Test → Fix" Workflow

Every bug report:
1. Reproduce the bug locally
2. Write a test that fails because of the bug
3. Fix the code until the test passes
4. The test now lives forever as a regression guard

This is non-negotiable. A bug fixed without a test will return.

---

## Coverage Targets

- **Shared / domain logic crates**: 90%+ line coverage
- **Backend**: every route has at least one test, every error path covered
- **Frontend**: every form, every transaction flow, every error state
- **E2E**: paramedic flow, patient onboarding, doctor consent grant

Don't chase 100%. The last 5% is usually error paths that are easier to verify by reading.

---

## What NOT to Test

- ❌ The framework (axum's router, React's reconciler — they have their own tests)
- ❌ Trivial getters/setters (`get_id() { self.id }`)
- ❌ Logging output (test the behaviour, not "did we log this string")
- ❌ Pure type definitions (the compiler tests these)
- ❌ Implementation details that change every refactor

---

## CI Setup

Tests must be green before merge. Period.
