create type public.lead_status as enum ('new', 'contacted', 'converted', 'closed');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  submitted_at_text text not null default '',
  name text not null default '',
  company text not null default '',
  mobile text not null default '',
  email text not null default '',
  gstin text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  product text not null default '',
  purpose text not null default '',
  page text not null default '',
  status public.lead_status not null default 'new',
  notes text not null default '',
  followup_date date,
  followup_note text not null default '',
  converted_at timestamptz,
  purchase_product text not null default '',
  purchase_amount numeric,
  invoice_no text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;

alter table public.leads enable row level security;

create policy "signed in users manage leads"
on public.leads for all to authenticated
using (true) with check (true);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_touch_updated_at
before update on public.leads
for each row execute function public.touch_updated_at();