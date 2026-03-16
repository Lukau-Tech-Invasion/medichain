/**
 * Toast Component Tests
 * 
 * Tests for the toast notification system that replaces browser alerts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ToastProvider, useToast, useToastActions } from '../components/Toast';

// Test component that uses toast hooks
function ToastTestComponent() {
  const { showSuccess, showError, showWarning, showInfo } = useToastActions();
  
  return (
    <div>
      <button onClick={() => showSuccess('Success message')}>Show Success</button>
      <button onClick={() => showError('Error message')}>Show Error</button>
      <button onClick={() => showWarning('Warning message')}>Show Warning</button>
      <button onClick={() => showInfo('Info message')}>Show Info</button>
    </div>
  );
}

// Wrapper with provider
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('Toast Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without errors', () => {
    render(
      <TestWrapper>
        <div>Test content</div>
      </TestWrapper>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('shows success toast when triggered', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Success'));

    await waitFor(() => {
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });
  });

  it('shows error toast when triggered', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Error'));

    await waitFor(() => {
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });
  });

  it('shows warning toast when triggered', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Warning'));

    await waitFor(() => {
      expect(screen.getByText('Warning message')).toBeInTheDocument();
    });
  });

  it('shows info toast when triggered', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Info'));

    await waitFor(() => {
      expect(screen.getByText('Info message')).toBeInTheDocument();
    });
  });

  it('auto-dismisses toast after timeout', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Success'));

    await waitFor(() => {
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });

    // Fast-forward past auto-dismiss timeout (5 seconds)
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });
  });

  it('dismisses toast when close button is clicked', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Success'));

    await waitFor(() => {
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });

    // Find and click dismiss button
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });
  });

  it('can show multiple toasts simultaneously', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));

    await waitFor(() => {
      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });
  });

  it('has proper accessibility attributes', async () => {
    render(
      <TestWrapper>
        <ToastTestComponent />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Show Success'));

    await waitFor(() => {
      const toastContainer = screen.getByRole('status');
      expect(toastContainer).toBeInTheDocument();
      expect(toastContainer).toHaveAttribute('aria-live', 'polite');
    });
  });
});

describe('useToast hook', () => {
  it('provides toast state and actions', () => {
    // Store the hook result in a ref-like pattern for TypeScript
    const hookResultRef: { current: ReturnType<typeof useToast> | null } = { current: null };

    function HookTestComponent() {
      hookResultRef.current = useToast();
      return null;
    }

    render(
      <TestWrapper>
        <HookTestComponent />
      </TestWrapper>
    );

    expect(hookResultRef.current).not.toBeNull();
    expect(hookResultRef.current!.toasts).toBeDefined();
    expect(hookResultRef.current!.addToast).toBeDefined();
    expect(hookResultRef.current!.removeToast).toBeDefined();
  });
});

describe('useToastActions hook', () => {
  it('provides action methods', () => {
    // Store the hook result in a ref-like pattern for TypeScript
    const hookResultRef: { current: ReturnType<typeof useToastActions> | null } = { current: null };

    function HookTestComponent() {
      hookResultRef.current = useToastActions();
      return null;
    }

    render(
      <TestWrapper>
        <HookTestComponent />
      </TestWrapper>
    );

    expect(hookResultRef.current).not.toBeNull();
    expect(typeof hookResultRef.current!.showSuccess).toBe('function');
    expect(typeof hookResultRef.current!.showError).toBe('function');
    expect(typeof hookResultRef.current!.showWarning).toBe('function');
    expect(typeof hookResultRef.current!.showInfo).toBe('function');
  });
});
