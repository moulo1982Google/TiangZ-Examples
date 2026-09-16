# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS node_runtime
FROM rust:1.97.1-bookworm AS builder
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends cmake clang libclang-dev \
    && rm -rf /var/lib/apt/lists/*
ENV CARGO_BUILD_JOBS=4
WORKDIR /workspace/TiangZ
COPY engine/ ./
COPY dbproxy-source/ /workspace/TiangZ-DBProxy/
COPY modules/ /workspace/modules/
# 复用正式组合构建器；不手写 Rust bridge，不放宽 Native 指纹。
RUN --mount=type=cache,id=tiangz-battle-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=tiangz-battle-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=tiangz-battle-linux-target,target=/workspace/TiangZ/temp/module-native-target \
    node tools/build_module_native.mjs --modules-dir /workspace/modules --locked
COPY export-binary.mjs /workspace/export-binary.mjs
RUN node /workspace/export-binary.mjs

FROM node_runtime
LABEL io.tiangz.purpose="battle-k8s-local-lab"
WORKDIR /game
COPY --from=builder /output/TiangZ /game/TiangZ
COPY --from=builder /output/build.manifest.json /game/build.manifest.json
COPY dist/ /game/dist/
COPY runtime/ /game/
RUN mkdir /game/configs /game/logs && chown -R node:node /game
USER node
ENTRYPOINT ["node", "/game/entry.mjs"]
