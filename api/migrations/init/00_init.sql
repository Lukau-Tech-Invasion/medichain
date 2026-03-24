-- Docker initialization script for PostgreSQL
-- This runs automatically when the container starts for the first time
-- See: docker-compose.yml volumes section

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schema is applied by sqlx migrations at API startup
