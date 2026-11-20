# Updating the upstream version

strfry is built from source via the `strfry/` git submodule (see `.gitmodules`), with the patches in `patches/` applied on top; the submodule commit is its version pin, and the manifest has no `dockerTag`. The sign-up service, `strfry-signup`, is built from the `strfry-signup/` git submodule, pinned the same way. The `Dockerfile` also pins its Alpine and Go base images.

## Determining the upstream version

- **strfry** (`hoytech/strfry`, https://github.com/hoytech/strfry). Releases are tags without a `v` prefix, cut from its `release` branch; `master` and `ghcr.io/hoytech/strfry:latest` carry unreleased code.
  ```bash
  gh api repos/hoytech/strfry/tags --jq '.[0].name'
  ```
  Compare against the commit currently checked out in the `strfry/` submodule:
  ```bash
  git -C strfry describe --tags --exact-match HEAD
  ```
- **strfry-signup** (`stupleb/strfry-signup`, https://github.com/stupleb/strfry-signup). Releases are tags `v<major>.<minor>.<patch>`.
  ```bash
  git -C strfry-signup fetch --tags && git -C strfry-signup tag --sort=-v:refname | head -n1
  git -C strfry-signup describe --tags --exact-match HEAD
  ```
- **Alpine** (`docker.io/library/alpine:<minor>`, both strfry stages): the latest stable release.
  ```bash
  curl -s https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml | awk '/^ *version:/{print $2; exit}'
  ```
- **Go** (`docker.io/library/golang:<minor>-alpine`, the `signup` stage): the latest release.
  ```bash
  curl -s 'https://go.dev/dl/?mode=json' | jq -r '.[0].version'
  ```

## Applying the bump

- **strfry**: advance the submodule to the new tag, bring its own submodules along, and stage the gitlink:
  ```bash
  git -C strfry fetch --tags
  git -C strfry checkout <new version>
  git -C strfry submodule update --init --recursive
  git add strfry
  ```
  The build takes the version strfry reports from the first line of the tag's `CHANGES`, and fails if that line is not a version number.
- **strfry-signup**: advance the submodule to the new tag and stage the gitlink:
  ```bash
  git -C strfry-signup checkout <new tag>
  git add strfry-signup
  ```
  `startos/main.ts` sets its environment variables, **Edit Paid Member** calls its admin API, and the package reads `members` from its `state.json`: check the release for changes to any of them.
- **Alpine**: change both `alpine:<minor>` tags together. A new minor can rename the runtime libraries the last stage installs; the build fails if one is gone.
- **Go**: change the `golang:<minor>-alpine` tag. It must be at least the `go` line in `strfry-signup/go.mod`, or the build fails.
- **Carried patches**: re-validate everything in `patches/` against the new tag.
  - Check each patch's **Retire when** condition in [patches/README.md](patches/README.md). A patch the release includes is deleted, along with its README section, not re-applied.
  - The Dockerfile applies what remains with `patch -p1 --fuzz=0`, so a patch whose context the bump changed fails the build. Re-derive it against the new tag, or retire it; never loosen `--fuzz`.
- **Config keys**: read the release's `CHANGES` entry for keys added to `strfry.conf`. `writeConfig` in `startos/utils.ts` writes the whole file, so a new key keeps its compiled-in default until the package sets it. An entry that raises the database version needs an export and re-import, which strfry refuses to do on its own.
