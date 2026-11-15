insert into public.system_settings (key, value, description)
values
  ('depot', '{"id":"DEPOT","latitude":13.6218,"longitude":123.1948}'::jsonb, 'Default dispatch depot for route optimization'),
  ('landfill', '{"id":"SWMO_LANDFILL","name":"SWMO - Sanitary Landfill","latitude":13.6212151,"longitude":123.2576126,"google_maps_url":"https://www.google.com/maps/place/SWMO+-+SANITARY+LANDFILL/@13.6212151,123.2576126,17z"}'::jsonb, 'Sanitary Landfill destination for waste collection trucks'),
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

insert into public.bin_types (name, sort_order)
values
  ('residential', 10),
  ('commercial', 20),
  ('industrial', 30)
on conflict (name) do nothing;

insert into public.role_permissions (role, page, can_read, can_create, can_update, can_delete)
values
  ('admin', 'dashboard', true, false, false, false),
  ('admin', 'live-monitoring', true, true, true, false),
  ('admin', 'area-management', true, true, true, true),
  ('admin', 'route-planning', true, true, true, true),
  ('admin', 'reports', true, true, false, true),
  ('admin', 'notifications', true, true, true, true),
  ('admin', 'users', true, true, true, true),
  ('admin', 'system-settings', true, true, true, false),
  ('dispatcher', 'dashboard', true, false, false, false),
  ('dispatcher', 'live-monitoring', true, true, true, false),
  ('dispatcher', 'area-management', true, true, true, true),
  ('dispatcher', 'route-planning', true, true, true, true),
  ('dispatcher', 'notifications', true, true, true, true),
  ('dispatcher', 'reports', true, false, true, true),
  ('supervisor', 'dashboard', true, false, false, false),
  ('supervisor', 'live-monitoring', true, false, false, false),
  ('supervisor', 'area-management', true, false, false, false),
  ('supervisor', 'reports', true, false, true, false),
  ('supervisor', 'notifications', true, false, true, false)
on conflict (role, page) do nothing;
