#!/bin/bash
# MediChain CI Lint Script
# Purpose: Prevent introduction of PostgreSQL positional placeholders ($1, $2, etc.)
#          in repository code. Use sqlx::QueryBuilder pattern instead.
#
# Usage: ./scripts/lint-no-dollar-placeholders.sh
# Returns: Exit code 0 if clean, 1 if violations found

set -e

echo "Checking for prohibited PostgreSQL positional placeholders (\$1, \$2, etc.)..."
echo "Location: api/src/repositories/postgres/"
echo ""

# Find matches, excluding documentation comments (lines starting with //!)
# Pattern: Lines containing $N (where N is a digit) but NOT starting with //
VIOLATIONS=$(grep -rn '\$[0-9]' api/src/repositories/postgres/*.rs 2>/dev/null | grep -v '^\s*//' | grep -v '^[^:]*:[0-9]*:\s*//!' || true)

if [ -n "$VIOLATIONS" ]; then
    echo "❌ FAILED: Found prohibited positional placeholder patterns!"
    echo ""
    echo "The following lines contain \$1, \$2, etc. which should be replaced with QueryBuilder:"
    echo ""
    echo "$VIOLATIONS"
    echo ""
    echo "Please use sqlx::QueryBuilder pattern instead. Example:"
    echo ""
    echo "  // BEFORE (prohibited):"
    echo "  sqlx::query_as(\"SELECT * FROM table WHERE id = \$1\").bind(id)"
    echo ""
    echo "  // AFTER (required):"
    echo "  let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(\"SELECT * FROM table WHERE id = \");"
    echo "  qb.push_bind(id);"
    echo "  qb.build_query_as::<Entity>().fetch_one(&pool).await?"
    echo ""
    exit 1
else
    echo "✅ PASSED: No prohibited positional placeholders found"
    exit 0
fi
