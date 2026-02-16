import React, { useRef, useEffect, useCallback, ReactNode } from 'react';

/**
 * FocusTrap Props
 */
interface FocusTrapProps {
  /** Child elements to trap focus within */
  children: ReactNode;
  /** Whether the focus trap is active */
  active?: boolean;
  /** Element to focus when trap is activated (defaults to first focusable) */
  initialFocusRef?: React.RefObject<HTMLElement>;
  /** Element to return focus to when trap is deactivated */
  returnFocusRef?: React.RefObject<HTMLElement>;
  /** Callback when escape key is pressed */
  onEscape?: () => void;
  /** Whether to restore focus when unmounted */
  restoreFocus?: boolean;
  /** Class name for the container */
  className?: string;
  /** ARIA role for the container */
  role?: string;
  /** ARIA label for the container */
  'aria-label'?: string;
  /** ARIA labelledby for the container */
  'aria-labelledby'?: string;
  /** ARIA modal attribute */
  'aria-modal'?: boolean;
}

/**
 * Focusable element selectors
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * FocusTrap Component
 * 
 * Traps keyboard focus within a container, essential for modal dialogs
 * and other overlay components to meet WCAG 2.4.3 (Focus Order) and
 * WCAG 2.4.7 (Focus Visible) requirements.
 * 
 * Features:
 * - Traps Tab and Shift+Tab navigation within container
 * - Supports Escape key to close
 * - Returns focus to triggering element on close
 * - Auto-focuses first focusable element or specified initial element
 * 
 * @example
 * ```tsx
 * <FocusTrap active={isOpen} onEscape={() => setIsOpen(false)}>
 *   <div role="dialog" aria-modal="true">
 *     <h2>Modal Title</h2>
 *     <button onClick={handleClose}>Close</button>
 *   </div>
 * </FocusTrap>
 * ```
 */
export function FocusTrap({
  children,
  active = true,
  initialFocusRef,
  returnFocusRef,
  onEscape,
  restoreFocus = true,
  className,
  role,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-modal': ariaModal,
}: FocusTrapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  /**
   * Get all focusable elements within the container
   */
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    
    const elements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    return Array.from(elements).filter(
      el => !el.hasAttribute('disabled') && el.tabIndex !== -1
    );
  }, []);

  /**
   * Focus the first focusable element or the specified initial element
   */
  const focusFirst = useCallback(() => {
    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
      return;
    }

    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }, [initialFocusRef, getFocusableElements]);

  /**
   * Handle Tab key navigation
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!active) return;

      // Handle Escape key
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      // Handle Tab key for focus trapping
      if (event.key === 'Tab') {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        // Shift+Tab from first element -> go to last
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
          return;
        }

        // Tab from last element -> go to first
        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
          return;
        }

        // Check if focus is outside the trap (shouldn't happen, but safety check)
        if (!containerRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    },
    [active, onEscape, getFocusableElements]
  );

  /**
   * Store previous active element and set up focus trap
   */
  useEffect(() => {
    if (!active) return;

    // Store the currently focused element to restore later
    previousActiveElement.current = document.activeElement;

    // Focus the first focusable element
    // Use setTimeout to ensure the DOM is ready
    const timeoutId = setTimeout(focusFirst, 0);

    // Add keydown listener
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('keydown', handleKeyDown);

      // Restore focus when trap is deactivated
      if (restoreFocus) {
        const elementToFocus = returnFocusRef?.current || previousActiveElement.current;
        if (elementToFocus instanceof HTMLElement) {
          // Use setTimeout to avoid focus conflicts
          setTimeout(() => elementToFocus.focus(), 0);
        }
      }
    };
  }, [active, focusFirst, handleKeyDown, restoreFocus, returnFocusRef]);

  /**
   * Prevent focus from leaving the trap
   */
  const handleFocusOut = useCallback(
    (event: React.FocusEvent) => {
      if (!active || !containerRef.current) return;

      // If focus is moving outside the container, bring it back
      if (!containerRef.current.contains(event.relatedTarget as Node)) {
        event.preventDefault();
        focusFirst();
      }
    },
    [active, focusFirst]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-modal={ariaModal}
      onBlur={handleFocusOut}
    >
      {children}
    </div>
  );
}

/**
 * Hook for programmatic focus trap management
 * 
 * @example
 * ```tsx
 * const { trapRef, activate, deactivate } = useFocusTrap();
 * ```
 */
export function useFocusTrap() {
  const trapRef = useRef<HTMLDivElement>(null);
  const previousElement = useRef<Element | null>(null);

  const activate = useCallback(() => {
    previousElement.current = document.activeElement;
    
    if (trapRef.current) {
      const focusable = trapRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }
  }, []);

  const deactivate = useCallback(() => {
    if (previousElement.current instanceof HTMLElement) {
      previousElement.current.focus();
    }
  }, []);

  return { trapRef, activate, deactivate };
}

export default FocusTrap;
