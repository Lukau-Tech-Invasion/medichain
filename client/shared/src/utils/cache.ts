/**
 * Cache with TTL and Invalidation
 * Implements Section 8.2 from COMPREHENSIVE_CONNECTION_ANALYSIS.md
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;  // Time to live in milliseconds
}

/**
 * In-memory cache with TTL (Time To Live) support
 */
class CacheManager {
  private cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Get cached value if not stale
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const isStale = Date.now() - entry.timestamp > entry.ttl;
    if (isStale) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cached value with TTL
   */
  set<T>(key: string, data: T, ttl = 60000): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  /**
   * Invalidate cache entries matching patterns
   */
  invalidate(patterns: string[]): void {
    for (const key of this.cache.keys()) {
      if (patterns.some(p => key.includes(p))) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Remove stale entries (manual cleanup)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const isStale = now - entry.timestamp > entry.ttl;
      if (isStale) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

// Export singleton instance
export const cache = new CacheManager();

/**
 * Cache decorator for async functions
 */
export function cached<T>(key: string, ttl?: number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const cacheKey = `${key}:${JSON.stringify(args)}`;
      
      const cached = cache.get<T>(cacheKey);
      if (cached !== null) {
        console.log(`[Cache] HIT: ${cacheKey}`);
        return cached;
      }

      console.log(`[Cache] MISS: ${cacheKey}`);
      const result = await originalMethod.apply(this, args);
      cache.set(cacheKey, result, ttl);
      return result;
    };

    return descriptor;
  };
}
