# Updating the upstream version

strfry is built from source via the `strfry/` git submodule (see `.gitmodules`), with the patches in `patches/` applied on top. There is no `dockerTag` in the manifest and no version pin in the `Dockerfile`: the submodule commit is the version pin.

## Determining the upstream version

- **strfry** (`hoytech/strfry`, https://github.com/hoytech/strfry). Releases are tags without a `v` prefix, cut from its `release` branch; `master` and `ghcr.io/hoytech/strfry:latest` carry unreleased code.
  ```bash
  gh api repos/hoytech/strfry/tags --jq '.[0].name'
  ```
  Compare against the commit currently checked out in the `strfry/` submodule:
  ```bash
  git -C strfry describe --tags --exact-match HEAD
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
- **Carried patches**: re-validate everything in `patches/` against the new tag.
  - Check each patch's **Retire when** condition in [patches/README.md](patches/README.md). A patch the release includes is deleted, along with its README section, not re-applied.
  - The Dockerfile applies what remains with `patch -p1 --fuzz=0`, so a patch whose context the bump changed fails the build. Re-derive it against the new tag, or retire it; never loosen `--fuzz`.
- **Config keys**: read the release's `CHANGES` entry for keys added to `strfry.conf`. `writeConfig` in `startos/utils.ts` writes the whole file, so a new key keeps its compiled-in default until the package sets it. An entry that raises the database version needs an export and re-import, which strfry refuses to do on its own.
