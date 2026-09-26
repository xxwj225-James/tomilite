// ═══ Phase verification — "should this request skip the system proxy?" ═══
//
//   npx tsx scripts/test-proxy.mts
//
// Exercises `bypassesProxy()` in `apps/api/src/agent/utils/proxy.ts`. Follows the
// conventions of `scripts/test-fts.mts` and `scripts/test-import-mime.mts`: `check`
// wrapping one assertion, helpers that record instead of throwing, a non-zero exit at the
// end.
//
// ─── Why the registry is not read here ───
//
// `systemProxy()` spawns `reg query` against the *machine's* configuration, so asserting
// on it would assert on whoever is running the test — it would pass on a machine with no
// proxy and fail on one with. The decision function underneath is pure and takes the
// bypass list as an argument, so the rules are pinned here against Windows' own defaults
// and the cases its syntax is easy to get wrong. `DEFAULT_BYPASS` below is the literal
// value read off this development machine (`ProxyOverride`), not an invented one.
//
// ─── What is worth asserting, and why ───
//
// The proxy value itself was never the bug — `ProxyEnable` being ignored was, and that
// lives one level up in `systemProxy()`. What is tested here is the host matching, which
// is the part that silently sends a request somewhere it must not go: `10.*` matching
// `100.0.0.1`, an entry with regex metacharacters in it being compiled as a pattern, or
// `<local>` swallowing a public hostname. Each of those is a wrong answer that produces
// no error at all — just a request that goes through a proxy it should have skipped.
import { bypassesProxy, parseRegistryDump, proxyFromRegistry } from '../apps/api/src/agent/utils/proxy.ts';

/**
 * A `reg query` dump of the Internet Settings key, with the shape taken from a real one
 * (this machine's) and the address replaced. What matters is what it *contains*: the
 * key's header, a long list of subkey paths, and unrelated value types — `REG_BINARY`,
 * `REG_QWORD` — that a value matcher has to walk past. There is also an unrelated entry
 * named `MigrateProxy` that a prefix match would catch if the regex were not anchored.
 */
const REG_DUMP = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  '    CertificateRevocation    REG_DWORD    0x1',
  '    User Agent    REG_SZ    Mozilla/4.0 (compatible; MSIE 8.0; Win32)',
  '    ProxyEnable    REG_DWORD    0x0',
  '    MigrateProxy    REG_DWORD    0x1',
  '    ZonesSecurityUpgrade    REG_BINARY    41B627C891DDDC01',
  '    ProxyServer    REG_SZ    10.20.30.40:8080',
  '    ProxyOverride    REG_SZ    LocalHost;10.*;<local>',
  '    LockDatabase    REG_QWORD    0x1dbfa3f89c221fb',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\5.0',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Zones',
  '',
].join('\r\n');

/** `ProxyOverride` as read from HKCU on the development machine — Windows' default. */
const DEFAULT_BYPASS = [
  'localhost',
  '127.*',
  '192.168.*',
  '10.*',
  '172.16.*',
  '172.17.*',
  '172.18.*',
  '172.19.*',
  '172.20.*',
  '172.21.*',
  '172.22.*',
  '172.23.*',
  '172.24.*',
  '172.25.*',
  '172.26.*',
  '172.27.*',
  '172.28.*',
  '172.29.*',
  '172.30.*',
  '172.31.*',
  '<local>',
];

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(`${name} — ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  FAIL ${name}`);
  }
}

function eq(actual: unknown, expected: unknown, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const bypass = (url: string, list: string[] = DEFAULT_BYPASS) => bypassesProxy(url, list);

// ─── The regression: ProxyEnable off, ProxyServer still set ───
//
// This is the whole reason the module was rewritten. Windows clears `ProxyEnable` when
// the user turns the proxy off but leaves `ProxyServer` in the registry, so any code that
// asks "is there a ProxyServer value?" answers yes forever. The stale address then takes
// every web_search to a port with nothing behind it.

check('the dump parses the three values out of the surrounding noise', () => {
  const reg = parseRegistryDump(REG_DUMP);
  eq(reg.enable, '0x0', 'ProxyEnable:');
  eq(reg.server, '10.20.30.40:8080', 'ProxyServer:');
  eq(reg.override, 'LocalHost;10.*;<local>', 'ProxyOverride:');
});
check('`MigrateProxy` is not mistaken for `ProxyEnable`', () => eq(parseRegistryDump(REG_DUMP).enable, '0x0'));
check('a `REG_BINARY` value does not swallow the next line', () =>
  eq(parseRegistryDump(REG_DUMP).server, '10.20.30.40:8080'));
check('an absent ProxyOverride is an empty list, not an error', () =>
  eq(proxyFromRegistry({ enable: '0x1', server: '10.20.30.40:8080' }).bypass.length, 0));

check('ProxyEnable=0 with an address still set means NO proxy', () => {
  const p = proxyFromRegistry(parseRegistryDump(REG_DUMP));
  eq(p.enabled, false, 'enabled:');
  eq(p.url, undefined, 'url:');
});
check('the bypass list is read even while the proxy is off', () =>
  eq(proxyFromRegistry(parseRegistryDump(REG_DUMP)).bypass.join(';'), 'localhost;10.*;<local>'));
check('ProxyEnable=1 with an address means that proxy', () => {
  const p = proxyFromRegistry({ enable: '0x1', server: '10.20.30.40:8080' });
  eq(p.enabled, true, 'enabled:');
  eq(p.url, 'http://10.20.30.40:8080', 'url:');
});
check('a missing ProxyEnable reads as off', () => {
  eq(proxyFromRegistry({ server: '10.20.30.40:8080' }).enabled, false);
  eq(proxyFromRegistry({}).enabled, false);
});
check('`ProxyEnable` may also arrive as a bare `1`', () =>
  eq(proxyFromRegistry({ enable: '1', server: '10.20.30.40:8080' }).url, 'http://10.20.30.40:8080'));
check('a per-scheme address resolves to the one this app can speak', () => {
  eq(proxyFromRegistry({ enable: '0x1', server: 'http=1.2.3.4:80;https=5.6.7.8:443' }).url, 'http://5.6.7.8:443');
  eq(proxyFromRegistry({ enable: '0x1', server: 'http=1.2.3.4:80' }).url, 'http://1.2.3.4:80');
});
check('a socks-only address resolves to no proxy rather than a broken one', () => {
  eq(proxyFromRegistry({ enable: '0x1', server: 'socks=1.2.3.4:1080' }).url, undefined);
  eq(proxyFromRegistry({ enable: '0x1', server: '' }).url, undefined);
});

// ─── The default list, as Windows intends it ───

check('a public host is not bypassed', () => eq(bypass('https://www.bing.com/search?q=x'), false));
check('`localhost` is bypassed', () => eq(bypass('http://localhost:3000/issues'), true));
check('loopback IPs are bypassed', () => eq(bypass('http://127.0.0.1:3192/api'), true));
check('`127.*` covers the whole /8', () => eq(bypass('http://127.9.9.9/'), true));
check('IPv6 loopback is bypassed', () => eq(bypass('http://[::1]:8080/'), true));
check('a private LAN host is bypassed', () => eq(bypass('http://192.168.1.50/redmine'), true));
check('`10.*` is bypassed', () => eq(bypass('http://10.1.2.3/'), true));
check('`172.16.*`..`172.31.*` are bypassed', () => {
  eq(bypass('http://172.16.0.1/'), true);
  eq(bypass('http://172.31.255.254/'), true);
});
check('`172.32.x` is outside the private range and is proxied', () => eq(bypass('http://172.32.0.1/'), false));
check('an intranet name with no dot is bypassed', () => eq(bypass('http://tomi/'), true));

// ─── The cases the syntax invites getting wrong ───

check('`10.*` does not match `100.0.0.1`', () => eq(bypass('http://100.0.0.1/'), false));
check('`<local>` does not match a public hostname', () => eq(bypass('http://example.com/'), false));
// `*` is "any characters", not "any label" — so `10.*` does reach `10.example.com`, the
// same way Windows' own wildcard does. Asserted rather than assumed, because the
// alternative (a label-aware wildcard) is the kind of cleverness that changes behaviour
// nobody asked to change.
check('a trailing `*` spans dots, as Windows\' wildcard does', () => eq(bypass('http://10.example.com/'), true));
// The entry is passed alone on purpose: against the default list, a host written without
// dots is caught by `<local>` for an unrelated reason, which would hide whether the
// escaping works. `192a168b1c1.d` has a dot, so `<local>` cannot answer for it, and an
// unescaped `192.168.*` would match it as `192`+any+`168`+any+anything.
check('a `.` in an entry is a literal, not "any character"', () => {
  eq(bypass('http://192a168b1c1.d/', ['192.168.*']), false);
  eq(bypass('http://192.168.1.1/', ['192.168.*']), true);
});
check('a `+` in an entry is a literal, not a quantifier', () => {
  eq(bypass('http://a+b.example.com/', ['a+b.example.com']), true);
  eq(bypass('http://aab.example.com/', ['a+b.example.com']), false);
  eq(bypass('http://aaab.example.com/', ['a+b.example.com']), false);
});

// ─── Entries without a wildcard cover subdomains ───

check('`example.com` covers its subdomains', () => {
  eq(bypass('http://example.com/', ['example.com']), true);
  eq(bypass('http://api.example.com/', ['example.com']), true);
});
check('`example.com` does not cover `notexample.com`', () => eq(bypass('http://notexample.com/', ['example.com']), false));
check('`*.example.com` requires the subdomain', () => {
  eq(bypass('http://api.example.com/', ['*.example.com']), true);
  eq(bypass('http://example.com/', ['*.example.com']), false);
});

// ─── Ports ───

check('an entry with a port is bypassed on that port only', () => {
  eq(bypass('http://example.com:8080/', ['example.com:8080']), true);
  eq(bypass('http://example.com:9090/', ['example.com:8080']), false);
});
check('an entry with the default port matches the URL without one', () => {
  eq(bypass('http://example.com/', ['example.com:80']), true);
  eq(bypass('https://example.com/', ['example.com:443']), true);
  eq(bypass('http://example.com/', ['example.com:443']), false);
});
check('an entry without a port matches every port', () => eq(bypass('http://example.com:8080/', ['example.com']), true));

// ─── Degenerate input ───

check('an empty bypass list still leaves loopback alone', () => {
  eq(bypass('http://localhost/', []), true);
  eq(bypass('https://www.bing.com/', []), false);
});
check('entries are matched case-insensitively', () => eq(bypass('http://API.Example.COM/', ['example.com']), true));
check('blank entries are ignored', () => eq(bypass('https://www.bing.com/', ['', '  ']), false));
check('an unparseable target is not bypassed', () => {
  eq(bypass('not a url', ['example.com']), false);
  eq(bypass('', ['example.com']), false);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
