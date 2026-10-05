-- ClinicFlow initial schema: patients, visits, medications + RLS.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  age integer not null check (age between 0 and 130),
  gender text not null,
  phone text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  doctor_id uuid not null references auth.users (id) on delete cascade,
  visit_date date not null,
  complaint text,
  diagnosis text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  medicine_name text not null,
  dose text,
  frequency text,
  duration text,
  instructions text,
  created_at timestamptz not null default now()
);

create index if not exists patients_doctor_id_idx on public.patients (doctor_id);
create index if not exists visits_patient_id_idx on public.visits (patient_id);
create index if not exists visits_doctor_id_idx on public.visits (doctor_id);
create index if not exists medications_visit_id_idx on public.medications (visit_id);

alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.medications enable row level security;

create policy "patients own rows" on public.patients
  for all using (auth.uid() = doctor_id) with check (auth.uid() = doctor_id);

create policy "visits own rows" on public.visits
  for all using (auth.uid() = doctor_id) with check (auth.uid() = doctor_id);

create policy "medications own visits" on public.medications
  for all using (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.doctor_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.doctor_id = auth.uid()
    )
  );
