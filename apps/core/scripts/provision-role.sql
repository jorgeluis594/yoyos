BEGIN;
SELECT format('CREATE ROLE core_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') \gexec
ALTER ROLE core_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
DO $$
BEGIN
  IF pg_has_role('core_app', current_user, 'member') THEN
    RAISE EXCEPTION 'core_app must not belong to the migration role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('Company', 'Image', 'user', 'session', 'account', 'verification') AND relowner = 'core_app'::regrole) THEN
    RAISE EXCEPTION 'core_app must not own application tables';
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM core_app;
REVOKE ALL ON SCHEMA public FROM core_app;
REVOKE ALL ON DATABASE :"dbname" FROM core_app;
GRANT CONNECT ON DATABASE :"dbname" TO core_app;
GRANT USAGE ON SCHEMA public TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Company", public."Image", public."user", public."session", public."account", public."verification" TO core_app;
COMMIT;
