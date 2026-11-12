-- Creates isolated test database and non-superuser runtime role
-- so PostgreSQL Row-Level Security (RLS) policies execute locally.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD 'salonflow_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

SELECT 'CREATE DATABASE salonflow_test OWNER salonflow_admin'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'salonflow_test')\gexec

\connect salonflow;
GRANT USAGE ON SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE salonflow_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE salonflow_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

\connect salonflow_test;
GRANT USAGE ON SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE salonflow_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE salonflow_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

