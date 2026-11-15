//! Errors, pagination and date ranges shared by every repository.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Repository error types
#[derive(Debug, Error)]
pub enum RepositoryError {
    /// Entity not found
    #[error("Entity not found: {0}")]
    NotFound(String),

    /// Duplicate entity (unique constraint violation)
    #[error("Duplicate entity: {0}")]
    Duplicate(String),

    /// Validation error
    #[error("Validation error: {0}")]
    Validation(String),

    /// Database error
    #[error("Database error: {0}")]
    Database(String),

    /// Configuration error
    #[error("Configuration error: {0}")]
    Configuration(String),

    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),

    /// Not implemented error - for optional trait methods
    #[error("Not implemented: {0}")]
    NotImplemented(String),
}

impl From<sqlx::Error> for RepositoryError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => RepositoryError::NotFound("Record not found".into()),
            sqlx::Error::Database(ref db_err) => {
                if db_err.code().map(|c| c == "23505").unwrap_or(false) {
                    // Unique violation
                    RepositoryError::Duplicate(db_err.message().to_string())
                } else {
                    RepositoryError::Database(db_err.message().to_string())
                }
            }
            _ => RepositoryError::Database(e.to_string()),
        }
    }
}

/// Result type alias for repository operations
pub type RepositoryResult<T> = Result<T, RepositoryError>;

/// Pagination parameters.
///
/// **Deliberately not `Default`.** The derive gave `page: 0, per_page: 0`, so
/// `limit()` returned 0 and every paginated repository read applied `.take(0)`.
/// The call came back with an empty `items` list and an accurate non-zero
/// `total` — which reads exactly like "this patient has no records" rather than
/// like a bug, and cost real time to diagnose the one time it was written.
///
/// There is no page size that is right by default: 0 returns nothing and any
/// other number is this type guessing at the caller's intent. `new(page, size)`
/// makes the caller say, and [`Pagination::first_page`] covers the common case
/// of "the first screenful" without inventing a silent constant.
#[derive(Debug, Clone, Copy)]
pub struct Pagination {
    /// Page number (0-indexed)
    pub page: u32,
    /// Items per page (max 100)
    pub per_page: u32,
}

impl Pagination {
    pub const MAX_PER_PAGE: u32 = 100;

    /// The first page, at a stated size. Named so a reader sees the size.
    pub fn first_page(per_page: u32) -> Self {
        Self::new(0, per_page)
    }

    pub fn new(page: u32, per_page: u32) -> Self {
        Self {
            page,
            per_page: per_page.min(Self::MAX_PER_PAGE),
        }
    }

    pub fn offset(&self) -> u32 {
        self.page * self.per_page
    }

    pub fn limit(&self) -> u32 {
        self.per_page.min(Self::MAX_PER_PAGE)
    }
}

/// Paginated result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

impl<T> PaginatedResult<T> {
    pub fn new(items: Vec<T>, total: u64, pagination: &Pagination) -> Self {
        let per_page = pagination.per_page.max(1);
        let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;
        Self {
            items,
            total,
            page: pagination.page,
            per_page,
            total_pages,
        }
    }
}

/// Date range filter
#[derive(Debug, Clone, Default)]
pub struct DateRange {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pagination() {
        let p = Pagination::new(0, 50);
        assert_eq!(p.offset(), 0);
        assert_eq!(p.limit(), 50);

        let p = Pagination::new(2, 25);
        assert_eq!(p.offset(), 50);
        assert_eq!(p.limit(), 25);

        // Max limit enforced
        let p = Pagination::new(0, 200);
        assert_eq!(p.limit(), 100);
    }

    #[test]
    fn test_paginated_result() {
        let items: Vec<i32> = vec![1, 2, 3];
        let pagination = Pagination::new(0, 10);
        let result = PaginatedResult::new(items, 30, &pagination);

        assert_eq!(result.total, 30);
        assert_eq!(result.total_pages, 3);
        assert_eq!(result.items.len(), 3);
    }
}
