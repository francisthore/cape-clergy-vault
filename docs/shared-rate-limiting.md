# Shared abuse protection and proxy boundary

Phase 4 replaces the custom auth Map and Better Auth public-handler memory limiter
with one PostgreSQL fixed-window implementation. The allowlisted application auth
handler owns the public route; internal Better Auth API calls are not alternate
public endpoints. The existing settings test reservation stays as an additional
transactional business safeguard, not a competing process-local limiter.

`app.consume_rate_limit` uses fixed server-reviewed purposes, an indexed expiry,
atomic counter update and a short namespace advisory lock. Cleanup deletes at most
500 expired ephemeral buckets per call; active cardinality is capped at 50,000, then
fails closed with bounded retry. No credentials/mailboxes/IPs enter the table: keys
are purpose plus HMAC-SHA256 using the shared protected auth secret. All instances
must use the same secret. Rotating it starts a new limiter namespace; plan rotation
as a controlled security operation. Runtime has only EXECUTE, no table CRUD. Scanner
and notification roles have neither. Lost DB access returns service unavailable,
never an in-memory bypass. This serial short DB operation suits a small installation;
load/lock/connection budgets must be measured on staging.

| Purpose                            | Window / allowance | Enforcement                                                                                                             |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Public auth                        | 60s / 120          | per verified socket-client address (all allowlisted auth requests)                                                      |
| Login                              | 60s / 20           | per client and separately per normalized mailbox, independent of account existence                                      |
| Registration                       | 60s / 10           | per client before registration                                                                                          |
| Verification resend/reset request  | 60s / 1            | per operation + normalized mailbox; generic response independent of eligibility; global client auth budget also applies |
| Reset completion                   | 60s / 10           | per client                                                                                                              |
| Invitation inspect/accept          | 60s / 10           | per client and live authenticated identity; general mutation budget also applies                                        |
| Approval/review/settings mutations | 60s / 60           | per client and independently verified authenticated identity                                                            |
| Test email                         | 60s / 1            | per client and identity plus existing SQL recent-test reservation                                                       |
| PDF upload                         | 600s / 20          | after valid header/account preflight, before reservation/stream I/O; per client and identity                            |
| Repository search                  | 60s / 120          | per client and identity before expensive repository query                                                               |

Each successful consume commits separately, so failed business transactions cannot
roll back their abuse count. Denials return 429 with no-store and Retry-After bounded
to 1–600 seconds. Mail denial depends on request history, never mailbox existence;
normal auth responses remain non-enumerating. Expired windows recover automatically.
Repeated blocked attempts saturate the counter and do not extend the window. Safe
`security.rate_limited` logs contain only purpose and random correlation ID. No
password/token, recipient, peer address or raw provider error is logged.

## Trusted proxy contract

Default `CAPE_TRUSTED_PROXY_IPS` is empty: forwarded headers are ignored. The peer
comes from server adapter metadata, not browser input. IPv4-mapped IPv6 and IPv6
representations are canonicalized. An exact configured peer may supply exactly one
syntactically valid X-Forwarded-For address. Missing/invalid/multi-hop forwarding
shares `invalid-proxy`; absent peer metadata shares `unknown-peer`. X-Real-IP and
Forwarded never identify a client. Invalid proxy configuration fails closed.
No CIDR, wildcard, CDN or multi-proxy chain is implicitly supported.

Proposed single local Nginx: Node binds 127.0.0.1, configure explicit trusted peer
127.0.0.1, and **overwrite** X-Forwarded-For with `$remote_addr`, clearing other
forwarding identity headers. Do not append attacker input using
`$proxy_add_x_forwarded_for`. Block direct public Node access through approved bind/
network isolation. Local processes inside the trusted proxy boundary are trusted;
this is not protection against a compromised proxy/host. See inactive `ops/` template.
[Official Nginx proxy header documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)
supports header replacement; the exact trust policy here is an application design.

Unit tests cover forged/untrusted/absent peers, invalid chains, canonicalization and
retry bounds. Restricted DB tests prove concurrent and two-process sharing and expiry;
Phase 3A proves restart persistence. Built Node smoke checks the actual adapter peer
path. Browser acceptance checks throttling across contexts, forged headers and expiry.
Actual Nginx/TLS/firewall and load acceptance remain Not tested until staging exists.
Disposable database integration fixtures advance only their own HMAC-namespaced bucket timestamps between
independent scenarios; denial/expiry assertions remain in the dedicated limiter suites.

The built Node adapter was inspected locally: its IP getter uses the socket address
with the default `trustProxy` disabled. Keep that adapter setting disabled; enabling a
second framework-level forwarding trust policy would invalidate this application's
peer-boundary assumption and requires a fresh review. The application configuration
is the sole reviewed forwarding trust policy. This is included in staging review.
