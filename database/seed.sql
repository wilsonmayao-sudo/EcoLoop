insert into public.system_settings (key, value, description)
values
  ('depot', '{"id":"DEPOT","latitude":13.6218,"longitude":123.1948}'::jsonb, 'Default dispatch depot for route optimization'),
  ('organization', '{"name":"ECOLOOP","city":"Naga City"}'::jsonb, 'Displayed organization identity')
on conflict (key) do nothing;

insert into public.report_categories (name, sort_order)
values
  ('Missed Collection', 10),
  ('Bin Overflow', 20),
  ('Damaged Bin', 30),
  ('Schedule Request', 40),
  ('Vehicle Issue', 50),
  ('Other', 100)
on conflict (name) do nothing;

insert into public.maintenance_types (name, sort_order)
values
  ('Routine Inspection', 10),
  ('Oil Change', 20),
  ('Brake Service', 30),
  ('Tire Replacement', 40),
  ('Engine Repair', 50),
  ('Other', 100)
on conflict (name) do nothing;

insert into public.service_areas (name, sort_order)
values
  ('Downtown District', 10),
  ('Residential Area A', 20),
  ('Residential Area B', 30),
  ('Industrial Zone', 40),
  ('Market District', 50),
  ('Commercial Zone', 60)
on conflict (name) do nothing;

insert into public.bin_types (name, sort_order)
values
  ('residential', 10),
  ('commercial', 20),
  ('industrial', 30)
on conflict (name) do nothing;

insert into public.role_permissions (role, page, can_read, can_create, can_update, can_delete)
values
  ('admin', 'dashboard', true, false, false, false),
  ('admin', 'reports', true, true, true, true),
  ('admin', 'bin-locations', true, true, true, true),
  ('admin', 'notifications', true, true, true, true),
  ('admin', 'user-approvals', true, false, true, false),
  ('admin', 'system-settings', true, true, true, false),
  ('dispatcher', 'dashboard', true, false, false, false),
  ('dispatcher', 'route-planning', true, true, true, true),
  ('dispatcher', 'vehicle-monitoring', true, true, true, false),
  ('dispatcher', 'bin-locations', true, true, true, true),
  ('dispatcher', 'notifications', true, true, true, true),
  ('supervisor', 'supervisor-dashboard', true, false, false, false),
  ('supervisor', 'reports', true, false, true, false),
  ('supervisor', 'notifications', true, false, true, false)
on conflict (role, page) do nothing;
