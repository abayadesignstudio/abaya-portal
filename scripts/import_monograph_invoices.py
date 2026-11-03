"""Turn Monograph's invoice export (CSV) into SQL for the portal database.
Usage: python3 import_monograph_invoices.py invoices.csv > out.sql
Idempotent: clients by name, projects by number, invoices by number."""
import csv, sys, re

def q(v):
    return 'null' if v in (None, '', '--') else "'" + str(v).replace("'", "''") + "'"

def category(name):
    n = name.lower()
    if '(fo)' in n or 'finish' in n: return 'FO'
    if '(shell)' in n or 'shell' in n: return 'S'
    if any(w in n for w in ('consult', 'inspection', 'tas', 'tdlr')): return 'CON'
    return None

STATUS = {'PAID': 'paid', 'PAST_DUE': 'open', 'OPEN': 'open', 'UNCOLLECTIBLE': 'uncollectible', 'VOID': 'void', 'DRAFT': 'draft'}
rows = list(csv.DictReader(open(sys.argv[1], newline='', encoding='utf-8-sig')))
out = ['begin;']
clients = sorted({r['Client'].strip() for r in rows if r['Client'].strip()})
for c in clients:
    out.append(f"insert into public.clients (name, monograph_ref) select {q(c)}, {q(c)} where not exists (select 1 from public.clients where name = {q(c)});")
projects = {}
for r in rows:
    num = r['Project #'].strip() or r['Invoice #'].split('-')[0].strip()
    projects.setdefault(num, (r['Project Name'].strip(), r['Client'].strip()))
for num, (name, client) in sorted(projects.items()):
    cat = category(name)
    out.append(f"insert into public.projects (number, name, client_id, category, status, monograph_ref) values ({q(num)}, {q(name)}, (select id from public.clients where name = {q(client)} limit 1), {q(cat)}, 'active', {q(num)}) on conflict (number) do nothing;")
for r in rows:
    num = r['Project #'].strip() or r['Invoice #'].split('-')[0].strip()
    inv = r['Invoice #'].strip()
    st = STATUS.get(r['Status'].strip().upper(), 'open')
    pm = r['Payment Method'].strip()
    total = float(r['Invoice total'] or 0); paid = float(r['Paid amount'] or 0)
    out.append(
        "insert into public.invoices (number, project_id, client_id, status, issue_date, due_date, paid_at, payment_method, subtotal, total, amount_paid, monograph_ref, sent_at, hold_drawings, reminders) values ("
        f"{q(inv)}, (select id from public.projects where number = {q(num)}), (select id from public.clients where name = {q(r['Client'].strip())} limit 1), '{st}', "
        f"{q(r['Issue Date'])}, {q(r['Due Date'])}, {q(r['Paid Date'] if st == 'paid' else '')}, {q(pm)}, {total}, {total}, {paid}, {q(inv)}, {q(r['Issue Date'])}, false, false"
        ") on conflict (number) do nothing;")
    for kind, col, label in (('other', 'Arch services total', 'Architecture services'), ('other', 'Consultants total', 'Consultants'), ('other', 'Other total', 'Other items')):
        amt = float(r[col] or 0)
        if round(amt, 2) != 0:
            out.append(f"insert into public.invoice_lines (invoice_id, kind, description, amount, sort) select id, '{kind}', {q(label + ' (imported from Monograph)')}, {round(amt, 2)}, 0 from public.invoices where number = {q(inv)} and not exists (select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id where i.number = {q(inv)} and l.description = {q(label + ' (imported from Monograph)')});")
    out.append(f"insert into public.invoice_events (invoice_id, kind, detail, at) select id, 'note', {q('Imported from Monograph (activity: ' + r['Activity'] + ')')}, now() from public.invoices where number = {q(inv)} and not exists (select 1 from public.invoice_events e join public.invoices i on i.id = e.invoice_id where i.number = {q(inv)} and e.detail like 'Imported from Monograph%');")
out.append('commit;')
print('\n'.join(out))
