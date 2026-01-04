/**
 * useApi Hook
 * 
 * Generic data fetching hook with loading, error, and refresh states.
 */

import { useState, useCallback, useEffect } from 'react';

export interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => Promise<void>;
  reset: () => void;
}

export function useApi<T>(
  fetchFn: () => Promise<T>,
  options?: {
    immediate?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
  }
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    isLoading: options?.immediate !== false,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const data = await fetchFn();
      setState({ data, isLoading: false, error: null });
      options?.onSuccess?.(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setState({ data: null, isLoading: false, error: message });
      options?.onError?.(message);
    }
  }, [fetchFn]);

  const reset = useCallback(() => {
    setState({ data: null, isLoading: false, error: null });
  }, []);

  useEffect(() => {
    if (options?.immediate !== false) {
      fetchData();
    }
  }, []);

  return {
    ...state,
    refetch: fetchData,
    reset,
  };
}

/**
 * useMutation Hook
 * 
 * For POST/PUT/DELETE operations with loading state.
 */

export interface UseMutationState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
}

export interface UseMutationReturn<TData, TVariables> extends UseMutationState<TData> {
  mutate: (variables: TVariables) => Promise<TData>;
  reset: () => void;
}

export function useMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: string, variables: TVariables) => void;
  }
): UseMutationReturn<TData, TVariables> {
  const [state, setState] = useState<UseMutationState<TData>>({
    data: null,
    isLoading: false,
    error: null,
    isSuccess: false,
  });

  const mutate = useCallback(async (variables: TVariables) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, isSuccess: false }));

    try {
      const data = await mutationFn(variables);
      setState({ data, isLoading: false, error: null, isSuccess: true });
      options?.onSuccess?.(data, variables);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setState({ data: null, isLoading: false, error: message, isSuccess: false });
      options?.onError?.(message, variables);
      throw err;
    }
  }, [mutationFn]);

  const reset = useCallback(() => {
    setState({ data: null, isLoading: false, error: null, isSuccess: false });
  }, []);

  return {
    ...state,
    mutate,
    reset,
  };
}
