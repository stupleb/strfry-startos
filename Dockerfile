FROM docker.io/library/alpine:3.24 AS build

RUN apk add --no-cache \
    linux-headers \
    git \
    g++ \
    make \
    patch \
    perl \
    pkgconfig \
    libtool \
    ca-certificates \
    openssl-dev \
    zlib-dev \
    lmdb-dev \
    flatbuffers-dev \
    libsecp256k1-dev \
    zstd-dev

WORKDIR /build
COPY ./strfry .
# patches/README.md says what each patch fixes and when it retires; --fuzz=0 makes a stale one fail the build
COPY ./patches ./patches
RUN set -e; for p in ./patches/*.patch; do [ -e "$p" ] || continue; echo "applying $p"; patch -p1 --fuzz=0 <"$p"; done
# strfry stamps `git describe --tags` into its binary, and the submodule's git metadata is outside the build context
RUN version="$(head -n1 CHANGES)" \
    && echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    && rm -rf .git \
    && git init -q \
    && git -c user.name=build -c user.email=build@localhost commit -q --allow-empty -m "$version" \
    && git tag "$version"
RUN make -j"$(nproc)" \
    && strip strfry

FROM docker.io/library/alpine:3.24

RUN apk add --no-cache \
    lmdb \
    flatbuffers \
    libsecp256k1 \
    libb2 \
    zstd-libs \
    libssl3 \
    jq \
    && adduser -D -H -u 1000 strfry

COPY --from=build /build/strfry /usr/local/bin/strfry

USER strfry
ENTRYPOINT ["/usr/local/bin/strfry"]
CMD ["relay"]
