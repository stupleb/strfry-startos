# AGENTS.md

This is a StartOS service-package repository — it builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`,
which provides the packaging guide and agent context one level up. If you're reading this in a
bare clone with no workspace, the full guide is at <https://docs.start9.com/packaging>.

- Change strfry's settings in `writeConfig` / `writePolicy` (`startos/utils.ts`), not with a file model for `strfry.conf`: both files are rewritten in full on every init and start.
- Don't run Import from Relay's `strfry sync` through `exec`: in strfry 1.1.3 it never exits after a relay answers with a NOTICE, and only the streamed log shows that happened.
- `make` compiles strfry from source for each architecture; on Apple silicon the x86_64 build runs under emulation and takes much longer than the arm64 one.
- Run strfry's database commands through `withStrfry`, never a fresh `SubContainer`: LMDB registers readers by PID, and a second subcontainer's PID namespace collides with the relay's (`mdb_txn_begin: Resource temporarily unavailable`).
- Feed `strfry import` from a file, not `exec`'s `input`: import aborts on an oversized line, and the SDK then reports only `write EPIPE`.
- Check out submodules recursively (`git submodule update --init --recursive`): strfry's own submodules carry its dependencies, and the Docker build has no network fallback for them.
- Pass the write policy's key lists to `jq` as files (`--slurpfile`), never as arguments: Linux caps one argument at 128 KiB, about 1,700 keys, and strfry then rejects every client event.
- `signup/state.json` has one writer, `strfry-signup`: change memberships through its loopback admin API (`signup/admin.go`), never by writing the file from package code.
- Build and vet `signup/` in a `golang:1.27-alpine` container (`docker run --rm -v "$PWD/signup":/src -w /src golang:1.27-alpine go vet ./...`); the Dockerfile builds it the same way.
