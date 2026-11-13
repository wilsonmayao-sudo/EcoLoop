-- Migration: Dynamic Vehicle Reassignment & Capacity Monitoring
-- Run in Supabase SQL Editor to support driver-reported load and reassignment analytics.

-- 0. Ensure enum values required by overflow/unloading workflows exist
alter type public.delivery_status add value if not exists 'overflow_uncollected';
alter type public.driver_status add value if not exists 'full';
alter type public.notification_category add value if not exists 'truck';

-- 1. Add driver-reported capacity percentage to vehicles
alter table public.vehicles
  add column if not exists load_percent integer default 0
  check (load_percent >= 0 and load_percent <= 100);

-- 2. Add reassignment metadata to overflow_events to record algorithmic decision matrix
alter table public.overflow_events
  add column if not exists reassignment_metadata jsonb default '{}'::jsonb;

-- 3. Comment on table and columns for documentation
comment on column public.vehicles.load_percent is 'Driver-reported load percentage (e.g. 25, 50, 75, 100) from mobile app';
comment on column public.overflow_events.reassignment_metadata is 'Algorithmic decision matrix, scoring breakdown, and comparative metrics';
