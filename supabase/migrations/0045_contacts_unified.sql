-- One person, one contact. Client contacts become links (client_contacts.contact_id → contacts); a person can be on any number of
-- clients and projects. client_contacts keeps name/email/phone as a synced copy so everything that reads it (emails, invoices, sync) keeps working.
alter table public.contacts drop constraint if exists contacts_check;
alter table public.contacts add constraint contacts_has_identity check (coalesce(trim(name), '') <> '' or coalesce(trim(company), '') <> '' or coalesce(trim(email), '') <> '');
alter table public.client_contacts add column if not exists contact_id uuid references public.contacts(id) on delete cascade;

-- existing client contacts → one library person per email
insert into public.contacts (name, email, phone, trade)
select distinct on (lower(email)) name, lower(email), phone, 'Client' from public.client_contacts where email is not null order by lower(email), name nulls last
on conflict do nothing;
update public.client_contacts cc set contact_id = c.id from public.contacts c where lower(c.email) = lower(cc.email) and cc.contact_id is null;

-- adding someone to a client: link the library person with that email, or create them
create or replace function private.client_contact_link() returns trigger language plpgsql security definer set search_path = public as $$
declare c public.contacts;
begin
  if new.contact_id is not null then select * into c from contacts where id = new.contact_id;
  else select * into c from contacts where lower(email) = lower(new.email) limit 1; end if;
  if c.id is null then
    insert into contacts (name, email, phone, trade) values (nullif(trim(new.name), ''), lower(new.email), nullif(trim(new.phone), ''), 'Client') returning * into c;
  end if;
  new.contact_id := c.id;
  new.email := coalesce(c.email, lower(new.email));
  new.name := coalesce(nullif(trim(new.name), ''), c.name);
  new.phone := coalesce(nullif(trim(new.phone), ''), c.phone);
  if c.email is null and new.email is not null then update contacts set email = new.email where id = c.id; end if;
  return new;
end $$;
drop trigger if exists client_contacts_link on public.client_contacts;
create trigger client_contacts_link before insert on public.client_contacts for each row execute function private.client_contact_link();

-- editing a person anywhere keeps every copy the same
create or replace function private.contact_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update client_contacts set name = new.name, email = coalesce(new.email, email), phone = new.phone where contact_id = new.id;
  return new;
end $$;
drop trigger if exists contacts_push on public.contacts;
create trigger contacts_push after update of name, email, phone on public.contacts for each row execute function private.contact_push();

create or replace function private.client_contact_pull() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.contact_id is null then return new; end if;
  if new.name is distinct from old.name or new.email is distinct from old.email or new.phone is distinct from old.phone then
    update contacts set name = new.name, email = lower(new.email), phone = new.phone where id = new.contact_id;
    update client_contacts set name = new.name, email = lower(new.email), phone = new.phone where contact_id = new.contact_id and id <> new.id;
  end if;
  return new;
end $$;
drop trigger if exists client_contacts_pull on public.client_contacts;
create trigger client_contacts_pull after update on public.client_contacts for each row execute function private.client_contact_pull();
