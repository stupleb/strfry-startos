# Updating the upstream version

strfry is built from source via the `strfry/` git submodule (see `.gitmodules`), with the patches in `patches/` applied on top; the submodule commit is its version pin, and the manifest has no `dockerTag`. The `Dockerfile` also pins its Alpine and Go base images, and `signup/go.mod` pins the sign-up service's one Go module.

## Determining the upstream version

- **strfry** (`hoytech/strfry`, https://github.com/hoytech/strfry). Releases are tags without a `v` prefix, cut from its `release` branch; `master` and `ghcr.io/hoytech/strfry:latest` carry unreleased code.
  ```bash
  gh api repos/hoytech/strfry/tags --jq '.[0].name'
  ```
  Compare against the commit currently checked out in the `strfry/` submodule:
  ```bash
  git -C strfry describe --tags --exact-match HEAD
  ```
- **Alpine** (`docker.io/library/alpine:<minor>`, both strfry stages): the latest stable release.
  ```bash
  curl -s https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml | awk '/^ *version:/{print $2; exit}'
  ```
- **Go** (`docker.io/library/golang:<minor>-alpine`, the `signup` stage): the latest release.
  ```bash
  curl -s 'https://go.dev/dl/?mode=json' | jq -r '.[0].version'
  ```
- **Go modules** (`signup/go.mod`):
  ```bash
  docker run --rm -v "$PWD/signup":/src -w /src golang:<minor>-alpine go list -m -u all
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
- **Alpine**: change both `alpine:<minor>` tags together. A new minor can rename the runtime libraries the last stage installs; the build fails if one is gone.
- **Go**: change the `golang:<minor>-alpine` tag, the `go` line in `signup/go.mod`, and the vet command in `AGENTS.md` together.
- **Go modules**: `go get <module>@<version> && go mod tidy` in the same container, then commit `go.mod` and `go.sum`.
- **Carried patches**: re-validate everything in `patches/` against the new tag.
  - Check each patch's **Retire when** condition in [patches/README.md](patches/README.md). A patch the release includes is deleted, along with its README section, not re-applied.
  - The Dockerfile applies what remains with `patch -p1 --fuzz=0`, so a patch whose context the bump changed fails the build. Re-derive it against the new tag, or retire it; never loosen `--fuzz`.
- **Config keys**: read the release's `CHANGES` entry for keys added to `strfry.conf`. `writeConfig` in `startos/utils.ts` writes the whole file, so a new key keeps its compiled-in default until the package sets it. An entry that raises the database version needs an export and re-import, which strfry refuses to do on its own.
