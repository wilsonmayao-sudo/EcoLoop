-- EcoLoop Section B/C Schema Cleanup & Role-Permission Consolidation
-- Safe & idempotent migration to drop verified unused legacy tables/views
-- and migrate consolidated WebApp page keys in public.role_permissions.
--
-- IMPORTANT:
--   * public.maintenance_records is RETAINED because WebApp/src/hooks/useLiveData.ts
--     actively queries and inserts into it.
--   * public.vehicle_maintenance has zero callers and is dropped instead.
--   * public.waste_reports is RETAINED as the active incident/report table.
--   * Take a database snapshot/backup before applying to production.

BEGIN;

-- 1. Migrate legacy WebApp page keys in public.role_permissions to consolidated pages
WITH mapped_permissions AS (
  SELECT
    role,
    CASE page
      WHEN 'supervisor-dashboard' THEN 'dashboard'
      WHEN 'user-approvals' THEN 'users'
      WHEN 'bin-locations' THEN 'area-management'
      WHEN 'overflow-dispatch' THEN 'live-monitoring'
      WHEN 'vehicle-monitoring' THEN 'live-monitoring'
      ELSE page
    END AS target_page,
    bool_or(can_read) AS can_read,
    bool_or(can_create) AS can_create,
    bool_or(can_update) AS can_update,
    bool_or(can_delete) AS can_delete
  FROM public.role_permissions
  WHERE page IN (
    'supervisor-dashboard',
    'user-approvals',
    'bin-locations',
    'overflow-dispatch',
    'vehicle-monitoring'
  )
  GROUP BY 1, 2
)
INSERT INTO public.role_permissions (role, page, can_read, can_create, can_update, can_delete)
SELECT role, target_page, can_read, can_create, can_update, can_delete
FROM mapped_permissions
ON CONFLICT (role, page) DO UPDATE
SET
  can_read   = public.role_permissions.can_read   OR EXCLUDED.can_read,
  can_create = public.role_permissions.can_create OR EXCLUDED.can_create,
  can_update = public.role_permissions.can_update OR EXCLUDED.can_update,
  can_delete = public.role_permissions.can_delete OR EXCLUDED.can_delete;

DELETE FROM public.role_permissions
WHERE page IN (
  'supervisor-dashboard',
  'user-approvals',
  'bin-locations',
  'overflow-dispatch',
  'vehicle-monitoring'
);

-- 2. Drop legacy incident/reports subsystem superseded by public.waste_reports
DROP VIEW IF EXISTS public.v_incident_summary;

ALTER TABLE IF EXISTS public.notifications
  DROP CONSTRAINT IF EXISTS notifications_report_id_fkey;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.reports;
EXCEPTION
  WHEN undefined_table OR undefined_object OR invalid_object_definition THEN
    NULL;
END $$;

DROP TABLE IF EXISTS public.report_logs;
DROP TABLE IF EXISTS public.reports;

-- 3. Drop legacy unused routing, telemetry, duplicate maintenance, and reference tables
DROP TABLE IF EXISTS public.route_assignments;
DROP TABLE IF EXISTS public.vehicle_locations;
DROP TABLE IF EXISTS public.vehicle_maintenance;
DROP TABLE IF EXISTS public.service_areas;

COMMIT;
