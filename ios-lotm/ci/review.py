#!/usr/bin/env python3
"""TestFlight external review, through the App Store Connect API (the same key the build uses).

  inspect  — prints every build's beta review state, the external groups and their builds, and whether the
             review contact details are filled in (never prints the reviewer password).
  submit   — puts BUILD into GROUP, sets What to Test, and submits it to Beta App Review.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, ACTION, BUILD (number), GROUP (name), WHAT (text)
"""
import json, os, sys, time, urllib.request, urllib.error
import jwt

API = 'https://api.appstoreconnect.apple.com/v1'
BUNDLE = 'org.lotmstudy.app'
key = open(os.environ['ASC_KEY_PATH']).read()
now = int(time.time())
TOKEN = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'},
                   key, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})


def call(method, path, body=None, ok_fail=False):
    req = urllib.request.Request(path if path.startswith('http') else API + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:1500]
        if ok_fail:
            print(f'  ! {method} {path.split("?")[0]} → {e.code}: {msg}')
            return None
        sys.exit(f'{method} {path} failed: {e.code} {msg}')


app = call('GET', f'/apps?filter[bundleId]={BUNDLE}')['data'][0]
aid = app['id']
print(f'App: {app["attributes"]["name"]} ({aid})')

builds = call('GET', f'/builds?filter[app]={aid}&sort=-uploadedDate&limit=80&include=buildBetaDetail,preReleaseVersion,betaAppReviewSubmission')
inc = {(i['type'], i['id']): i for i in builds.get('included', [])}
def rel(b, name):
    d = (b['relationships'].get(name) or {}).get('data')
    return inc.get((d['type'], d['id'])) if d else None

print('\nBuilds (newest first):')
by_num = {}
for b in builds['data']:
    a = b['attributes']; num = a['version']; by_num[num] = b
    det = rel(b, 'buildBetaDetail'); ver = rel(b, 'preReleaseVersion'); sub = rel(b, 'betaAppReviewSubmission')
    ext = det["attributes"].get("externalBuildState") if det else "?"
    if ext == 'READY_FOR_BETA_SUBMISSION' and not sub and int(num) < 55: continue
    print(f'  {ver["attributes"]["version"] if ver else "?"} ({num})  processing={a.get("processingState")}  expired={a.get("expired")}'
          f'  external={det["attributes"].get("externalBuildState") if det else "?"}'
          f'  internal={det["attributes"].get("internalBuildState") if det else "?"}'
          f'  review={sub["attributes"].get("betaReviewState") if sub else "-"}')

subs = call('GET', f'/betaAppReviewSubmissions?filter[build]={",".join(b["id"] for b in builds["data"][:50])}&limit=50&include=build')
print('\nReview submissions:')
for s in subs.get('data', []):
    bid = s['relationships']['build']['data']['id']
    num = next((b['attributes']['version'] for b in builds['data'] if b['id'] == bid), bid)
    print(f'  build {num}: {s["attributes"].get("betaReviewState")}  submitted {s["attributes"].get("submittedDate")}')
if not subs.get('data'): print('  (none among these builds)')

groups = call('GET', f'/apps/{aid}/betaGroups?limit=50')['data']
print('\nGroups:')
gid = {}
for g in groups:
    a = g['attributes']; gid[a['name']] = g['id']
    gb = call('GET', f'/betaGroups/{g["id"]}/builds?limit=20')['data']
    nums = [x['attributes']['version'] for x in gb]
    print(f'  {a["name"]}: {"internal" if a.get("isInternalGroup") else "external"}  publicLink={a.get("publicLinkEnabled")}'
          f'  link={a.get("publicLink") or "-"}  builds={nums or "none"}')

rd = call('GET', f'/apps/{aid}/betaAppReviewDetail')['data']['attributes']
print('\nReview details:')
for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail', 'demoAccountName', 'demoAccountRequired'):
    v = rd.get(k)
    print(f'  {k}: {"set" if v not in (None, "") else "MISSING"}' + (f' ({v})' if k == 'demoAccountRequired' else ''))
print(f'  demoAccountPassword: {"set" if rd.get("demoAccountPassword") else "MISSING"}')
loc = call('GET', f'/apps/{aid}/betaAppLocalizations')['data']
print(f'  beta description: {"set" if loc and loc[0]["attributes"].get("description") else "MISSING"}'
      f'  feedbackEmail: {"set" if loc and loc[0]["attributes"].get("feedbackEmail") else "MISSING"}')

WHAT_DEFAULT = '''1. Sign in with the account provided.
2. Feed: scroll posts, open one, like it, and reply.
3. Tap the pencil button to write a short post (100 words at most).
4. Library: switch between My Library, Commonplace and LOTM.
5. Chat: choose a chat passphrase when asked, then send a message, a photo and a reaction.
6. Settings: review profile and notification options.'''

action = os.environ.get('ACTION') or 'inspect'
gname = os.environ.get('GROUP') or 'LOTM Test'
if action.startswith('expire:'):
    # pull a build out of TestFlight (this also cancels its Beta App Review), then carry on as 'auto'
    old = by_num.get(action.split(':', 1)[1]) or sys.exit('No such build')
    call('PATCH', f'/builds/{old["id"]}', {'data': {'type': 'builds', 'id': old['id'], 'attributes': {'expired': True}}})
    print(f'\nExpired build {old["attributes"]["version"]}')
    subs['data'] = [x for x in subs.get('data', []) if x['relationships']['build']['data']['id'] != old['id']]
    action = 'auto'
if action == 'auto':
    # Nothing to do while Apple is reviewing a build; otherwise send the newest build to the group if it isn't there yet.
    busy = [s for s in subs.get('data', []) if s['attributes'].get('betaReviewState') in ('WAITING_FOR_REVIEW', 'IN_REVIEW')]
    if busy:
        print('\nAUTO: a build is still in Beta App Review; nothing to do yet.'); sys.exit(0)
    newest = next((b for b in builds['data'] if b['attributes'].get('processingState') == 'VALID' and not b['attributes'].get('expired')), None)
    in_group = {x['attributes']['version'] for x in call('GET', f'/betaGroups/{gid[gname]}/builds?limit=50')['data']} if gname in gid else set()
    if not newest or newest['attributes']['version'] in in_group:
        print(f'\nAUTO: "{gname}" already has the newest build; nothing to do.'); sys.exit(0)
    os.environ['BUILD'] = newest['attributes']['version']
    action = 'submit'
if action != 'submit':
    sys.exit(0)

num, what = os.environ['BUILD'], os.environ.get('WHAT') or WHAT_DEFAULT
b = by_num.get(num) or sys.exit(f'No build {num}')
print(f'\nSubmitting build {num} to "{gname}"')
if what:
    locs = call('GET', f'/builds/{b["id"]}/betaBuildLocalizations')['data']
    en = next((l for l in locs if l['attributes']['locale'].startswith('en')), None)
    if en: call('PATCH', f'/betaBuildLocalizations/{en["id"]}', {'data': {'type': 'betaBuildLocalizations', 'id': en['id'], 'attributes': {'whatsNew': what}}}, ok_fail=True)
    else: call('POST', '/betaBuildLocalizations', {'data': {'type': 'betaBuildLocalizations', 'attributes': {'locale': 'en-US', 'whatsNew': what},
               'relationships': {'build': {'data': {'type': 'builds', 'id': b['id']}}}}}, ok_fail=True)
    print('  What to Test set')
g = gid.get(gname) or sys.exit(f'No group named {gname}')
r = call('POST', f'/betaGroups/{g}/relationships/builds', {'data': [{'type': 'builds', 'id': b['id']}]}, ok_fail=True)
if r is not None: print('  added to group')
r = call('POST', '/betaAppReviewSubmissions', {'data': {'type': 'betaAppReviewSubmissions', 'relationships': {'build': {'data': {'type': 'builds', 'id': b['id']}}}}}, ok_fail=True)
if r is not None: print(f'  submitted: {r["data"]["attributes"].get("betaReviewState")}')
