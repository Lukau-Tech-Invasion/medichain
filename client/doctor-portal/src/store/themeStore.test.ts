import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    // Clear localStorage or reset store
    useThemeStore.setState({
      theme: 'system',
      effectiveTheme: 'light',
    });
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe('system');
  });

  it('should change theme to light', () => {
    useThemeStore.getState().setTheme('light');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(state.effectiveTheme).toBe('light');
  });

  it('should change theme to dark', () => {
    useThemeStore.getState().setTheme('dark');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.effectiveTheme).toBe('dark');
  });

  // Asserts the STATE of the document, not which classList method reached it.
  // The previous version spied on `add` and `remove`, so moving to
  // `classList.toggle('dark', isDark)` -- one call that cannot leave the two
  // out of step -- failed a test about an implementation detail while the
  // behaviour was unchanged.
  it('puts the theme on the document', () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // `color-scheme` is what makes the browser paint form controls,
    // scrollbars and autofill from the matching palette. Without it a dark
    // page still renders a white input with white text in it, which is the
    // defect this store is now responsible for not causing.
    expect(document.documentElement.style.colorScheme).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
