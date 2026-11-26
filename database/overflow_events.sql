-- Overflow dispatch: tracks truck-full signals and overflow pickup reassignment.
-- Vehicle/driver/route ids are stored as text to stay compatible with existing id types
-- (app compares ids via String()). Run once in the Supabase SQL editor.

create table if not exists public.overflow_events (
  id uuid primary key default gen_random_uuid(),
  source_vehicle_id text not null,
  source_driver_id text,
  source_driver_auth_user_id uuid references auth.users(id) on delete set null,
  source_route_id text,
  target_vehicle_id text,
  target_driver_id text,
  target_driver_auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'dispatched', 'accepted', 'declined', 'completed', 'cancelled')),
  overflow_bins jsonb not null default '[]'::jsonb,
  bins_count integer not null default 0,
  distance_km double precision,
  reassignment_metadata jsonb default '{}'::jsonb,
  target_route_id bigint references public.routes(id) on delete set null,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  driver_notified_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists overflow_events_status_idx on public.overflow_events (status);
create index if not exists overflow_events_created_at_idx on public.overflow_events (created_at desc);
create index if not exists overflow_events_target_driver_status_idx on public.overflow_events (target_driver_id, status);
create index if not exists overflow_events_target_vehicle_status_idx on public.overflow_events (target_vehicle_id, status);
create index if not exists overflow_events_target_auth_status_idx on public.overflow_events (target_driver_auth_user_id, status);
create index if not exists overflow_events_source_route_active_idx on public.overflow_events (source_route_id, status)
  where status in ('pending', 'dispatched', 'accepted');

alter table public.overflow_events enable row level security;
alter table public.overflow_events replica identity full;

drop policy if exists "Allow read access to all users" on public.overflow_events;
drop policy if exists "Drivers and dispatchers can view overflow events" on public.overflow_events;
drop policy if exists "Drivers and dispatchers can update overflow events" on public.overflow_events;

drop policy if exists "overflow_events_read_authenticated" on public.overflow_events;
create policy "overflow_events_read_authenticated" on public.overflow_events
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_dispatcher(auth.uid())
    or public.is_supervisor(auth.uid())
    or (
      public.current_profile_is_active()
      and public.current_app_role() = 'truck_driver'::text
      and public.current_driver_id() is not null
      and (
        source_driver_auth_user_id = auth.uid()
        or target_driver_auth_user_id = auth.uid()
        or btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        or btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        or (
          public.current_driver_vehicle_id() is not null
          and (
            (
              btrim(coalesce(source_driver_id, '')) = ''
              and source_driver_auth_user_id is null
              and btrim(coalesce(source_vehicle_id, '')) = public.current_driver_vehicle_id()::text
            )
            or (
              btrim(coalesce(target_driver_id, '')) = ''
              and target_driver_auth_user_id is null
              and btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
            )
          )
        )
      )
    )
  );

drop policy if exists "overflow_events_write_authenticated" on public.overflow_events;
create policy "overflow_events_write_authenticated" on public.overflow_events
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or public.is_dispatcher(auth.uid())
    or public.is_supervisor(auth.uid())
    or (
      public.current_profile_is_active()
      and public.current_app_role() = 'truck_driver'::text
      and public.current_driver_id() is not null
      and btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
      and (source_driver_auth_user_id is null or source_driver_auth_user_id = auth.uid())
    )
  );

drop policy if exists "overflow_events_update_authenticated" on public.overflow_events;
create policy "overflow_events_update_authenticated" on public.overflow_events
  for update to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_dispatcher(auth.uid())
    or public.is_supervisor(auth.uid())
    or (
      public.current_profile_is_active()
      and public.current_app_role() = 'truck_driver'::text
      and public.current_driver_id() is not null
      and (
        source_driver_auth_user_id = auth.uid()
        or target_driver_auth_user_id = auth.uid()
        or btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        or btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        or (
          public.current_driver_vehicle_id() is not null
          and btrim(coalesce(target_driver_id, '')) = ''
          and target_driver_auth_user_id is null
          and btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
        )
      )
    )
  )
  with check (
    public.is_admin(auth.uid())
    or public.is_dispatcher(auth.uid())
    or public.is_supervisor(auth.uid())
    or (
      public.current_profile_is_active()
      and public.current_app_role() = 'truck_driver'::text
      and public.current_driver_id() is not null
      and (
        source_driver_auth_user_id = auth.uid()
        or target_driver_auth_user_id = auth.uid()
        or btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        or btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        or (
          public.current_driver_vehicle_id() is not null
          and btrim(coalesce(target_driver_id, '')) = ''
          and target_driver_auth_user_id is null
          and btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
        )
      )
    )
  );

drop policy if exists "overflow_events_delete_staff" on public.overflow_events;
create policy "overflow_events_delete_staff" on public.overflow_events
  for delete to authenticated
  using (public.is_admin(auth.uid()) or public.is_dispatcher(auth.uid()));

revoke all on table public.overflow_events from anon;
grant select, insert, update, delete on table public.overflow_events to authenticated, service_role, postgres;

-- Realtime (useLiveData subscribes to LIVE_TABLES)
do $$
begin
  alter publication supabase_realtime add table public.overflow_events;
exception when duplicate_object then null;
end $$;

-- Page access (consolidated into Live Monitoring)
insert into public.role_permissions (role, page, can_read, can_create, can_update, can_delete)
values
  ('dispatcher', 'live-monitoring', true, true, true, false),
  ('admin', 'live-monitoring', true, false, true, false)
on conflict do nothing;
