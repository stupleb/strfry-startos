# Carried patches

Deltas applied to the `strfry` submodule at build time, in filename order, by the `patch -p1 --fuzz=0` step in the [Dockerfile](../Dockerfile). `--fuzz=0` is deliberate: after a submodule bump, a patch whose context has changed must fail the build, not apply anyway with the mismatch ignored.

0001 and 0002 are upstream's own fixes, merged to strfry's `master` but in no release yet: strfry releases come from its `release` branch. 0003 is the package's own, written to match an open upstream PR.

## 0001 — compare the NIP-42 relay tag by host and port

**Retire when:** the submodule is bumped to a release that contains [hoytech/strfry#183](https://github.com/hoytech/strfry/pull/183) (commits `ecf7f00`, `826bc57`).

strfry 1.1.3 accepts a NIP-42 AUTH only when the event's `relay` tag equals `relay.auth.serviceUrl` character for character. Clients built on nostr-tools, NDK or rust-nostr sign the relay URL as their URL library serializes it, `wss://host:port/`, while the package stores the address without the trailing slash, so their logins fail and they cannot publish protected (NIP-70) events. The patch compares host and port only, lowercased, which accepts both forms.

## 0002 — answer a failed AUTH with OK

**Retire when:** the submodule is bumped to a release that contains [hoytech/strfry#201](https://github.com/hoytech/strfry/pull/201) (commit `813dfec`).

strfry 1.1.3 answers a failed AUTH with a NOTICE, where NIP-42 specifies `["OK", <auth event id>, false, <reason>]`. A client that waits for that OK (nostr-tools' `relay.auth` does) hangs until its own timeout before reporting the failure. The patch sends the OK.

## 0003 — advertise payment in NIP-11

**Retire when:** the submodule is bumped to a release that contains [hoytech/strfry#278](https://github.com/hoytech/strfry/pull/278), or another change that emits `payments_url`, `fees` and `limitation.restricted_writes`.

strfry 1.1.3 and `master` emit none of NIP-11's payment fields. The patch adds the three `relay.info` keys #278 proposes, with its names, types and meanings, and nothing else from it: `paymentsUrl` (emitted as `payments_url`), `fees` (a JSON object, emitted as `fees`, left out with a logged error if it does not parse) and `restrictedWrites` (`"true"`, `"false"`, or empty for true whenever a write policy is set; emitted as `limitation.restricted_writes` in every case). `writeConfig` writes `restrictedWrites` as an explicit `"true"` or `"false"`, never empty, so a release carrying #278 as proposed needs no change beyond deleting the patch.

If upstream lands these keys under other names or types, change `writeConfig` in the commit that retires the patch: strfry refuses to start on a config value of the wrong type (`not a string`), and ignores a key it does not know.
