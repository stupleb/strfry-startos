<p align="center">
  <img src="icon.svg" alt="strfry Logo" width="21%">
</p>

# strfry on StartOS

> Everything not listed in this document should behave the same as upstream
> strfry. If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable — see the Documentation section of
> `instructions.md` for links.

[strfry](https://github.com/hoytech/strfry) is a Nostr relay that stores events in LMDB and syncs with other relays over negentropy. This package runs the relay, owns its configuration, gates publishing through a pubkey list, and adds actions for relay information, importing and deleting events.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

The package builds its own image from strfry's source.

| Item          | Value                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image         | Built by the package's `Dockerfile` on Alpine from the `strfry` git submodule (an upstream release tag), with the upstream fixes in `patches/` applied |
| Architectures | x86_64, aarch64                                                                                                                                        |
| User          | `strfry` (uid 1000)                                                                                                                                    |
| Command       | `strfry --config=/etc/strfry/strfry.conf relay`, after raising the open-file limit to the container's hard limit                                       |
| Extra tools   | `jq`, which runs the write policy                                                                                                                      |

Subcontainers: `strfry-sub` runs the relay. The import and delete actions run their `strfry` commands inside `strfry-sub` while the relay runs, and in a short-lived subcontainer named after the action (`import-relay`, `import-pubkey`, `delete-events`) while it is stopped. LMDB tells its processes apart by PID, so a second subcontainer, with its own PID namespace, cannot open the database while the relay has it open.

## Volume and Data Layout

Two volumes: the event database and the package's own files.

| Volume    | Mount point               | Contents                                                                                                                |
| --------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `main`    | `/data`                   | The LMDB database: `data.mdb` and `lock.mdb`, owned by uid 1000                                                         |
| `startos` | `/etc/strfry` (read-only) | Subpath `etc/`: the generated `strfry.conf` and `write-policy`. `store.json` sits at the volume root and is not mounted |

The LMDB map size is the upstream default on x86_64 and 256 GiB on aarch64, because Raspberry Pi kernels cannot map the 10 TB default. It caps the database size on aarch64.

## File Models

`store.json` is the only file the user's choices live in; the package regenerates strfry's own files from it.

- **`store.json`** (JSON, volume `startos`): the relay URL choice, the NIP-11 info, the write mode, the allowed pubkeys (hex) and the old-events toggle. Seeded with defaults at install and merged on every init; written only by actions. A hand edit to a field survives, but a malformed `allowedPubkeys` entry empties the whole list.
- **`etc/strfry.conf`** (JSON, which strfry's config format accepts): rewritten in full on every init and every start. Database path, map size, bind address, port, `nofiles = 0`, `realIpHeader = x-forwarded-for`, NIP-42 `serviceUrl`, NIP-11 info, write-policy path and event age limit are set from `store.json` and the relay URL; every other key is strfry's compiled-in default. A hand edit is lost at the next start.
- **`etc/write-policy`** (shell script): a `jq` filter with the allowed pubkeys inlined. Rewritten whenever `store.json` changes, while the relay runs; strfry reloads a plugin whose file modification time changes, so a new list applies to the next event without a restart.

The write policy accepts an event when it arrived from a client (`sourceType` `IP4`/`IP6`) and its author is on the list, or, in inbox mode, when any `p` tag names a listed pubkey. Events written by the import actions (`Sync`, `Import`) are always accepted.

## Dependencies

None.

## Network Access and Interfaces

One interface, `relay` (`api`), bound to port 7777 with the `ws` protocol: StartOS terminates TLS and proxies plain HTTP and websocket to strfry. The same port serves the NIP-11 document (`Accept: application/nostr+json`), strfry's HTML landing page, and `/metrics` (Prometheus text), which strfry cannot turn off.

strfry reads the client address from the `X-Forwarded-For` header StartOS adds, so logs and the write policy see the real client IP.

The import actions open outbound websocket connections from the server to the relay the user names.

## Installation and First-Run Flow

The relay starts at install in whitelist mode with an empty list, so it stores nothing published by clients until **Write Access** lists at least one pubkey. Anyone can read from it at any time.

The relay URL defaults to the interface's preferred address (a public domain, else the `.local` address) until **Set Relay URL** stores one. NIP-42 authentication only succeeds for clients that connected through that URL's host and port. The package carries two upstream NIP-42 fixes no release includes yet: strfry PR #183 ignores scheme, path, trailing slash and case in the relay tag, and PR #201 answers a failed login with `OK false` instead of a NOTICE.

## Actions

Configuration actions, then actions that change the database.

- **Write Access** — choose open, whitelist or inbox mode, edit the pubkey list (npub or hex, stored as hex), and allow events up to 20 years old instead of 3. A list change applies to the next event; a mode or age change restarts strfry. Safe to repeat.
- **Relay Info** — the NIP-11 fields clients display. The admin pubkey is stored as hex. Restarts strfry. Safe to repeat.
- **Set Relay URL** — picks the address written to strfry's NIP-42 `serviceUrl`. Restarts strfry. Safe to repeat.
- **Import Public Key** — fetches one pubkey's events (and, optionally, events tagging it) from any relay with plain `REQ`s, 500 at a time going back in time, then writes them with `strfry import`, which skips the write policy and the age limit. Events of 64 KiB or more (the relay's own size limit), such as notes tagging thousands of pubkeys, are left out and counted in the result. Its duration depends on the remote relay; each page waits at most two minutes. A remote that caps or truncates history returns fewer events than exist. Safe to repeat: stored events are skipped.
- **Import from Relay** — `strfry sync --dir=down` (negentropy) against a relay that supports it, optionally with a filter. Ignores the age limit for the events it copies. Stops when the remote answers with a NOTICE, after three minutes without progress, or after an hour; a repeat run resumes, since negentropy transfers only what is missing. Most public relays refuse it, strfry ones included ("negentropy disabled"); it is for relays the user runs or that advertise negentropy.
- **Delete Events** — `strfry delete` by author (npub or hex) and/or event ID (`note1`, `nevent1` or hex). Preview (on by default) only counts. Destructive and immediate; an author still allowed by Write Access can publish the events again.

Each import and delete action reports the number of events stored before and after, counted with `strfry scan --count`, which reads the whole index on a large database. A strfry restart while one of them runs (a Write Access mode change, Relay Info, Set Relay URL) ends it; events already written stay.

## Tasks

Two tasks, both `important`, neither blocking startup.

- **Write Access** — raised while the mode is whitelist or inbox and the pubkey list is empty, including at install. Cleared when the list gains a pubkey or the mode becomes open; returns if the list is emptied again.
- **Set Relay URL** — raised while no relay URL is stored, or the stored one is no longer an address of the interface. Cleared by choosing an address, or when the stored address comes back.

## Health Checks

One check, **Relay**, passes once strfry listens on port 7777. For the first 10 seconds after a start, a failure shows as starting.

A failure after that means strfry exited: its log shows why. Typical causes are a database whose version this strfry refuses ("Database version too old/too new"), an LMDB map that cannot be allocated, or a disk that is full.

## Backups and Restore

Both volumes are copied whole (`ofVolumes('startos', 'main')`) with strfry stopped, so the LMDB files are consistent. A restore puts back the database, the settings and the pubkey list; the next start regenerates `strfry.conf` and the write policy from them. A restore can give the relay new ports; the stored relay URL follows its hostname to the new port, so NIP-42 keeps working, but clients configured with the old LAN address need the new one. Restoring onto a server of the other architecture is untested: LMDB files record the page size of the machine that created them.

## Limitations and Differences

1. Reads are never restricted: anyone who can reach the relay can read every stored event, whatever the write mode.
2. NIP-42 AUTH succeeds only on the chosen relay URL's host and port; a client on another address (`.onion`, `.local`) cannot authenticate, so it cannot publish protected (NIP-70) events.
3. The import actions reach relays on the clearnet only; `.onion` relays are not reachable.
4. The write policy matches pubkeys only; it has no rate limiting or content filtering.
5. Every strfry setting not listed under File Models stays at its compiled-in default, and the `strfry router` mirroring daemon is not run.
6. On aarch64 the database cannot grow past 256 GiB.

---

## Quick Reference for AI Consumers

```yaml
package_id: strfry
image: built from Dockerfile (strfry submodule, hoytech/strfry)
architectures: [x86_64, aarch64]
subcontainers: [strfry-sub, import-relay, import-pubkey, delete-events]
volumes:
  main: /data
  startos: /etc/strfry (subpath etc, read-only)
file_models:
  - startos/store.json
  - startos/etc/strfry.conf (generated)
  - startos/etc/write-policy (generated)
startos_managed_env_vars: []
dependencies: none
interfaces:
  relay: { type: api, port: 7777 }
actions:
  - write-access
  - relay-info
  - set-relay-url
  - import-pubkey
  - import-relay
  - delete-events
tasks:
  - { action: write-access, severity: important }
  - { action: set-relay-url, severity: important }
health_checks:
  - primary
```
