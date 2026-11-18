-- SPEC-005 AC-1, AC-1a (#104): nr legitymacji i instytucja prowadzącego strzelanie.
-- Kolumny dopuszczają `null` — prowadzący dodani przed zmianą mają puste pola do uzupełnienia w panelu;
-- formularz panelu wymaga obu pól. Instytucja jako kod (etykiety w i18n): PZSS, LOK, PZL (PZŁ), OTHER (Inne).
-- Dane nie są kopiowane do `range_log` (decyzja właściciela w #104).

alter table public.range_officers
  add column license_number text
    check (length(license_number) between 1 and 50 and license_number = trim(license_number)),
  add column institution text
    check (institution in ('PZSS', 'LOK', 'PZL', 'OTHER')),
  add column institution_other text
    check (length(institution_other) between 2 and 150 and institution_other = trim(institution_other)),
  add constraint range_officers_license_pair check ((license_number is null) = (institution is null)),
  -- „Inne” → nazwa instytucji wpisana ręcznie (wymagana); pozostałe opcje — bez nazwy.
  add constraint range_officers_institution_other check ((coalesce(institution, '') = 'OTHER') = (institution_other is not null));

comment on column public.range_officers.license_number is 'Nr legitymacji prowadzącego (SPEC-005 AC-1)';
comment on column public.range_officers.institution_other is 'Nazwa instytucji, gdy institution = OTHER (Inne)';
comment on column public.range_officers.institution is 'Instytucja wydająca legitymację: PZSS, LOK, PZL (PZŁ), OTHER (Inne)';

grant insert (license_number, institution, institution_other), update (license_number, institution, institution_other)
  on public.range_officers to authenticated;
