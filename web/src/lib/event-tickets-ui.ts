/**
 * Karty wydarzeń płatnych w kalendarzu (SPEC-003 AC-17…AC-19): wolne miejsca (`event_seats_left`, klucz publishable)
 * i stan sprzedaży liczone w przeglądarce — strona jest statyczna, a liczba miejsc zmienia się po każdym zakupie.
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { ticketSale } from './offer';
import { getSupabase } from './supabase';

async function seatsLeft(eventId: string): Promise<number | null> {
  try {
    const { data, error } = await getSupabase().rpc('event_seats_left', { p_event_id: eventId });
    return error || typeof data !== 'number' ? null : data;
  } catch {
    return null; // brak połączenia — przycisk zostaje, payments-create i tak sprawdzi limit (AC-18)
  }
}

async function updateTicket(ticket: HTMLElement, today: string): Promise<void> {
  const { ticketEvent: eventId, ticketLastDay: lastDay, ticketCapacity } = ticket.dataset;
  if (!eventId || !lastDay) return;
  const seats = ticketCapacity && today <= lastDay ? await seatsLeft(eventId) : null;
  const sale = ticketSale(lastDay, today, seats);
  const seatsLine = ticket.querySelector<HTMLElement>('[data-ticket-seats]')!;
  seatsLine.hidden = sale !== 'open' || seats === null;
  if (seats !== null) seatsLine.textContent = t('calendarCard.seatsLeft', { count: seats });
  ticket.querySelector<HTMLElement>('[data-ticket-buy]')!.hidden = sale !== 'open';
  ticket.querySelector<HTMLElement>('[data-ticket-sold-out]')!.hidden = sale !== 'soldOut';
  ticket.querySelector<HTMLElement>('[data-ticket-closed]')!.hidden = sale !== 'closed';
}

export async function mountTicketCards(root: ParentNode = document): Promise<void> {
  const today = todayInWarsaw();
  await Promise.all([...root.querySelectorAll<HTMLElement>('[data-ticket-event]')].map((ticket) => updateTicket(ticket, today)));
}
