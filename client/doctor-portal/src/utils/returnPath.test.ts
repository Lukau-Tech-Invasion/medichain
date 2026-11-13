import { describe, expect, it } from 'vitest';
import { returnPathFrom } from '@medichain/shared';

describe('returnPathFrom', () => {
  it('returns to the page a protected route was asked for', () => {
    expect(returnPathFrom({ from: { pathname: '/soap', search: '?patient=PAT-1', hash: '#plan' } })).toBe(
      '/soap?patient=PAT-1#plan'
    );
  });

  it('falls back to the dashboard when nothing was recorded', () => {
    expect(returnPathFrom(null)).toBe('/dashboard');
    expect(returnPathFrom({})).toBe('/dashboard');
    expect(returnPathFrom({ from: { pathname: 42 } })).toBe('/dashboard');
  });

  it('never leaves the application', () => {
    expect(returnPathFrom({ from: { pathname: '//evil.example/x' } })).toBe('/dashboard');
    expect(returnPathFrom({ from: { pathname: 'https://evil.example/' } })).toBe('/dashboard');
    expect(returnPathFrom({ from: { pathname: '/\\evil.example' } })).toBe('/dashboard');
  });

  it('does not loop back to the sign-in or activation page', () => {
    expect(returnPathFrom({ from: { pathname: '/login' } })).toBe('/dashboard');
    expect(returnPathFrom({ from: { pathname: '/activate' } })).toBe('/dashboard');
  });

  it('drops a malformed query or fragment rather than the path', () => {
    expect(returnPathFrom({ from: { pathname: '/mar', search: 'x=1', hash: 'y' } })).toBe('/mar');
  });
});
