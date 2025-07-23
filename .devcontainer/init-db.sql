-- Database initialization script for devcontainer
-- This script runs when the PostgreSQL container starts for the first time

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant additional permissions to the postgres user
GRANT ALL PRIVILEGES ON DATABASE automerge_sync TO postgres;

-- Set timezone
SET timezone = 'UTC';

-- Create a function to show database is ready
CREATE OR REPLACE FUNCTION db_ready() RETURNS text AS $$
BEGIN
    RETURN 'PostgreSQL database is ready for Automerge Sync Server';
END;
$$ LANGUAGE plpgsql;

-- Log initialization completion
SELECT db_ready();
