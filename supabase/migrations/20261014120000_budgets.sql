-- Хранилище для сайта «Бюджет свадьбы».
-- Весь бюджет хранится одной JSON-записью. Доступ — только по секретному коду
-- (он есть в ссылке для телефонов) через две функции ниже. Напрямую к таблице
-- с публичным ключом обратиться нельзя: RLS включён, политик нет.

create table if not exists public.budgets (
  code       text primary key check (char_length(code) between 24 and 64),
  data       jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.budgets enable row level security;
revoke all on public.budgets from anon, authenticated;

-- Прочитать бюджет по коду. Возвращает {data, version} или null.
create or replace function public.get_budget(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('data', b.data, 'version', b.version)
  from public.budgets b
  where b.code = p_code and char_length(p_code) >= 24;
$$;

-- Сохранить бюджет. p_version — версия, с которой клиент начинал правку
-- (0 — записи ещё нет). Если кто-то успел сохранить раньше, запись не
-- меняется и возвращается conflict + актуальные данные: клиент объединяет
-- изменения и пробует снова, поэтому правки с двух телефонов не теряются.
create or replace function public.save_budget(p_code text, p_data jsonb, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.budgets;
begin
  if char_length(p_code) < 24 or char_length(p_code) > 64 then
    raise exception 'bad code';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or jsonb_typeof(p_data -> 'events') <> 'array'
     or jsonb_typeof(p_data -> 'items') <> 'array' then
    raise exception 'bad data';
  end if;
  if octet_length(p_data::text) > 2000000 then
    raise exception 'data too large';
  end if;

  select * into cur from public.budgets where code = p_code for update;

  if not found then
    if coalesce(p_version, 0) <> 0 then
      return jsonb_build_object('ok', false, 'conflict', true, 'data', null, 'version', 0);
    end if;
    insert into public.budgets (code, data, version) values (p_code, p_data, 1);
    return jsonb_build_object('ok', true, 'version', 1);
  end if;

  if cur.version <> p_version then
    return jsonb_build_object('ok', false, 'conflict', true, 'data', cur.data, 'version', cur.version);
  end if;

  update public.budgets
     set data = p_data, version = cur.version + 1, updated_at = now()
   where code = p_code;
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end;
$$;

revoke all on function public.get_budget(text) from public;
revoke all on function public.save_budget(text, jsonb, integer) from public;
grant execute on function public.get_budget(text) to anon, authenticated;
grant execute on function public.save_budget(text, jsonb, integer) to anon, authenticated;
