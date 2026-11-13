-- Dane przykładowe TYLKO dla lokalnego Supabase i CI (`supabase start` / `supabase db reset`).
-- Nie trafiają na staging ani produkcję (`supabase db push` nie wczytuje seed). Nazwy są fikcyjne.
-- Daty liczone od dziś, żeby kalendarz zawsze miał nadchodzące wpisy (strona publiczna, testy E2E #10).

insert into public.disciplines (id, name) values
  ('5eed0000-0000-4000-8000-000000000001', 'Dyscyplina przykładowa');

insert into public.event_categories (id, name) values
  ('5eed0000-0000-4000-8000-000000000002', 'Kategoria przykładowa');

-- Plik nie istnieje w Storage — link wystarcza do testów strony.
insert into public.rulebooks (id, title, file_path, file_size) values
  ('5eed0000-0000-4000-8000-000000000003', 'Regulamin przykładowy',
   'rulebooks/5eed0000-0000-4000-8000-000000000003.pdf', 1024);

insert into public.competitions
  (id, name, discipline_id, starts_on, ends_on, description, rulebook_id, matchbook_path, status)
values
  ('5eed0000-0000-4000-8000-0000000000c1', 'Zawody przykładowe A', '5eed0000-0000-4000-8000-000000000001',
   current_date + 30, current_date + 31,
   E'Pierwszy akapit opisu zawodów przykładowych.\nDruga linia tego samego akapitu.\n\nDrugi akapit z <b>HTML</b>, który ma się wyświetlić jako tekst.',
   '5eed0000-0000-4000-8000-000000000003',
   'matchbooks/5eed0000-0000-4000-8000-0000000000c1/5eed0000-0000-4000-8000-000000000004.pdf', 'published'),
  ('5eed0000-0000-4000-8000-0000000000c2', 'Zawody przykładowe B', '5eed0000-0000-4000-8000-000000000001',
   current_date + 60, null, null, '5eed0000-0000-4000-8000-000000000003', null, 'published'),
  ('5eed0000-0000-4000-8000-0000000000c3', 'Zawody przykładowe minione', '5eed0000-0000-4000-8000-000000000001',
   current_date - 30, null, 'Zawody, które już się odbyły.', '5eed0000-0000-4000-8000-000000000003', null, 'published'),
  ('5eed0000-0000-4000-8000-0000000000c4', 'Zawody przykładowe szkic', '5eed0000-0000-4000-8000-000000000001',
   current_date + 30, null, null, null, null, 'draft');

insert into public.schedule_items (competition_id, day, "time", description) values
  ('5eed0000-0000-4000-8000-0000000000c1', current_date + 30, '09:00', 'Odprawa'),
  ('5eed0000-0000-4000-8000-0000000000c1', current_date + 30, null, 'Rejestracja zawodników'),
  ('5eed0000-0000-4000-8000-0000000000c1', current_date + 31, '08:00', 'Drugi dzień — start');

insert into public.calendar_events
  (id, name, category_id, starts_on, ends_on, description, external_url, status)
values
  ('5eed0000-0000-4000-8000-0000000000e1', 'Wydarzenie przykładowe A', '5eed0000-0000-4000-8000-000000000002',
   current_date + 30, null, E'Opis wydarzenia przykładowego.\n\nDrugi akapit opisu.', 'https://example.com/wydarzenie', 'published'),
  ('5eed0000-0000-4000-8000-0000000000e2', 'Wydarzenie przykładowe trwające', '5eed0000-0000-4000-8000-000000000002',
   current_date - 40, current_date + 5, null, 'https://example.com/trwajace', 'published'),
  ('5eed0000-0000-4000-8000-0000000000e3', 'Wydarzenie przykładowe szkic', '5eed0000-0000-4000-8000-000000000002',
   current_date + 30, null, null, null, 'draft'),
  ('5eed0000-0000-4000-8000-0000000000e4', 'Wydarzenie przykładowe minione', '5eed0000-0000-4000-8000-000000000002',
   current_date - 10, current_date - 9, null, 'https://example.com/minione', 'published');
