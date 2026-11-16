-- Kira's table. Run once in the Supabase SQL editor of Kira's own project.
-- Each signed-in person has one row holding all their figures as one JSON document.
-- The row rules below let a person read and change only their own row; nobody else, signed in or not, sees it.

create table if not exists public.kira (
  owner uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  rev integer not null default 1          -- bumped on every save, so two devices cannot overwrite each other unseen
);

alter table public.kira enable row level security;

revoke all on public.kira from anon;
grant select, insert, update on public.kira to authenticated;

create policy "read own row" on public.kira
  for select to authenticated using (owner = (select auth.uid()));
create policy "add own row" on public.kira
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "change own row" on public.kira
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Live sync: every open device hears when its owner's row changes (row rules still apply).
alter publication supabase_realtime add table public.kira;
