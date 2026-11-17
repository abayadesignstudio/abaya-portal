#!/usr/bin/env python3
"""Invite someone to the LOTM beta through TestFlight (App Store Connect API). Run from the GitHub "Actions" tab.

1. Makes sure an external tester group ("LOTM Beta") exists and has the newest build.
2. The first time, fills in what Apple's beta review needs and submits that build for review.
3. Adds the tester's email to the group. Apple emails them an invitation once the build is cleared.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, TESTER_EMAIL, TESTER_FIRST, TESTER_LAST,
     CONTACT_FIRST, CONTACT_LAST, CONTACT_EMAIL, CONTACT_PHONE (review contact; only needed the first time)
"""
import json, os, sys, time, urllib.request, urllib.error
import jwt

API = 'https://api.appstoreconnect.apple.com/v1'
BUNDLE, GROUP = 'org.lotmstudy.app', 'LOTM Beta'

def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'},
                      open(os.environ['ASC_KEY_PATH']).read(), algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
TOKEN = token()

def call(method, path, body=None, ok_codes=()):
    req = urllib.request.Request(path if path.startswith('http') else API + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        if e.code in ok_codes: return {'_error': e.code, '_msg': msg}
        sys.exit(f'::error::App Store Connect {method} {path} failed ({e.code}): {msg[:900]}')

env = lambda k: (os.environ.get(k) or '').strip()
email = env('TESTER_EMAIL')
if '@' not in email: sys.exit('::error::Give the tester\'s email address.')

app = call('GET', f'/apps?filter[bundleId]={BUNDLE}')['data']
if not app: sys.exit('::error::LOTM app record not found in App Store Connect.')
app_id = app[0]['id']

# Newest processed build
builds = call('GET', f'/builds?filter[app]={app_id}&filter[processingState]=VALID&sort=-uploadedDate&limit=1')['data']
if not builds: sys.exit('::error::No processed build yet. Wait for the newest TestFlight build to finish processing.')
build = builds[0]; print('Newest build:', build['attributes'].get('version'))

# Beta info Apple wants before outside testers (description + feedback email), once
locs = call('GET', f'/apps/{app_id}/betaAppLocalizations')['data']
contact_email = env('CONTACT_EMAIL')
if not locs:
    call('POST', '/betaAppLocalizations', {'data': {'type': 'betaAppLocalizations', 'attributes': {'locale': 'en-US',
        'description': 'Life of the Mind: the study circle’s app for posts, the reading library, events, Commonplace notes and the Advent devotional.',
        'feedbackEmail': contact_email or None},
        'relationships': {'app': {'data': {'type': 'apps', 'id': app_id}}}}})
    print('Added beta description')

# Review contact (Apple needs a name, email and phone for beta review)
det = call('GET', f'/apps/{app_id}/betaAppReviewDetail')['data']
need = not (det['attributes'].get('contactPhone') and det['attributes'].get('contactEmail'))
if need:
    attrs = {k: v for k, v in {'contactFirstName': env('CONTACT_FIRST'), 'contactLastName': env('CONTACT_LAST'),
             'contactEmail': contact_email, 'contactPhone': env('CONTACT_PHONE'), 'demoAccountRequired': False}.items() if v not in ('', None)}
    if not attrs.get('contactPhone') or not attrs.get('contactEmail'):
        sys.exit('::error::First time only: Apple\'s beta review needs a contact phone and email. Run again and fill in "Your phone" and "Your email".')
    call('PATCH', f"/betaAppReviewDetails/{det['id']}", {'data': {'type': 'betaAppReviewDetails', 'id': det['id'], 'attributes': attrs}})
    print('Saved the review contact')

# The beta description needs a feedback email; use the review contact's if it was left blank
rev_email = call('GET', f'/apps/{app_id}/betaAppReviewDetail')['data']['attributes'].get('contactEmail')
for l in call('GET', f'/apps/{app_id}/betaAppLocalizations')['data']:
    if not l['attributes'].get('feedbackEmail') and rev_email:
        call('PATCH', f"/betaAppLocalizations/{l['id']}", {'data': {'type': 'betaAppLocalizations', 'id': l['id'], 'attributes': {'feedbackEmail': rev_email}}})
        print('Set the feedback email')

# What to test on this build
bl = call('GET', f"/builds/{build['id']}/betaBuildLocalizations")['data']
if not bl:
    call('POST', '/betaBuildLocalizations', {'data': {'type': 'betaBuildLocalizations', 'attributes': {'locale': 'en-US',
        'whatsNew': 'Try the Feed, Library (reading goals), events, Commonplace and the home-screen widgets.'},
        'relationships': {'build': {'data': {'type': 'builds', 'id': build['id']}}}}}, ok_codes=(409,))

# External group with the build
groups = [g for g in call('GET', f'/betaGroups?filter[app]={app_id}&limit=200')['data'] if g['attributes']['name'] == GROUP]
if groups: gid = groups[0]['id']
else:
    gid = call('POST', '/betaGroups', {'data': {'type': 'betaGroups', 'attributes': {'name': GROUP},
        'relationships': {'app': {'data': {'type': 'apps', 'id': app_id}}}}})['data']['id']
    print('Created tester group', GROUP)
call('POST', f'/betaGroups/{gid}/relationships/builds', {'data': [{'type': 'builds', 'id': build['id']}]}, ok_codes=(409,))

# Beta review for this build (skipped if already submitted or approved)
state = call('GET', f"/builds/{build['id']}/buildBetaDetail")['data']['attributes'].get('externalBuildState')
print('Review state:', state)
if state in ('READY_FOR_BETA_SUBMISSION', 'MISSING_EXPORT_COMPLIANCE', None):
    r = call('POST', '/betaAppReviewSubmissions', {'data': {'type': 'betaAppReviewSubmissions',
        'relationships': {'build': {'data': {'type': 'builds', 'id': build['id']}}}}}, ok_codes=(409, 422))
    if '_error' in r:
        sys.exit('::error::Apple did not accept the beta review submission: ' + r['_msg'][:600])
    print('Submitted for beta review')

# The tester
found = call('GET', f'/betaTesters?filter[email]={urllib.request.quote(email)}&filter[apps]={app_id}')['data']
if found:
    call('POST', f"/betaGroups/{gid}/relationships/betaTesters", {'data': [{'type': 'betaTesters', 'id': found[0]['id']}]}, ok_codes=(409,))
else:
    call('POST', '/betaTesters', {'data': {'type': 'betaTesters', 'attributes': {'email': email,
        'firstName': env('TESTER_FIRST') or None, 'lastName': env('TESTER_LAST') or None},
        'relationships': {'betaGroups': {'data': [{'type': 'betaGroups', 'id': gid}]}}}})
print(f'Invited {email}. Apple emails the invitation as soon as the build is cleared for testing'
      + (' (beta review, usually within a day).' if state != 'BETA_APPROVED' else '.'))
