-- SPEC-003 §5, US-1 (AC-1…AC-4): produkty Oferty — karnet ilościowy, karnet czasowy, wejście jednorazowe.
-- Kwoty w groszach. Produktów nie da się usunąć (AC-2). Rodzaju i liczby wejść/dni/dnia nie da się zmienić,
-- gdy produkt ma zamówienia (AC-3) — zamówienia przechowują kopie nazwy i ceny (`orders`, zadanie #48).

create table public.products (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('entries', 'days', 'single_entry')),
  name text not null check (length(name) between 1 and 100),
  description text check (length(description) <= 500),
  price integer not null check (price between 1 and 1000000),
  entries integer check (entries between 1 and 100),
  days integer check (days between 1 and 366),
  day_type text check (day_type in ('weekend', 'weekday')),
  is_active boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Pole szczegółu tylko dla swojego rodzaju (AC-1).
  constraint products_kind_details check (
    (entries is not null) = (kind = 'entries')
    and (days is not null) = (kind = 'days')
    and (day_type is not null) = (kind = 'single_entry')
  )
);
create index products_kind_position_idx on public.products (kind, position);

comment on table public.products is 'Produkty Oferty (SPEC-003 §5); ceny w groszach; bez usuwania — ukrycie is_active = false';
comment on column public.products.position is 'Kolejność w grupie rodzaju (AC-4); zmiana przez move_product()';

-- Czy produkt ma zamówienia (AC-3). Tabela `orders` powstaje w zadaniu #48 — do tego czasu zawsze `false`.
-- #48 może zastąpić ciało zwykłym zapytaniem do `public.orders`. Funkcja wewnętrzna, bez dostępu dla klientów.
create function public.product_order_exists(p_product_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  found boolean;
begin
  if to_regclass('public.orders') is null then
    return false;
  end if;
  execute 'select exists (select 1 from public.orders where product_id = $1)' into found using p_product_id;
  return found;
end;
$$;
revoke execute on function public.product_order_exists(uuid) from public, anon, authenticated;

-- Dla panelu (AC-3): blokada pól formularza edycji. Tylko admin; dla innych `false`.
create function public.product_has_orders(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() and public.product_order_exists(p_product_id);
$$;
revoke execute on function public.product_has_orders(uuid) from public, anon;
grant execute on function public.product_has_orders(uuid) to authenticated;

-- Normalizacja i reguły zapisu:
-- - nazwa i opis po trim, pusty opis → null;
-- - nowy produkt jest ukryty (AC-1) i trafia na koniec swojej grupy;
-- - zmiana rodzaju (bez zamówień) przenosi produkt na koniec nowej grupy;
-- - rodzaj, liczba wejść/dni i dzień są zamrożone, gdy istnieje zamówienie (AC-3) — błąd 23514 `product_has_orders`.
create function public.products_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.description := nullif(trim(new.description), '');
  if tg_op = 'INSERT' then
    new.is_active := false;
    new.created_at := now();
  else
    new.created_at := old.created_at;
    if (new.kind, new.entries, new.days, new.day_type) is distinct from (old.kind, old.entries, old.days, old.day_type)
       and public.product_order_exists(old.id) then
      raise exception 'product_has_orders' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.position := coalesce((select max(p.position) from public.products p where p.kind = new.kind), 0) + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger products_before_write before insert or update on public.products
  for each row execute function public.products_before_write();

-- Strzałki góra/dół (AC-4): zamiana miejscami z sąsiadem w grupie rodzaju. Uprawnienia jak RLS (invoker → admin).
-- Zwraca `false`, gdy produkt jest już na skraju grupy.
create function public.move_product(p_product_id uuid, p_direction text)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  current_row public.products;
  neighbour public.products;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  select * into current_row from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if p_direction = 'up' then
    select * into neighbour from public.products
      where kind = current_row.kind and (position, id) < (current_row.position, current_row.id)
      order by position desc, id desc limit 1 for update;
  else
    select * into neighbour from public.products
      where kind = current_row.kind and (position, id) > (current_row.position, current_row.id)
      order by position, id limit 1 for update;
  end if;
  if not found then
    return false;
  end if;
  -- Równe pozycje (np. po ręcznej zmianie) rozdzielamy, żeby zamiana zawsze zmieniała kolejność.
  update public.products set position = case
      when id = current_row.id then neighbour.position
      else current_row.position end
    where id in (current_row.id, neighbour.id);
  if current_row.position = neighbour.position then
    update public.products set position = position + (case when p_direction = 'up' then -1 else 1 end)
      where id = current_row.id;
  end if;
  return true;
end;
$$;
revoke execute on function public.move_product(uuid, text) from public, anon;
grant execute on function public.move_product(uuid, text) to authenticated;

-- ===== RLS (SPEC-003 §5) =====

alter table public.products enable row level security;

create policy "products: read active or staff" on public.products for select to anon, authenticated
  using (is_active or public.is_staff());
create policy "products: admin insert" on public.products for insert to authenticated
  with check (public.is_admin());
create policy "products: admin update" on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- AC-2: produktów nie da się usunąć (także adminowi z panelu).
revoke delete, truncate on public.products from anon, authenticated;
