-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Then follow README.md to add the three users.

create table if not exists team (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'member' check (role in ('owner','member'))
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  business_name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  status text not null default 'lead' check (status in ('lead','active','paused','cancelled')),
  plan text,
  setup_fee numeric default 0,
  setup_paid boolean default false,
  monthly_amount numeric default 0,
  billing_day int check (billing_day between 1 and 31),
  start_date date,
  paid_month text,
  next_followup date,
  notes text,
  legal_name text,
  entity_type text,
  ein text,
  agreement_date date,
  agreement_path text,
  domain_notes text,
  stage text not null default 'ready_to_quote' check (stage in ('ready_to_quote','quoted','accepted','in_progress','completed','paid','lost')),
  quote_amount numeric,
  quoted_on date,
  paid_on date,
  source text,
  lead_details text
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  spent_on date not null default current_date,
  amount numeric not null,
  category text,
  business text not null default 'shared' check (business in ('clear_sites','all_seasons','shared')),
  paid_by text,
  notes text,
  receipt_path text,
  frequency text not null default 'once' check (frequency in ('once','monthly')),
  ends_on date
);

create or replace function is_team() returns boolean language sql security definer stable as
$$ select exists (select 1 from team where user_id = auth.uid()) $$;
create or replace function is_owner() returns boolean language sql security definer stable as
$$ select exists (select 1 from team where user_id = auth.uid() and role = 'owner') $$;

alter table team enable row level security;
alter table customers enable row level security;
alter table expenses enable row level security;

drop policy if exists team_read on team;
create policy team_read on team for select using (is_team());

drop policy if exists customers_read on customers;
drop policy if exists customers_add on customers;
drop policy if exists customers_edit on customers;
drop policy if exists customers_delete on customers;
create policy customers_read on customers for select using (is_team());
create policy customers_add on customers for insert with check (is_team());
create policy customers_edit on customers for update using (is_team()) with check (is_team());
create policy customers_delete on customers for delete using (is_owner());

drop policy if exists expenses_read on expenses;
drop policy if exists expenses_add on expenses;
drop policy if exists expenses_edit on expenses;
drop policy if exists expenses_delete on expenses;
create policy expenses_read on expenses for select using (is_team());
create policy expenses_add on expenses for insert with check (is_team());
create policy expenses_edit on expenses for update using (is_team()) with check (is_team());
create policy expenses_delete on expenses for delete using (is_owner());

-- private file storage for receipts and agreements
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
drop policy if exists files_read on storage.objects;
drop policy if exists files_add on storage.objects;
drop policy if exists files_delete on storage.objects;
create policy files_read on storage.objects for select using (bucket_id = 'files' and is_team());
create policy files_add on storage.objects for insert with check (bucket_id = 'files' and is_team());
create policy files_delete on storage.objects for delete using (bucket_id = 'files' and is_owner());

-- If you created the expenses table before monthly expenses existed, run these two lines once:
alter table expenses add column if not exists frequency text not null default 'once' check (frequency in ('once','monthly'));
alter table expenses add column if not exists ends_on date;

-- If the customers table already exists (created before the pipeline), run these once:
alter table customers add column if not exists stage text not null default 'ready_to_quote' check (stage in ('ready_to_quote','quoted','accepted','in_progress','completed','paid','lost'));
alter table customers add column if not exists quote_amount numeric;
alter table customers add column if not exists quoted_on date;
alter table customers add column if not exists paid_on date;
alter table customers add column if not exists source text;
alter table customers add column if not exists lead_details text;

-- ---------------- payments (Stripe -> n8n -> record_payment) ----------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stripe_id text unique not null,
  customer_id uuid references customers(id) on delete set null,
  email text,
  product text,
  kind text check (kind in ('setup','monthly','other')),
  amount_cents int,
  paid_at timestamptz not null default now(),
  seen boolean not null default false,
  raw jsonb
);
alter table payments enable row level security;
drop policy if exists payments_read on payments;
drop policy if exists payments_edit on payments;
drop policy if exists payments_delete on payments;
create policy payments_read on payments for select using (is_team());
create policy payments_edit on payments for update using (is_team()) with check (is_team());
create policy payments_delete on payments for delete using (is_owner());

-- Called only by n8n with the service key. Finds the customer by email (or creates one), marks Paid, adds the payment.
create or replace function record_payment(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; pid uuid; em text := lower(trim(coalesce(p->>'email','')));
begin
  if exists (select 1 from payments where stripe_id = p->>'stripe_id') then return null; end if;
  select id into cid from customers where lower(email) = em and em <> '' order by created_at limit 1;
  if cid is null then
    insert into customers (business_name, contact_name, phone, email, stage, paid_on, source)
    values (coalesce(nullif(p->>'business',''), nullif(p->>'name',''), nullif(em,''), 'Stripe customer'), p->>'name', p->>'phone', nullif(em,''), 'paid', current_date, 'stripe')
    returning id into cid;
  else
    update customers set stage = case when stage in ('ready_to_quote','quoted','accepted') then 'paid' else stage end,
      paid_on = current_date, updated_at = now() where id = cid;
  end if;
  insert into payments (stripe_id, customer_id, email, product, kind, amount_cents, raw)
  values (p->>'stripe_id', cid, nullif(em,''), p->>'product', coalesce(p->>'kind','other'), nullif(p->>'amount_cents','')::int, p)
  returning id into pid;
  return pid;
end $$;
revoke all on function record_payment(jsonb) from public, anon, authenticated;
grant execute on function record_payment(jsonb) to service_role;
