\ir create-role.sql
BEGIN;
DO $$
BEGIN
  IF pg_has_role('core_app', current_user, 'member') THEN
    RAISE EXCEPTION 'core_app must not belong to the migration role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace IN ('public'::regnamespace, 'pgboss'::regnamespace) AND relowner = 'core_app'::regrole) THEN
    RAISE EXCEPTION 'core_app must not own application tables';
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM core_app;
REVOKE ALL ON SCHEMA public FROM core_app;
REVOKE ALL ON DATABASE :"dbname" FROM core_app;
GRANT CONNECT ON DATABASE :"dbname" TO core_app;
GRANT USAGE ON SCHEMA public TO core_app;
-- Application tables share DML permissions; Prisma's migration history stays private.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO core_app', schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' \gexec
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_app;
-- Functions require explicit grants, especially those using SECURITY DEFINER.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA pgboss TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO core_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO core_app;
COMMIT;
