# Abaya Design Studio — website and portal

- `app/` — Vite + React. `index.html` is the public site; `portal/` is the staff and client portal (hash routes).
- `supabase/migrations/` — database schema and row-level security (project `ozowlkstprkvktosetci`).
- Deploys to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

Sign-in is invite only: add an email to `public.invites` with a role (`admin`, `staff`, or `client` + `client_id`).
The publishable Supabase key in `app/.env` is safe to commit; secret keys live only in Supabase secrets.
