-- Each person's calendar color (edge of their events on the Home calendar). Micah: orange.
alter table public.profiles add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
update public.profiles set color = '#e8772e' where lower(email) = 'micah@abayadesignstudio.com';
