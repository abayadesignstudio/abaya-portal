#!/usr/bin/env python3
"""App Store Connect setup for CI signing (runs on GitHub's Mac; no device needed).

1. Registers the app and widget bundle IDs.
2. Stops with a clear message if the app record doesn't exist yet in App Store Connect.
3. Creates a fresh Apple Distribution certificate (removing earlier CI ones; Apple allows only a few),
   imports it into the build keychain.
4. Creates App Store provisioning profiles for both targets and installs them.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, KEYCHAIN (name), KEYCHAIN_PW, WORK (temp dir)
"""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
import jwt  # PyJWT

API = 'https://api.appstoreconnect.apple.com/v1'
APP_ID, WIDGET_ID, WIDGETS_ID = 'org.lotmstudy.app', 'org.lotmstudy.app.share', 'org.lotmstudy.app.widgets'
PROFILES = {APP_ID: 'LOTM CI App', WIDGET_ID: 'LOTM CI Share', WIDGETS_ID: 'LOTM CI Widgets'}
CERT_CN = 'LOTM CI'
WORK = os.environ['WORK']


def token():
    key = open(os.environ['ASC_KEY_PATH']).read()
    now = int(time.time())
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'},
                      key, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})


TOKEN = token()


def call(method, path, body=None):
    req = urllib.request.Request(API + path if path.startswith('/') else path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f'App Store Connect {method} {path} failed: {e.code} {e.read().decode()[:800]}')


def sh(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw).stdout


# 1. Bundle IDs
ids = {}
for ident, name in ((APP_ID, 'Life of the Mind'), (WIDGET_ID, 'Life of the Mind Share'), (WIDGETS_ID, 'Life of the Mind Widgets')):
    found = [b for b in call('GET', f'/bundleIds?filter[identifier]={ident}&limit=200')['data'] if b['attributes']['identifier'] == ident]
    if found:
        ids[ident] = found[0]['id']
    else:
        ids[ident] = call('POST', '/bundleIds', {'data': {'type': 'bundleIds', 'attributes': {'identifier': ident, 'name': name, 'platform': 'IOS'}}})['data']['id']
        print(f'Registered bundle ID {ident}')

# 1b. Push notifications on the app's ID (the profiles made below then carry the push entitlement)
caps = call('GET', f"/bundleIds/{ids[APP_ID]}/bundleIdCapabilities")['data']
if not any(c['attributes'].get('capabilityType') == 'PUSH_NOTIFICATIONS' for c in caps):
    call('POST', '/bundleIdCapabilities', {'data': {'type': 'bundleIdCapabilities', 'attributes': {'capabilityType': 'PUSH_NOTIFICATIONS'},
        'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': ids[APP_ID]}}}}})
    print('Turned on push notifications for', APP_ID)

# 2. App record
if not call('GET', f'/apps?filter[bundleId]={APP_ID}')['data']:
    print('::error::The app record does not exist yet. In App Store Connect: Apps → + → New App, '
          f'platform iOS, bundle ID {APP_ID}. Then re-run this workflow.')
    sys.exit(1)

# 3. Distribution certificate — revoke earlier CI ones (only the Distribution type; uploaded builds are unaffected)
# Apple allows only a few; keep the newest and revoke older ones only when near the limit
# (each revocation sends the account holder an email — harmless, but noisy).
certs = sorted(call('GET', '/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200')['data'],
               key=lambda c: c['attributes'].get('expirationDate') or '')
for c in certs[:max(0, len(certs) - 1)]:
    call('DELETE', f"/certificates/{c['id']}")
    print('Revoked an older CI distribution certificate')
key, csr = f'{WORK}/dist.key', f'{WORK}/dist.csr'
sh('/usr/bin/openssl', 'genrsa', '-out', key, '2048')
sh('/usr/bin/openssl', 'req', '-new', '-key', key, '-out', csr, '-subj', f'/CN={CERT_CN}')
cert = call('POST', '/certificates', {'data': {'type': 'certificates', 'attributes': {'certificateType': 'DISTRIBUTION', 'csrContent': open(csr).read()}}})['data']
open(f'{WORK}/dist.cer', 'wb').write(base64.b64decode(cert['attributes']['certificateContent']))
sh('/usr/bin/openssl', 'x509', '-inform', 'DER', '-in', f'{WORK}/dist.cer', '-out', f'{WORK}/dist.pem')
sh('/usr/bin/openssl', 'pkcs12', '-export', '-inkey', key, '-in', f'{WORK}/dist.pem', '-out', f'{WORK}/dist.p12', '-passout', 'pass:ci')
kc, kcpw = os.environ['KEYCHAIN'], os.environ['KEYCHAIN_PW']
sh('security', 'import', f'{WORK}/dist.p12', '-k', kc, '-P', 'ci', '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
sh('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', kcpw, kc)
os.remove(key)
print('Installed distribution certificate')

# 4. Provisioning profiles
dirs = [os.path.expanduser('~/Library/MobileDevice/Provisioning Profiles'),
        os.path.expanduser('~/Library/Developer/Xcode/UserData/Provisioning Profiles')]
for d in dirs:
    os.makedirs(d, exist_ok=True)
existing = call('GET', '/profiles?limit=200')['data']
for ident, pname in PROFILES.items():
    for p in existing:
        if p['attributes']['name'] == pname:
            call('DELETE', f"/profiles/{p['id']}")
    prof = call('POST', '/profiles', {'data': {'type': 'profiles', 'attributes': {'name': pname, 'profileType': 'IOS_APP_STORE'},
        'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': ids[ident]}},
                          'certificates': {'data': [{'type': 'certificates', 'id': cert['id']}]}}}})['data']
    content = base64.b64decode(prof['attributes']['profileContent'])
    for d in dirs:
        open(f"{d}/{prof['attributes']['uuid']}.mobileprovision", 'wb').write(content)
    print(f'Installed profile "{pname}"')
