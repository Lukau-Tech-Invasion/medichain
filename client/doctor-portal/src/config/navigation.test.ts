import { describe, expect, it } from 'vitest';
import { getNavForRole, getQuickActionsForRole, rolesOwningRoute } from './navigation';

describe('Paramedic navigation', () => {
  it('exposes emergency workflows without chart navigation', () => {
    const paths = getNavForRole('Paramedic').flatMap(section => section.items.map(item => item.to));
    expect(new Set(paths)).toEqual(new Set(['/emergency', '/ems-handoff', '/mci', '/settings']));
    expect(rolesOwningRoute('Paramedic', '/patients')).not.toEqual([]);
    expect(getQuickActionsForRole('Paramedic').every(action => paths.includes(action.to))).toBe(true);
  });
});
