/**
 * ErrorBoundary Component Tests
 * 
 * Tests for the critical Error Boundary component that prevents
 * white screen crashes in the medical application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, withErrorBoundary, InlineErrorFallback } from '../components/ErrorBoundary';

// Component that throws an error
const ThrowingComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>Component rendered successfully</div>;
};

// Suppress console.error for error boundary tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalError;
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('displays custom title when provided', () => {
    render(
      <ErrorBoundary title="Custom Error Title">
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error Title')).toBeInTheDocument();
  });

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('displays "Try Again" button that resets the error state', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Click "Try Again"
    const tryAgainButton = screen.getByRole('button', { name: /try.*again/i });
    fireEvent.click(tryAgainButton);

    // Re-render with non-throwing component
    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Component rendered successfully')).toBeInTheDocument();
  });

  it('displays medical system notice for healthcare context', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Medical System Notice/)).toBeInTheDocument();
    expect(screen.getByText(/backup access procedures/i)).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeInTheDocument();
    expect(alertElement).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('withErrorBoundary HOC', () => {
  it('wraps component with error boundary', () => {
    const SafeThrowingComponent = withErrorBoundary(ThrowingComponent);
    
    render(<SafeThrowingComponent />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('passes props to wrapped component', () => {
    const TestComponent = ({ message }: { message: string }) => <div>{message}</div>;
    const SafeComponent = withErrorBoundary(TestComponent);

    render(<SafeComponent message="Hello World" />);

    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });
});

describe('InlineErrorFallback', () => {
  it('displays error message', () => {
    const error = new Error('Inline error');
    const resetError = vi.fn();

    render(<InlineErrorFallback error={error} resetError={resetError} />);

    expect(screen.getByText('Inline error')).toBeInTheDocument();
  });

  it('displays component name', () => {
    const resetError = vi.fn();

    render(
      <InlineErrorFallback 
        error={null} 
        resetError={resetError} 
        componentName="PatientList" 
      />
    );

    expect(screen.getByText(/Error loading PatientList/)).toBeInTheDocument();
  });

  it('calls resetError when "Try again" is clicked', () => {
    const resetError = vi.fn();

    render(<InlineErrorFallback error={null} resetError={resetError} />);

    fireEvent.click(screen.getByText('Try again'));
    expect(resetError).toHaveBeenCalledTimes(1);
  });

  it('has proper accessibility role', () => {
    const resetError = vi.fn();

    render(<InlineErrorFallback error={null} resetError={resetError} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
