-- EcoLoop Operational Truck Fleet Registration (Idempotent Seed)
-- Waste Density Assumption: 294 kg/m3
-- Total Registered Operational Trucks: 14 (142.8 m3 | 41,983.2 kg combined weight capacity)
-- Initial Defense / Demo Active Fleet: 3 Hino 500 Series units (30.0 m3 | 8,820.0 kg active)
-- Remaining 11 units are registered as standby (is_active = false, status = 'offline').
--
-- Run once in the Supabase Dashboard -> SQL Editor.

insert into public.vehicles (
  code,
  truck_code,
  plate_number,
  label,
  model,
  capacity_liters,
  capacity_kg,
  is_active,
  status
)
values
  -- 1. Hino 500 Series (10 m3 x 6 units; Units 1-3 ACTIVE for demo / initial defense)
  ('TRK-01', 'TRK-01', 'SWMO-H500-01', 'Hino 500 Unit 1', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, true,  'available'),
  ('TRK-02', 'TRK-02', 'SWMO-H500-02', 'Hino 500 Unit 2', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, true,  'available'),
  ('TRK-03', 'TRK-03', 'SWMO-H500-03', 'Hino 500 Unit 3', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, true,  'available'),
  ('TRK-04', 'TRK-04', 'SWMO-H500-04', 'Hino 500 Unit 4', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, false, 'offline'),
  ('TRK-05', 'TRK-05', 'SWMO-H500-05', 'Hino 500 Unit 5', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, false, 'offline'),
  ('TRK-06', 'TRK-06', 'SWMO-H500-06', 'Hino 500 Unit 6', 'Hino 500 Series (10 m³)', 10000.00, 2940.0, false, 'offline'),

  -- 2. Regasco Truck (17 m3 x 1 unit)
  ('TRK-07', 'TRK-07', 'SWMO-RGS-01',  'Regasco Truck 1', 'Regasco Truck (17 m³)',   17000.00, 4998.0, false, 'offline'),

  -- 3. Sino Truck HOWO (11.4 m3 x 2 units)
  ('TRK-08', 'TRK-08', 'SWMO-HOWO-01', 'Sino Truck HOWO 1', 'Sino Truck HOWO (11.4 m³)', 11400.00, 3351.6, false, 'offline'),
  ('TRK-09', 'TRK-09', 'SWMO-HOWO-02', 'Sino Truck HOWO 2', 'Sino Truck HOWO (11.4 m³)', 11400.00, 3351.6, false, 'offline'),

  -- 4. Compactor Truck (14 m3 x 1 unit)
  ('TRK-10', 'TRK-10', 'SWMO-CMP-01',  'Compactor Truck 1', 'Compactor Truck (14 m³)', 14000.00, 4116.0, false, 'offline'),

  -- 5. Small Compactor Truck (2 m3 x 1 unit)
  ('TRK-11', 'TRK-11', 'SWMO-SCMP-01', 'Small Compactor Truck 1', 'Small Compactor Truck (2 m³)', 2000.00, 588.0, false, 'offline'),

  -- 6. Hino 300 Series (7 m3 x 1 unit)
  ('TRK-12', 'TRK-12', 'SWMO-H300-01', 'Hino 300 Unit 1', 'Hino 300 Series (7 m³)',  7000.00, 2058.0, false, 'offline'),

  -- 7. Isuzu Giga (10 m3 x 2 units)
  ('TRK-13', 'TRK-13', 'SWMO-GIGA-01', 'Isuzu Giga 1',    'Isuzu Giga (10 m³)',      10000.00, 2940.0, false, 'offline'),
  ('TRK-14', 'TRK-14', 'SWMO-GIGA-02', 'Isuzu Giga 2',    'Isuzu Giga (10 m³)',      10000.00, 2940.0, false, 'offline')
on conflict (truck_code) do update
set
  code            = excluded.code,
  label           = excluded.label,
  model           = excluded.model,
  capacity_liters = excluded.capacity_liters,
  capacity_kg     = excluded.capacity_kg,
  is_active       = excluded.is_active,
  status          = excluded.status,
  updated_at      = timezone('utc'::text, now());

-- Keep any prior test vehicles out of active demo dispatch without breaking historical FKs.
update public.vehicles
set
  is_active  = false,
  status     = 'offline',
  updated_at = timezone('utc'::text, now())
where truck_code not in (
  'TRK-01', 'TRK-02', 'TRK-03', 'TRK-04', 'TRK-05', 'TRK-06',
  'TRK-07', 'TRK-08', 'TRK-09', 'TRK-10', 'TRK-11', 'TRK-12', 'TRK-13', 'TRK-14'
)
and is_active is true;

-- Sync sequence so creating new trucks in the UI does not collide with seeded IDs.
select setval(
  'public.vehicles_id_seq',
  coalesce((select max(id) from public.vehicles), 1),
  true
);
