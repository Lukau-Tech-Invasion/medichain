import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import LoginPage from './LoginPage';
import { useAuthStore } from '../store';

/**
 * Automated WCAG 2.2 AA smoke coverage for the sign-in page.
 *
 * WHY THIS FILE EXISTS
 *
 * `axe-core` has been a declared devDependency of this portal for some time and
 * was imported by exactly nothing. A dependency that implies accessibility
 * testing without performing any is worse than its absence, because it answers
 * the question "do we test this?" incorrectly.
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 *
 * axe detects roughly a third of WCAG failures. It finds missing form labels,
 * missing accessible names, bad ARIA, and contrast problems it can compute. It
 * cannot judge focus order, keyboard traps, whether an error message is
 * announced, or whether a visible focus ring is actually visible. Those need a
 * real browser and a person, and are recorded separately in the campaign
 * ledger rather than being implied by a green run here.
 *
 * The sign-in page is the right first target: it is the only screen every user
 * of this portal must pass through, and it is a form, which is where automated
 * checking is most productive.
 */

vi.mock('../store', () => ({
    useAuthStore: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
    const actual: any = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => vi.fn() };
});

/** The rule set that corresponds to WCAG 2.2 Level AA. */
const WCAG22AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violationsFor(ui: React.ReactElement) {
    const { container } = render(<MemoryRouter>{ui}</MemoryRouter>);
    const results = await axe.run(container, {
        runOnly: { type: 'tag', values: WCAG22AA },
        // jsdom computes no layout, so axe cannot resolve a background it must
        // sample from a rendered pixel. Contrast is covered instead by
        // `scripts/check-contrast.py`, which checks all 52 token pairs across
        // both themes at the source of truth. Leaving the rule enabled here
        // would produce "incomplete" noise, not a finding.
        rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations;
}

function describeViolations(violations: axe.Result[]) {
    return violations
        .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.html).join('\n    ')}`)
        .join('\n  ');
}

/**
 * Proves the scanner can fail.
 *
 * A green accessibility suite is only meaningful if the scanner would have gone
 * red on a real defect. This renders a text input with no label and no
 * accessible name -- the single most common real-world WCAG failure -- and
 * asserts axe reports it. If this test ever passes with an empty violation
 * list, the configuration above has stopped checking anything and the two
 * assertions below it are worthless.
 */
describe('the accessibility scanner itself', () => {
    it('reports a violation for an input with no accessible name', async () => {
        const { container } = render(
            <MemoryRouter>
                <input type="text" />
            </MemoryRouter>,
        );
        const results = await axe.run(container, {
            runOnly: { type: 'tag', values: WCAG22AA },
            rules: { 'color-contrast': { enabled: false } },
        });
        expect(results.violations.map((v) => v.id)).toContain('label');
    });
});

describe('LoginPage accessibility (WCAG 2.2 AA, automated subset)', () => {
    beforeEach(() => {
        (useAuthStore as any).mockReturnValue({
            login: vi.fn(),
            loginWithCredentials: vi.fn(),
            loginWithExtension: vi.fn(),
            isLoading: false,
            error: null,
            clearError: vi.fn(),
            isAuthenticated: false,
        });
    });

    it('has no automatically detectable WCAG 2.2 AA violations', async () => {
        const violations = await violationsFor(<LoginPage />);
        expect(
            violations,
            violations.length ? `\n  ${describeViolations(violations)}` : '',
        ).toEqual([]);
    });

    it('still has none while showing an error, the state most likely to add unlabelled content', async () => {
        (useAuthStore as any).mockReturnValue({
            login: vi.fn(),
            loginWithCredentials: vi.fn(),
            loginWithExtension: vi.fn(),
            isLoading: false,
            error: 'Those credentials were not recognised',
            clearError: vi.fn(),
            isAuthenticated: false,
        });
        const violations = await violationsFor(<LoginPage />);
        expect(
            violations,
            violations.length ? `\n  ${describeViolations(violations)}` : '',
        ).toEqual([]);
    });
});
