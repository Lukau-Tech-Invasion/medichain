import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

/**
 * Error Boundary Props
 */
interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Optional fallback UI to render on error */
  fallback?: ReactNode;
  /** Optional callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Whether to show detailed error info (dev mode) */
  showDetails?: boolean;
  /** Custom error title */
  title?: string;
}

/**
 * Error Boundary State
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showStack: boolean;
}

/**
 * Error Boundary Component
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs them, and displays a fallback UI instead of crashing the app.
 * 
 * This is critical for medical applications where a crash could
 * prevent access to patient information during emergencies.
 * 
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <CriticalComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showStack: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console for debugging
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);

    // Update state with error info
    this.setState({ errorInfo });

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // In production, you would send this to an error tracking service
    // Example: sendToErrorService(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showStack: false,
    });
  };

  handleGoHome = (): void => {
    window.location.href = '/dashboard';
  };

  handleReload = (): void => {
    window.location.reload();
  };

  toggleStack = (): void => {
    this.setState(prev => ({ showStack: !prev.showStack }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = import.meta.env.DEV || this.props.showDetails;

      // Default error UI
      return (
        <div 
          className="min-h-screen bg-gray-100 flex items-center justify-center p-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-100 rounded-full">
                <AlertTriangle className="w-8 h-8 text-red-600" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {this.props.title || 'Something went wrong'}
                </h1>
                <p className="text-sm text-gray-500">
                  An unexpected error occurred
                </p>
              </div>
            </div>

            {/* Error Message */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-800 font-medium">
                {this.state.error?.message || 'Unknown error'}
              </p>
            </div>

            {/* Medical System Notice */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800">
                <strong>Medical System Notice:</strong> If you need immediate access to 
                patient information, please use the backup access procedures or contact 
                IT support at extension 1234.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Try loading this component again"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Try Again
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                aria-label="Go to dashboard"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                Go to Dashboard
              </button>

              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                aria-label="Reload the page"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Reload Page
              </button>
            </div>

            {/* Developer Info (dev mode only) */}
            {isDev && (
              <div className="border-t pt-4">
                <button
                  onClick={this.toggleStack}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-2"
                  aria-expanded={this.state.showStack}
                  aria-controls="error-stack-trace"
                >
                  <Bug className="w-4 h-4" aria-hidden="true" />
                  {this.state.showStack ? 'Hide' : 'Show'} Technical Details
                </button>
                
                {this.state.showStack && (
                  <div 
                    id="error-stack-trace"
                    className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-48 text-xs font-mono"
                  >
                    <p className="text-red-400 mb-2">
                      {this.state.error?.name}: {this.state.error?.message}
                    </p>
                    <pre className="whitespace-pre-wrap text-gray-400">
                      {this.state.error?.stack}
                    </pre>
                    {this.state.errorInfo && (
                      <>
                        <p className="text-yellow-400 mt-4 mb-2">Component Stack:</p>
                        <pre className="whitespace-pre-wrap text-gray-400">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with an error boundary
 * 
 * @example
 * ```tsx
 * const SafeComponent = withErrorBoundary(DangerousComponent);
 * ```
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithErrorBoundary;
}

/**
 * Smaller, inline error boundary for non-critical components
 */
interface InlineErrorFallbackProps {
  error: Error | null;
  resetError: () => void;
  componentName?: string;
}

export function InlineErrorFallback({
  error,
  resetError,
  componentName = 'component',
}: InlineErrorFallbackProps): JSX.Element {
  return (
    <div 
      className="bg-red-50 border border-red-200 rounded-lg p-4"
      role="alert"
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-red-500" aria-hidden="true" />
        <span className="font-medium text-red-800">
          Error loading {componentName}
        </span>
      </div>
      <p className="text-sm text-red-600 mb-3">
        {error?.message || 'An unexpected error occurred'}
      </p>
      <button
        onClick={resetError}
        className="text-sm text-red-700 underline hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
      >
        Try again
      </button>
    </div>
  );
}

export default ErrorBoundary;
