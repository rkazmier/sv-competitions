# Wizja produktu — SV Competitions

## Cel

Jedno miejsce do obsługi zawodów na strzelnicy Steel Valley: od ogłoszenia, przez zapisy i płatności,
po wyniki i ranking sezonowy. Aplikacja działa pod adresem https://events.steel-valley.pl,
a strona główna https://steel-valley.pl prowadzi do niej linkiem.

## Użytkownicy

| Rola | Potrzeby |
| --- | --- |
| Gość | Przegląda kalendarz i Ofertę, czyta regulamin i przebieg zawodów, ogląda wyniki i ranking |
| Użytkownik (klient strzelnicy, zawodnik) | Zakłada konto, kupuje karnety i wejścia, pokazuje kod QR, zapisuje się na zawody, widzi swoje płatności i wejścia |
| Obsługa strzelnicy | Wpisuje do książki rejestru pobytu, sprzedaje na miejscu |
| Admin | Prowadzi kalendarz i zawody, Ofertę, konta i role, przegląda książkę (ADR-0004) |

## Moduły i etapy

| Moduł | Etap |
| --- | --- |
| Kalendarz zawodów | MVP |
| Strona zawodów (opis, regulamin, harmonogram, komunikaty) | MVP |
| Rejestracja (konto, zgłoszenie, lista rezerwowa, e-mail) | MVP |
| Panel organizatora (zawody, zgłoszenia, eksport, ręczne wpłaty) | MVP |
| Płatności online Tpay (BLIK, przelew, karta, zwroty) | Etap 3 |
| Wyniki (wpis, import CSV lub link zewnętrzny) | Etap 4 |
| Ranking zbiorczy dla wybranych dyscyplin | Etap 4 |
| Konta, role i panel użytkownika (SPEC-002) | Klient strzelnicy, etap 1 |
| Oferta: karnety, wejścia, wejściówki (SPEC-003) | Klient strzelnicy, etap 2 |
| Faktury (SPEC-004) | Klient strzelnicy, etap 3 |
| Książka rejestru pobytu na strzelnicy (SPEC-005) | Klient strzelnicy, etap 4 |

## Poza zakresem (na teraz)

Aplikacja mobilna, czat, sklep z towarami (Oferta obejmuje tylko wejścia, karnety i wejściówki), obsługa organizatorów spoza Steel Valley.

## Pytania otwarte

- Czy potrzebne są faktury lub paragony za wpisowe? (faktury za Ofertę — SPEC-004; wpisowe — w specyfikacji zapisów)
- Jakie dyscypliny i jakie dane zawodnika są wymagane (licencja/patent, klub, klasa sprzętu)?
- Czy wyniki prowadzone są dziś w zewnętrznym systemie, do którego wystarczy link?
- Zasady rankingu: suma wszystkich startów czy N najlepszych; punkty za miejsce czy za wynik?
