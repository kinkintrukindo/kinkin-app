-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Creates the user_profiles table for username-based auth with approval workflow

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  username text unique not null,
  email text not null,
  role text not null default 'user',
  approved boolean not null default false,
  created_at timestamptz default now()
);

-- Enable RLS
alter table user_profiles enable row level security;

-- Allow everyone to read (needed for username → email lookup before auth)
create policy "allow select" on user_profiles for select using (true);

-- Allow insert from any auth state (signup creates profile right after auth.signUp)
create policy "allow insert" on user_profiles for insert with check (true);

-- Allow update (for admin approval)
create policy "allow update" on user_profiles for update using (true);

-- Allow delete (for admin rejection)
create policy "allow delete" on user_profiles for delete using (true);
