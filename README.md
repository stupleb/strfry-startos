<p align="center">
  <img src="icon.svg" alt="strfry Logo" width="21%">
</p>

# strfry on StartOS

> Everything not listed in this document should behave the same as upstream
> strfry. If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable — see the Documentation section of
> `instructions.md` for links.

[strfry](https://github.com/hoytech/strfry) is a Nostr relay that stores events in LMDB and syncs with other relays over negentropy. This package runs the relay, owns its configuration, gates publishing through a pubkey list, can sell write access through its own sign-up page, and adds actions for relay information, importing and deleting events.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Sign-up Service](#sign-up-service)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

The package builds its own image from strfry's source.

| Item          | Value                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image         | Built by the package's `Dockerfile` on Alpine from the `strfry` git submodule (an upstream release tag), with the carried patches in `patches/` applied |
| Architectures | x86_64, aarch64                                                                                                                                         |
| User          | `strfry` (uid 1000)                                                                                                                                     |
| Command       | `strfry --config=/etc/strfry/strfry.conf relay`, after raising the open-file limit to the container's hard limit                                        |
| Extra tools   | `jq`, which runs the write policy; `strfry-signup`, the package's own sign-up service, built from the `strfry-signup/` submodule                        |

Subcontainers: `strfry-sub` runs the relay, and `signup-sub` runs `strfry-signup` while **Paid Access** is on. The import and delete actions run their `strfry` commands inside `strfry-sub` while the relay runs, and in a short-lived subcontainer named after the action (`import-relay`, `import-pubkey`, `delete-events`) while it is stopped. LMDB tells its processes apart by PID, so a second subcontainer, with its own PID namespace, cannot open the database while the relay has it open.

## Volume and Data Layout

Two volumes: the event database and the package's own files.

| Volume    | Mount point                         | Contents                                                                                                                                                                                  |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`    | `/data`                             | The LMDB database: `data.mdb` and `lock.mdb`, owned by uid 1000                                                                                                                           |
| `startos` | `/etc/strfry` (read-only)           | Subpath `etc/`: the generated `strfry.conf`, `write-policy`, `allowed.json` and `blocked.json`, in `strfry-sub` and `signup-sub`. `store.json` sits at the volume root and is not mounted |
| `startos` | `/var/lib/signup` (in `signup-sub`) | Subpath `signup/`: `state.json`, the sign-up service's members and invoices, owned by uid 1000                                                                                            |

The LMDB map size is the upstream default on x86_64 and 256 GiB on aarch64, because Raspberry Pi kernels cannot map the 10 TB default. It caps the database size on aarch64.

## File Models

`store.json` is the only file the user's choices live in; the package regenerates strfry's own files from it.

- **`store.json`** (JSON, volume `startos`): the relay URL choice, the NIP-11 info, the write mode, the allowed and blocked pubkeys (hex), the old-events toggle, and `payments`: the backend (`off`, `lnbits`, `btcpay`), its address (empty for the one on this server) and Root CA, its credentials, the price in sats and the days one payment buys (0: permanent). Seeded with defaults at install and merged on every init; written only by actions. A hand edit to a field survives, but a malformed `allowedPubkeys` or `blockedPubkeys` entry empties that whole list.
- **`signup/state.json`** (JSON, volume `startos`): written only by `strfry-signup`, atomically. `members` maps a hex pubkey to `until` (Unix seconds, or `null` for permanent) and `since`; `invoices` holds each invoice's pubkey, payment details and status; a paid invoice is dropped a day after its expiry time, an expired one an hour after. The operator's edits reach it through `strfry-signup`'s admin API. The package reads `members` only; a malformed entry drops every member from the write policy rather than letting anyone in.
- **`etc/strfry.conf`** (JSON, which strfry's config format accepts): rewritten in full on every init and every start. Database path, map size, bind address and port (`0.0.0.0:7777`, or `127.0.0.1:7778` while Paid Access is on), `nofiles = 0`, `realIpHeader = x-forwarded-for`, NIP-42 `serviceUrl`, NIP-11 info, write-policy path and event age limit are set from `store.json` and the relay URL. NIP-11 also carries `limitation.restricted_writes`, false only in open mode, and, while access is for sale, `payments_url` (`/join` on the relay URL, over `https`, or `http` for a `ws://` URL) and `fees` (a `subscription`, or an `admission` for permanent access, in msats); these three keys come from carried patch 0003. Every other key is strfry's compiled-in default. A hand edit is lost at the next start.
- **`etc/write-policy`** (shell script): runs a `jq` filter that loads `allowed.json` and `blocked.json` at start. Rewritten, after both lists, whenever `store.json` or `signup/state.json` changes, while the relay runs; strfry restarts a plugin whose file modification time changes, so a new list applies to the next event without restarting strfry.
- **`etc/allowed.json`** (JSON object): `listed`, the Write Access list, and `paid`, the paid members whose access has not run out, each keyed by hex pubkey (`true`, or a paid member's `until`).
- **`etc/blocked.json`** (JSON object keyed by hex pubkey): the blocked list. `strfry-signup` rereads it at most every 2 seconds and sells nothing to those keys.

The write policy accepts every event the import actions write (`sourceType` `Sync`, `Import`). An event from a client (`IP4`/`IP6`) is refused if its author is blocked; otherwise it is accepted in open mode, or when its author is listed or a paid member whose `until` is in the future (compared with `jq`'s `now`, so expiry needs no rewrite), or, in inbox mode, when any `p` tag names a listed pubkey. A paid member can publish but is not an inbox: an event tagging one is held to the same test as any other. A refusal while access is for sale says `restricted: pay for write access at <relay URL>/join`, over `https`. With open mode and no blocked keys, strfry runs no plugin.

## Dependencies

Optional, and only one at a time: **LNbits** or **BTCPay Server**, required running, with its `primary` (LNbits) or `btcpay` (BTCPay Server) health check passing, while **Paid Access** uses that backend on **This server**. The package reaches it on its bridge address (host `main`, internal port 5000 or 23000). A backend elsewhere, given by URL, is no dependency.

## Network Access and Interfaces

One interface, `relay` (`api`), bound to port 7777 with the `ws` protocol: StartOS terminates TLS and proxies plain HTTP and websocket to it. The same port serves the NIP-11 document (`Accept: application/nostr+json`), strfry's HTML landing page, and `/metrics` (Prometheus text), which strfry cannot turn off.

While **Paid Access** is on, `strfry-signup` answers on port 7777 and strfry moves to `127.0.0.1:7778`, reachable only through it. `strfry-signup` serves the sign-up page and its API under `/join/`, redirects a browser's `GET /` there, and hands every other request to strfry: websockets, NIP-11, `/metrics` and any other path. The sign-up page needs no interface or domain of its own.

strfry reads the client address from the `X-Forwarded-For` header StartOS adds, so logs and the write policy see the real client IP. While Paid Access is on, `strfry-signup` passes strfry the client address it counts for its own limits: the header's last entry when the request comes from StartOS's proxy (`sdk.getOsIp`, passed in `SIGNUP_TRUSTED_PROXIES`), the connecting address otherwise.

The import actions open outbound websocket connections from the server to the relay the user names, and the Paid Access action and `strfry-signup` open HTTP(S) connections to the payment backend.

## Installation and First-Run Flow

The relay starts at install in whitelist mode with an empty list, so it stores nothing published by clients until **Write Access** lists at least one pubkey. Anyone can read from it at any time.

The relay URL defaults to the interface's preferred address (a public domain, else the `.local` address) until **Set Relay URL** stores one. NIP-42 authentication only succeeds for clients that connected through that URL's host and port. The package carries two upstream NIP-42 fixes no release includes yet: strfry PR #183 ignores scheme, path, trailing slash and case in the relay tag, and PR #201 answers a failed login with `OK false` instead of a NOTICE.

## Sign-up Service

`strfry-signup` (Go, the `strfry-signup/` submodule; [stupleb/strfry-signup](https://github.com/stupleb/strfry-signup) documents the program in full) serves the page and a small JSON API under `/join/` on port 7777, in front of strfry (see Network Access and Interfaces). Its settings, payment credentials included, arrive as environment variables (`SIGNUP_*`, `RELAY_*`) set from `store.json` and the relay URL at each start, so **Configure Paid Access**, **Relay Info** and **Write Access** mode changes restart it.

- `GET /join/`: the page, an HTML template with the relay's name, description, icon, URL, terms, privacy link, contact and price. `app.js` and `app.css` are served beside it; the content security policy allows only same-origin scripts, styles and requests, plus `https:` and `data:` images.
- `GET /join/api/member/{npub or hex}`: whether the key is a member, until when, whether it is blocked, and its npub.
- `POST /join/api/invoice` `{"pubkey"}`: an invoice for the price, with QR codes as `data:` PNGs. A key with an unpaid invoice that has over two minutes left gets that invoice again. Limits: per client, 10 requests per 10 minutes, repeats for an open invoice included, and 3 unexpired unpaid invoices at once; 100 unexpired unpaid invoices in all, counting those still being created; none for a key that already has permanent access or is blocked. A client is its address as passed to strfry (see Network Access and Interfaces), a public IPv6 one counted by its /56; Tor visitors all arrive from the Tor service's address and count as one client.
- `POST /join/api/invoice/{id}/onchain`: BTCPay only. Activates the invoice's on-chain payment method, deriving its address, the first time the visitor opens the **On-chain** tab.
- `GET /join/api/invoice/{id}`: the invoice's status: `pending`, `processing` (BTCPay has seen an on-chain payment), `paid` (with `until`) or `expired`.
- `GET /healthz`: answered only to direct loopback requests; checks the backend credentials, cached for 30 seconds.

A second listener on `127.0.0.1:8081`, which no interface binds, takes the operator's edits from **Edit Paid Member**: `PUT /member/{hex}` `{"until": <Unix seconds or null>}` sets a key's access, adding it if it has never paid, and `DELETE /member/{hex}` removes it, answering 404 for a key that is not a member.

Invoices last 15 minutes. A poller asks the backend about each open invoice every 3 seconds while a page is asking for its status, every 30 seconds otherwise, every minute once it has expired or is waiting for confirmations, and gives up 10 minutes after expiry (48 hours for a `processing` one), or 24 hours after expiry while the backend keeps returning errors. A payment credits the key: `until` becomes the later of now and the current `until`, plus the period in force when the invoice was created. LNbits invoices come from `POST /api/v1/payments` with the wallet's invoice key; BTCPay invoices are created in `SATS` with `checkout.expirationMinutes = 15`, and their `BTC-LN` payment method is activated at once; `BTC-CHAIN` waits for the visitor to ask for it, so unpaid invoices do not derive wallet addresses (a store without Lightning gets it at once). `Settled` counts as paid; `Expired` and `Invalid` as expired. Requests to the backend never follow redirects.

A Root CA stored with a remote backend is passed in `SIGNUP_ROOT_CA` and trusted alongside the public roots.

The page, its messages, the API's errors and the invoice memo are in English, Spanish, German, Polish or French: the language picked in the menu under the page's footer (`?lang=`), else the browser's, else English. The relay's name and description appear as entered.

The page takes no payment while the write mode is open, and shows that payments are unavailable when the backend has no address (a local one not installed).

## Actions

StartOS shows them in three sections: **Relay** for the first three, **Paid Access** for the next three and **Events** for the rest.

- **Write Access** — choose open, whitelist or inbox mode, edit the pubkey list and the blocked list (npub or hex, stored as hex), and allow events up to 20 years old instead of 3. A list change applies to the next event; a mode or age change, or the blocked list going from empty to not or back, restarts strfry. Safe to repeat.
- **Relay Info** — the NIP-11 fields clients display. The admin pubkey is stored as hex. Restarts strfry. Safe to repeat.
- **Set Relay URL** — picks the address written to strfry's NIP-42 `serviceUrl`, which, with `/join` added, is also the sign-up page address in the refusal message and NIP-11 `payments_url`. Restarts strfry. Safe to repeat.
- **Configure Paid Access** — sets the backend, where it runs, its credentials, the price and the access one payment buys. LNbits credits every payment to the one wallet whose key is given. A `.local` backend address is refused, since `.local` names do not resolve inside service containers. Before saving it checks the credentials against the backend: an LNbits key must open the wallet and be refused an outgoing payment (an Admin key is rejected), and a BTCPay key must hold `btcpay.store.cancreateinvoice` and `btcpay.store.canviewinvoices`, each scoped to that store (an unscoped, all-store key is refused), and nothing else (the `btcpay.server.*lightninginvoiceinternalnode` pair is refused), and must be able to list the store's invoices. On saving, the result names where payments go: the LNbits wallet's name, which LNbits returns to an invoice key, or the BTCPay store ID. Off clears the stored credentials. Restarts strfry and the sign-up service. Safe to repeat.
- **Paid Members** — lists members, newest first, as npubs with their expiry, or Blocked for a key in Blocked Public Keys. Read-only.
- **Edit Paid Member** — for one pubkey (npub or hex): set its expiry to the end of a chosen day (UTC) or make it permanent, which adds a key that has never paid, remove the membership, or ban it (remove, then add it to Blocked Public Keys, which restarts strfry if that list was empty). Ban also takes a key that is not a member. An invoice the key had open and pays after a removal credits it again.
- **Import from Public Key** — fetches one pubkey's events (and, optionally, events tagging it in a `p` tag and zap receipts naming it in a `P` tag, which between them cover the zaps it received and sent; a sent zap is found only where the recipient's zap server added the `P` tag) from any relay with plain `REQ`s, 500 at a time going back in time, then writes them with `strfry import`, which skips the write policy and the age limit. Events of 64 KiB or more (the relay's own size limit), such as notes tagging thousands of pubkeys, are left out and counted in the result. Its duration depends on the remote relay; each page waits at most two minutes. A remote that caps or truncates history returns fewer events than exist. Safe to repeat: stored events are skipped.
- **Import from Relay** — `strfry sync --dir=down` (negentropy) against a relay that supports it, optionally with a filter. Ignores the age limit for the events it copies. Stops when the remote answers with a NOTICE, after three minutes without progress, or after an hour; a repeat run resumes, since negentropy transfers only what is missing. Most public relays refuse it, strfry ones included ("negentropy disabled"); it is for relays the user runs or that advertise negentropy.
- **Delete Events** — `strfry delete` by author (npub or hex) and/or event ID (`note1`, `nevent1` or hex). Preview (on by default) only counts. Destructive and immediate; an author still allowed by Write Access can publish the events again.

Each import and delete action reports the number of events stored before and after, counted with `strfry scan --count`, which reads the whole index on a large database. A strfry restart while one of them runs (a Write Access mode change, Relay Info, Set Relay URL) ends it; events already written stay.

## Tasks

Two tasks, both `important`, neither blocking startup.

- **Write Access** — raised while the mode is whitelist or inbox, the pubkey list is empty and Paid Access is off, including at install. Cleared when the list gains a pubkey, the mode becomes open or Paid Access is turned on; returns if none of those holds again.
- **Set Relay URL** — raised while no relay URL is stored, or the stored one is no longer an address of the interface. Cleared by choosing an address, or when the stored address comes back.

## Health Checks

**Relay** passes once strfry listens on port 7777, or 7778 while Paid Access is on. Then **Sign-up Page** passes once `strfry-signup` listens on port 7777, and **Payments** passes while the backend accepts the credentials (`/healthz`); its failure message carries the backend's answer, or "no payment backend address" when a local backend is not installed. For the first 10 seconds after a start, a failure shows as starting.

A **Relay** failure after that means strfry exited: its log shows why. Typical causes are a database whose version this strfry refuses ("Database version too old/too new"), an LMDB map that cannot be allocated, or a disk that is full.

While Paid Access is on, strfry listens only behind `strfry-signup`, so a failing **Sign-up Page** check means no client can reach the relay either; the service log shows why `strfry-signup` stopped. A failing **Payments** check stops new sign-ups and leaves the relay and existing members working: start the backend, or run **Configure Paid Access** again if the backend refuses the credentials. It checks every 30 seconds, so it can show starting for about half a minute after a start, and turns green within half a minute of a fix.

## Backups and Restore

Both volumes are copied whole (`ofVolumes('startos', 'main')`) with strfry stopped, so the LMDB files are consistent. A restore puts back the database, the settings, the pubkey lists, the payment backend credentials and the paid members; the next start regenerates `strfry.conf` and the write policy from them. A restore can give the relay new ports; the stored relay URL follows its hostname to the new port, so NIP-42 keeps working, but clients configured with the old LAN address need the new one. Restoring onto a server of the other architecture is untested: LMDB files record the page size of the machine that created them.

## Limitations and Differences

What the relay and its sign-up page do not do, and where they differ from a stock strfry.

1. NIP-42 AUTH succeeds only on the chosen relay URL's host and port; a client on another address (`.onion`, `.local`) cannot authenticate, so it cannot publish protected (NIP-70) events.
2. The import actions reach relays on the clearnet only; `.onion` relays are not reachable.
3. The write policy matches pubkeys only; it has no rate limiting or content filtering.
4. Every strfry setting not listed under File Models stays at its compiled-in default, and the `strfry router` mirroring daemon is not run.
5. On aarch64 the database cannot grow past 256 GiB.
6. Prices are in sats only, and there are no refunds or partial payments: an underpaid or late BTCPay invoice is left to the operator, who can settle it in BTCPay and then grant the key with **Edit Paid Member**.
7. A BTCPay invoice buys access once BTCPay marks it `Settled`.
8. Paid members are tracked by the package, not by LNbits or BTCPay Server: restoring the backend alone does not restore memberships.

---

## Quick Reference for AI Consumers

```yaml
package_id: strfry
image: built from Dockerfile (strfry submodule, hoytech/strfry)
architectures: [x86_64, aarch64]
subcontainers:
  [strfry-sub, signup-sub, import-relay, import-pubkey, delete-events]
volumes:
  main: /data
  startos: /etc/strfry (subpath etc, read-only); /var/lib/signup in signup-sub (subpath signup)
file_models:
  - startos/store.json
  - startos/etc/strfry.conf (generated)
  - startos/etc/write-policy (generated)
  - startos/etc/allowed.json (generated)
  - startos/etc/blocked.json (generated)
  - startos/signup/state.json (written by strfry-signup)
startos_managed_env_vars:
  - SIGNUP_* (strfry-signup settings and payment credentials)
  - RELAY_* (relay info shown on the sign-up page)
dependencies: [lnbits (optional), btcpayserver (optional)]
interfaces:
  relay: { type: api, port: 7777 }
actions:
  - write-access
  - relay-info
  - set-relay-url
  - paid-access
  - paid-members
  - edit-paid-member
  - import-pubkey
  - import-relay
  - delete-events
tasks:
  - { action: write-access, severity: important }
  - { action: set-relay-url, severity: important }
health_checks:
  - primary
  - signup
  - payments
```
