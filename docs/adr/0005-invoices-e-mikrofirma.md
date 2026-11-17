# ADR-0005: Faktury wystawiane ręcznie w e-mikrofirmie

- Data: 2026-11-17
- Status: przyjęta (decyzja 4-A w #38, SPEC-004)

## Kontekst
Faktury muszą trafiać do KSeF. Właściciel wybrał serwis, którego używa firma: **e-mikrofirma** (aplikacja Ministerstwa Finansów
w e-Urzędzie Skarbowym, zintegrowana z KSeF). e-mikrofirma nie udostępnia API dla innych aplikacji — integracja z KSeF
z zewnętrznego programu jest możliwa tylko przez API KSeF.

## Decyzja
- Aplikacja **nie wystawia** faktur. Zbiera dane do faktury (NIP → Biała lista MF / GUS REGON, albo wpis ręczny),
  zapisuje je przy zamówieniu i pokazuje adminowi listę „Do wystawienia” z danymi do skopiowania i eksportem CSV.
- Admin wystawia fakturę w e-mikrofirmie i zapisuje w aplikacji numer faktury oraz numer KSeF.
- Numeracja, stawki VAT, korekty i archiwum faktur — w e-mikrofirmie / KSeF.

## Rozważone
- Bezpośrednie API KSeF z Edge Function — pełna automatyzacja, ale aplikacja staje się systemem fakturowym
  (numeracja, korekty, VAT, token KSeF firmy); możliwe jako osobny etap, gdy liczba faktur to uzasadni.
- Komercyjny serwis z API (Fakturownia, inFakt, wFirma) — odrzucone: firma korzysta z e-mikrofirmy.

## Konsekwencje
- Ręczny krok admina przy każdej fakturze; lista „Do wystawienia” w menu z licznikiem.
- Brak sekretów KSeF w aplikacji.
