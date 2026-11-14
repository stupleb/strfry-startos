# Carried patches

Deltas applied to the `strfry` submodule at build time, in filename order, by the `patch -p1 --fuzz=0` step in the [Dockerfile](../Dockerfile). `--fuzz=0` is deliberate: after a submodule bump, a patch whose context has changed must fail the build, not apply anyway with the mismatch ignored.

Both are upstream's own fixes, merged to strfry's `master` but in no release yet: strfry releases come from its `release` branch.

## 0001 — compare the NIP-42 relay tag by host and port

**Retire when:** the submodule is bumped to a release that contains [hoytech/strfry#183](https://github.com/hoytech/strfry/pull/183) (commits `ecf7f00`, `826bc57`).

strfry 1.1.3 accepts a NIP-42 AUTH only when the event's `relay` tag equals `relay.auth.serviceUrl` character for character. Clients built on nostr-tools, NDK or rust-nostr sign the relay URL as their URL library serializes it, `wss://host:port/`, while the package stores the address without the trailing slash, so their logins fail and they cannot publish protected (NIP-70) events. The patch compares host and port only, lowercased, which accepts both forms.

## 0002 — answer a failed AUTH with OK

**Retire when:** the submodule is bumped to a release that contains [hoytech/strfry#201](https://github.com/hoytech/strfry/pull/201) (commit `813dfec`).

strfry 1.1.3 answers a failed AUTH with a NOTICE, where NIP-42 specifies `["OK", <auth event id>, false, <reason>]`. A client that waits for that OK (nostr-tools' `relay.auth` does) hangs until its own timeout before reporting the failure. The patch sends the OK.
