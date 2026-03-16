/**
 * API Error Handler for MediChain Mobile
 * 
 * Comprehensive error handling with user-friendly messages
 * and automatic recovery actions.
 * 
 * @see COMPREHENSIVE_CONNECTION_ANALYSIS.md Section 9.2
 */

/**
 * MediChain API error codes
 */
export type ApiErrorCode = 
  | 'INVALID_REQUEST'
  | 'INVALID_ADDRESS'
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'INSUFFICIENT_ROLE'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'BLOCKCHAIN_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

/**
 * Structured API error
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: ApiErrorCode,
    public status?: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Error information for UI display
 */
export interface ErrorInfo {
  title: string;
  message: string;
  action?: 'retry' | 'login' | 'contact_support' | 'wait' | 'none';
  retryable: boolean;
}

/**
 * Map HTTP status to error code
 */
export function httpStatusToErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case 400: return 'INVALID_REQUEST';
    case 401: return 'AUTH_MISSING';
    case 403: return 'INSUFFICIENT_ROLE';
    case 404: return 'NOT_FOUND';
    case 409: return 'ALREADY_EXISTS';
    case 422: return 'VALIDATION_ERROR';
    case 429: return 'RATE_LIMITED';
    case 500: return 'INTERNAL_ERROR';
    case 502: return 'BLOCKCHAIN_ERROR';
    case 503: return 'SERVICE_UNAVAILABLE';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN';
  }
}

/**
 * Get user-friendly error information from an error
 */
export function getErrorInfo(error: unknown): ErrorInfo {
  // Network errors
  if (error instanceof TypeError && error.message === 'Network request failed') {
    return {
      title: 'Connection Error',
      message: 'Unable to connect to server. Please check your internet connection.',
      action: 'retry',
      retryable: true
    };
  }

  // Timeout errors
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      title: 'Request Timeout',
      message: 'The request took too long. Please try again.',
      action: 'retry',
      retryable: true
    };
  }

  // API client errors
  if (error instanceof ApiClientError) {
    return getApiErrorInfo(error);
  }

  // Generic Error with message
  if (error instanceof Error) {
    // Check for common patterns
    if (error.message.includes('Network request failed')) {
      return {
        title: 'Connection Error',
        message: 'Unable to connect to server. Please check your internet connection.',
        action: 'retry',
        retryable: true
      };
    }
    
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return {
        title: 'Request Timeout',
        message: 'The request took too long. Please try again.',
        action: 'retry',
        retryable: true
      };
    }

    return {
      title: 'Error',
      message: error.message,
      action: 'none',
      retryable: false
    };
  }

  // Unknown error type
  return {
    title: 'Unexpected Error',
    message: 'An unexpected error occurred. Please try again.',
    action: 'retry',
    retryable: true
  };
}

/**
 * Get user-friendly info for API errors
 */
function getApiErrorInfo(error: ApiClientError): ErrorInfo {
  switch (error.code) {
    case 'AUTH_MISSING':
      return {
        title: 'Authentication Required',
        message: 'Please log in to continue.',
        action: 'login',
        retryable: false
      };

    case 'AUTH_INVALID':
      return {
        title: 'Session Expired',
        message: 'Your session has expired. Please log in again.',
        action: 'login',
        retryable: false
      };

    case 'INSUFFICIENT_ROLE':
      return {
        title: 'Access Denied',
        message: 'You do not have permission to perform this action.',
        action: 'none',
        retryable: false
      };

    case 'INVALID_ADDRESS':
      return {
        title: 'Invalid Wallet Address',
        message: 'The wallet address format is invalid. Please check and try again.',
        action: 'none',
        retryable: false
      };

    case 'NOT_FOUND':
      return {
        title: 'Not Found',
        message: 'The requested resource was not found.',
        action: 'none',
        retryable: false
      };

    case 'ALREADY_EXISTS':
      return {
        title: 'Already Exists',
        message: 'This resource already exists.',
        action: 'none',
        retryable: false
      };

    case 'VALIDATION_ERROR':
      return {
        title: 'Validation Error',
        message: error.message || 'Please check the form and try again.',
        action: 'none',
        retryable: false
      };

    case 'RATE_LIMITED':
      return {
        title: 'Too Many Requests',
        message: 'Please wait a moment before trying again.',
        action: 'wait',
        retryable: true
      };

    case 'INTERNAL_ERROR':
      return {
        title: 'Server Error',
        message: 'An error occurred on the server. Please try again later.',
        action: 'retry',
        retryable: true
      };

    case 'BLOCKCHAIN_ERROR':
      return {
        title: 'Blockchain Error',
        message: 'Unable to process blockchain transaction. Please try again.',
        action: 'retry',
        retryable: true
      };

    case 'SERVICE_UNAVAILABLE':
      return {
        title: 'Service Unavailable',
        message: 'The service is temporarily unavailable. Please try again later.',
        action: 'wait',
        retryable: true
      };

    case 'NETWORK_ERROR':
      return {
        title: 'Connection Error',
        message: 'Unable to connect to server. Please check your internet connection.',
        action: 'retry',
        retryable: true
      };

    case 'TIMEOUT':
      return {
        title: 'Request Timeout',
        message: 'The request took too long. Please try again.',
        action: 'retry',
        retryable: true
      };

    default:
      return {
        title: 'Error',
        message: error.message || 'An error occurred. Please try again.',
        action: 'retry',
        retryable: true
      };
  }
}

/**
 * Extract error code from API response data
 */
export function extractErrorCode(data: unknown): ApiErrorCode {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (typeof obj.code === 'string') {
      return obj.code as ApiErrorCode;
    }
    // Try common error field names
    if (typeof obj.error_code === 'string') {
      return obj.error_code as ApiErrorCode;
    }
    if (typeof obj.errorCode === 'string') {
      return obj.errorCode as ApiErrorCode;
    }
  }
  return 'UNKNOWN';
}

/**
 * Create an ApiClientError from a fetch response
 */
export async function createErrorFromResponse(response: Response): Promise<ApiClientError> {
  let data: unknown;
  let message = `HTTP ${response.status}: ${response.statusText}`;
  
  try {
    data = await response.json();
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.error === 'string') {
        message = obj.error;
      } else if (typeof obj.message === 'string') {
        message = obj.message;
      }
    }
  } catch {
    // Response is not JSON
  }

  const code = extractErrorCode(data) !== 'UNKNOWN' 
    ? extractErrorCode(data) 
    : httpStatusToErrorCode(response.status);

  return new ApiClientError(message, code, response.status, data);
}
