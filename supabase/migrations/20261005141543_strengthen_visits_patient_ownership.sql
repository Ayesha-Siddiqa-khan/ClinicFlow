-- Strengthen visits RLS so a visit can only reference
-- a patient owned by the same authenticated doctor.

drop policy "visits own rows" on public.visits;

create policy "visits own rows" on public.visits
  for all
  using (
    auth.uid() = doctor_id
    and exists (
      select 1
      from public.patients p
      where p.id = patient_id
        and p.doctor_id = auth.uid()
    )
  )
  with check (
    auth.uid() = doctor_id
    and exists (
      select 1
      from public.patients p
      where p.id = patient_id
        and p.doctor_id = auth.uid()
    )
  );