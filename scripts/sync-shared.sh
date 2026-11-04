#!/bin/sh
# Copy shared email helpers next to each function so each deploys on its own.
cd "$(dirname "$0")/../supabase/functions" || exit 1
for f in send-invoice track-open invoice-public reminders daily-digest send-update google-oauth task-sync calendar-feed calendar-event; do
  cp _shared/mail.ts "$f/mail.ts"
done
for f in send-invoice reminders; do cp _shared/invoice-mail.ts "$f/invoice-mail.ts"; done
for f in daily-digest send-update; do cp _shared/update-mail.ts "$f/update-mail.ts"; done
for f in google-oauth task-sync calendar-feed calendar-event; do cp _shared/google.ts "$f/google.ts"; done
