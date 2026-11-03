-- 0006e: website pages edited in the portal (Puck) and rendered at /p/.
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  nav_order int not null default 0,
  show_in_nav boolean not null default true,
  content jsonb not null default '{"root":{"props":{}},"content":[]}'::jsonb,
  published_content jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);
create index if not exists site_pages_nav_idx on public.site_pages (nav_order);
create index if not exists site_pages_updated_by_idx on public.site_pages (updated_by);

create or replace function private.site_pages_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.slug is distinct from old.slug and old.slug = 'home' then
    raise exception 'The home page address cannot change';
  end if;
  return new;
end $$;
revoke all on function private.site_pages_touch() from public, anon, authenticated;
drop trigger if exists site_pages_touch on public.site_pages;
create trigger site_pages_touch before update on public.site_pages for each row execute function private.site_pages_touch();

create or replace function private.site_pages_guard_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.slug = 'home' then raise exception 'The home page cannot be deleted'; end if;
  return old;
end $$;
revoke all on function private.site_pages_guard_delete() from public, anon, authenticated;
drop trigger if exists site_pages_guard_delete on public.site_pages;
create trigger site_pages_guard_delete before delete on public.site_pages for each row execute function private.site_pages_guard_delete();

alter table public.site_pages enable row level security;

-- Staff: everything. Everyone else: published rows only, and (for anon) only the public columns.
drop policy if exists "staff all" on public.site_pages;
create policy "staff all" on public.site_pages for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
drop policy if exists "published readable" on public.site_pages;
create policy "published readable" on public.site_pages for select to anon, authenticated
  using (published_content is not null);

revoke all on public.site_pages from anon, authenticated;
grant select (id, slug, title, nav_order, show_in_nav, published_content, published_at) on public.site_pages to anon;
grant select, insert, update, delete on public.site_pages to authenticated;

-- What the public renderer reads (runs with the caller's rights, so RLS + column grants apply).
create or replace view public.site_pages_public with (security_invoker = on) as
  select slug, title, nav_order, show_in_nav, published_content, published_at
  from public.site_pages where published_content is not null;
revoke all on public.site_pages_public from anon, authenticated;
grant select on public.site_pages_public to anon, authenticated;

-- Images for the site: public read by URL (no listing), staff write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 20971520, array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site media staff read" on storage.objects;
create policy "site media staff read" on storage.objects for select to authenticated
  using (bucket_id = 'site' and (select private.is_staff()));
drop policy if exists "site media staff insert" on storage.objects;
create policy "site media staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and (select private.is_staff()));
drop policy if exists "site media staff update" on storage.objects;
create policy "site media staff update" on storage.objects for update to authenticated
  using (bucket_id = 'site' and (select private.is_staff())) with check (bucket_id = 'site' and (select private.is_staff()));
drop policy if exists "site media staff delete" on storage.objects;
create policy "site media staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site' and (select private.is_staff()));

-- Seed: a "home" page whose blocks reproduce the current static homepage (published).
insert into public.site_pages (slug, title, nav_order, show_in_nav, content, published_content, published_at)
values ('home', 'Home', 0, false, $seed$
{"root":{"props":{"title":"Abaya Design Studio","description":"Abaya Design Studio — traditional architecture adapted for modern living, in Coppell, Texas."}},"content":[{"type":"Section","props":{"id":"Section-seed-5","anchor":"","background":"deep","frame":"none","padding":"lg","width":"narrow","align":"center","minHeight":"hero","image":"","shade":"0.45","ovals":"on","content":[{"type":"Heading","props":{"id":"Heading-seed-1","style":"eyebrow","kicker":"","text":"Abaya Design Studio · Coppell, Texas","size":"lg","level":"h2","align":"inherit"}},{"type":"Heading","props":{"id":"Heading-seed-2","style":"display","kicker":"Timeless & Traditional","text":"ARCHITECTURE","size":"xl","level":"h1","align":"inherit"}},{"type":"Divider","props":{"id":"Divider-seed-3","style":"diamond","width":"normal","space":"24"}},{"type":"Text","props":{"id":"Text-seed-4","text":"[Project name], [City] — [see the work](work/)","size":"small","tone":"muted","align":"inherit"}}]}},{"type":"Section","props":{"id":"Section-seed-11","anchor":"approach","background":"navy","frame":"none","padding":"md","width":"normal","align":"left","minHeight":"auto","image":"","shade":"0.45","ovals":"off","content":[{"type":"Columns","props":{"id":"Columns-seed-10","layout":"6-6","gap":"lg","valign":"center","stack":"stack","col1":[{"type":"Heading","props":{"id":"Heading-seed-6","style":"eyebrow","kicker":"","text":"The Firm","size":"lg","level":"h2","align":"inherit"}},{"type":"Heading","props":{"id":"Heading-seed-7","style":"statement","kicker":"","text":"Good architecture should feel considered, lasting, and at home in its setting.","size":"lg","level":"h3","align":"inherit"}},{"type":"Text","props":{"id":"Text-seed-8","text":"**Abaya Design Studio** is an architecture firm in Coppell, Texas, offering traditional design adapted for modern living. We draw from tradition not to repeat the past, but to recover what it teaches.\n\nWhether residential, commercial, or institutional, our work seeks to serve real human life.","size":"body","tone":"muted","align":"inherit"}}],"col2":[{"type":"Image","props":{"id":"Image-seed-9","image":"site-media/sketching-by-river.jpg","alt":"Painting of two people sketching on the bank of a quiet river beneath trees","caption":"[Caption: title, artist and date of the painting]","ratio":"3:4","frame":"corners","tone":"duotone"}}],"col3":[],"col4":[]}}]}},{"type":"ProjectPlate","props":{"id":"ProjectPlate-seed-12","anchor":"work","kicker":"Plate I.","heading":"SELECTED WORKS","projects":[{"category":"Commercial","title":"[Project name — town center]","blurb":"[One or two sentences about the project, its site, and the client.]","image":"","alt":"","link":"work/"},{"category":"Residential","title":"[Project name — lake house]","blurb":"[One or two sentences about the project.]","image":"","alt":"","link":"work/"},{"category":"Commercial","title":"[Project name — Heritage Park]","blurb":"[One or two sentences about the project.]","image":"","alt":"","link":"work/"},{"category":"Residential","title":"[Project name — Hendricks]","blurb":"[One or two sentences about the project.]","image":"","alt":"","link":"work/"}]}},{"type":"Tenets","props":{"id":"Tenets-seed-13","anchor":"tenets","kicker":"Our","heading":"TENETS","background":"site-media/tracery-plate.jpg","items":[{"numeral":"I","title":"Proportion","line":"[One or two lines on how proportion guides your work]"},{"numeral":"II","title":"Restraint","line":"[One or two lines on restraint]"},{"numeral":"III","title":"Material Honesty","line":"[One or two lines on material honesty]"},{"numeral":"IV","title":"Order","line":"[One or two lines on order]"}]}},{"type":"Section","props":{"id":"Section-seed-22","anchor":"practice","background":"navy","frame":"none","padding":"lg","width":"normal","align":"left","minHeight":"auto","image":"","shade":"0.45","ovals":"on","content":[{"type":"Heading","props":{"id":"Heading-seed-14","style":"display","kicker":"The","text":"PRACTICE","size":"lg","level":"h2","align":"center"}},{"type":"Divider","props":{"id":"Divider-seed-15","style":"diamond","width":"normal","space":"24"}},{"type":"Spacer","props":{"id":"Spacer-seed-16","size":"48"}},{"type":"Columns","props":{"id":"Columns-seed-21","layout":"3-3-3-3","gap":"md","valign":"start","stack":"stack","col1":[{"type":"Feature","props":{"id":"Feature-seed-17","numeral":"i.","title":"Commercial","text":"Economical buildings with a strong identity, rooted in their context and the vernacular of the place."}}],"col2":[{"type":"Feature","props":{"id":"Feature-seed-18","numeral":"ii.","title":"Residential","text":"Custom homes shaped closely with each family: functional, beautiful, and made to last."}}],"col3":[{"type":"Feature","props":{"id":"Feature-seed-19","numeral":"iii.","title":"Light Industrial","text":"Flexible metal buildings for storage, workshops, and sports facilities, tailored to how they are used."}}],"col4":[{"type":"Feature","props":{"id":"Feature-seed-20","numeral":"iv.","title":"General Office","text":"Offices for small businesses: medical practices, real estate, insurance, and other professional firms."}}]}}]}},{"type":"Section","props":{"id":"Section-seed-29","anchor":"","background":"olive","frame":"none","padding":"lg","width":"normal","align":"left","minHeight":"auto","image":"","shade":"0.45","ovals":"off","content":[{"type":"Columns","props":{"id":"Columns-seed-28","layout":"6-6","gap":"lg","valign":"center","stack":"stack","col1":[{"type":"Heading","props":{"id":"Heading-seed-23","style":"eyebrow","kicker":"","text":"Plate II · On Building Well","size":"lg","level":"h2","align":"inherit"}},{"type":"Heading","props":{"id":"Heading-seed-24","style":"statement","kicker":"","text":"Buildings should be beautiful, useful, and durable — places where people gather, work, worship, rest, and return.","size":"xl","level":"h3","align":"inherit"}},{"type":"Text","props":{"id":"Text-seed-25","text":"With a sense that the design was made for them and for its place.","size":"body","tone":"muted","align":"inherit"}},{"type":"Button","props":{"id":"Button-seed-26","label":"Begin a Project","href":"#contact","style":"outline","align":"inherit"}}],"col2":[{"type":"Image","props":{"id":"Image-seed-27","image":"site-media/tracery-plate.jpg","alt":"Engraved plate of Gothic rose-window tracery with the circle constructions used to set them out","caption":"[Caption: source of the tracery plate]","ratio":"auto","frame":"corners","tone":"normal"}}],"col3":[],"col4":[]}}]}},{"type":"Section","props":{"id":"Section-seed-35","anchor":"","background":"navy","frame":"rule","padding":"md","width":"normal","align":"left","minHeight":"auto","image":"","shade":"0.45","ovals":"off","content":[{"type":"Columns","props":{"id":"Columns-seed-34","layout":"6-6","gap":"lg","valign":"center","stack":"stack","col1":[{"type":"Heading","props":{"id":"Heading-seed-30","style":"display","kicker":"For our","text":"CLIENTS","size":"md","level":"h2","align":"inherit"}},{"type":"Text","props":{"id":"Text-seed-31","text":"Sign in to review your drawings, see project progress, and view and pay invoices by card or bank transfer (ACH).","size":"body","tone":"muted","align":"inherit"}}],"col2":[{"type":"Button","props":{"id":"Button-seed-32","label":"Client Portal","href":"portal/","style":"light","align":"right"}},{"type":"Text","props":{"id":"Text-seed-33","text":"No password — we email you a secure sign-in link.","size":"small","tone":"muted","align":"right"}}],"col3":[],"col4":[]}}]}},{"type":"Section","props":{"id":"Section-seed-42","anchor":"contact","background":"navy","frame":"none","padding":"lg","width":"normal","align":"left","minHeight":"auto","image":"","shade":"0.45","ovals":"off","content":[{"type":"Columns","props":{"id":"Columns-seed-41","layout":"6-6","gap":"lg","valign":"start","stack":"stack","col1":[{"type":"Heading","props":{"id":"Heading-seed-36","style":"display","kicker":"Let’s work","text":"TOGETHER","size":"lg","level":"h2","align":"inherit"}},{"type":"Text","props":{"id":"Text-seed-37","text":"Tell us about your project — a home, a storefront, an office, or a building for your community.","size":"body","tone":"muted","align":"inherit"}},{"type":"Spacer","props":{"id":"Spacer-seed-38","size":"24"}},{"type":"Text","props":{"id":"Text-seed-39","text":"215 S. Denton Tap Road, Suite 215\nCoppell, Texas 75019\n[phone]\n[info@abayadesignstudio.com](mailto:info@abayadesignstudio.com)","size":"body","tone":"normal","align":"inherit"}}],"col2":[{"type":"ContactForm","props":{"id":"ContactForm-seed-40","to":"info@abayadesignstudio.com","types":"Residential, Commercial, Light Industrial, General Office, Other","button":"Send Inquiry"}}],"col3":[],"col4":[]}}]}}]}$seed$::jsonb, null, now())
on conflict (slug) do nothing;
update public.site_pages set published_content = content where slug = 'home' and published_content is null;
