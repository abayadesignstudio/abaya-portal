-- Card payment is opt-in per invoice; the card fee is never passed to the client
-- (Texas prohibits surcharging debit cards, and Stripe can't tell debit from credit before checkout).
alter table public.invoices alter column allow_card set default false;
update public.invoices set pass_card_fee = false where pass_card_fee;
