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

  it('should apply theme correctly to documentElement', () => {
    const addMock = vi.spyOn(document.documentElement.classList, 'add');
    const removeMock = vi.spyOn(document.documentElement.classList, 'remove');

    useThemeStore.getState().setTheme('dark');
    expect(addMock).toHaveBeenCalledWith('dark');

    useThemeStore.getState().setTheme('light');
    expect(removeMock).toHaveBeenCalledWith('dark');
  });
});
