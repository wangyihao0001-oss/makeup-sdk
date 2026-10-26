#!/usr/bin/env bash
set -euo pipefail

: "${ALIYUN_HOST:?ALIYUN_HOST is required}"
: "${ALIYUN_USER:?ALIYUN_USER is required}"
: "${ALIYUN_WORKDIR:?ALIYUN_WORKDIR is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${MAKEUP_SDK_VERSION:-$(cat "${ROOT}/VERSION")}"
RUN_ID="${GITHUB_RUN_ID:-manual}-${GITHUB_SHA:-local}"
REMOTE_DIR="${ALIYUN_WORKDIR%/}/ci/${RUN_ID}"

ssh "${ALIYUN_USER}@${ALIYUN_HOST}" "rm -rf '${REMOTE_DIR}' && mkdir -p '${REMOTE_DIR}'"
tar -C "${ROOT}" --exclude=.git --exclude=build --exclude=build-native \
  --exclude=build-wasm --exclude=release --exclude='._*' -cf - . \
  | ssh "${ALIYUN_USER}@${ALIYUN_HOST}" "tar -C '${REMOTE_DIR}' -xf -"

ssh "${ALIYUN_USER}@${ALIYUN_HOST}" "
  set -euo pipefail
  cd '${REMOTE_DIR}'
  printf '%s\n' '${VERSION}' > VERSION
  cmake -S . -B build-native -DCMAKE_BUILD_TYPE=Release
  cmake --build build-native -j2
  ctest --test-dir build-native --output-on-failure
  emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
  cmake --build build-wasm -j2
  ctest --test-dir build-wasm --output-on-failure
  npm --prefix bindings/miniprogram test
  npm --prefix bindings/miniprogram run build:assets-manifest
  mkdir -p release
  cp bindings/miniprogram/dist/makeup_sdk_core.wasm release/makeup_sdk_core-${VERSION}.wasm
  cp bindings/miniprogram/dist/manifest.json release/makeup_sdk_core-${VERSION}.manifest.json
  cp bindings/miniprogram/dist/openmakeup-assets.manifest.json release/makeup_sdk_assets-${VERSION}.manifest.json
  (cd bindings/miniprogram && npm version '${VERSION}' --no-git-tag-version --allow-same-version)
  (cd bindings/miniprogram && npm pack --pack-destination '../../release' >/dev/null)
  package_file=\"\$(find release -maxdepth 1 -name 'wangyihao0001-makeup-sdk-miniprogram-*.tgz' -type f -print -quit)\"
  mv \"\${package_file}\" release/makeup-sdk-miniprogram-${VERSION}.tgz
  cmake --build build-native --target makeup_sdk_core_benchmark
  build-native/makeup_sdk_core_benchmark > release/native-benchmark.json
  node scripts/benchmark-wasm.mjs > release/wasm-benchmark.json
  sha256sum release/* > release/SHA256SUMS-linux
"

mkdir -p "${ROOT}/release/aliyun"
ssh "${ALIYUN_USER}@${ALIYUN_HOST}" "tar -C '${REMOTE_DIR}/release' -cf - ." \
  | tar -C "${ROOT}/release/aliyun" -xf -
ssh "${ALIYUN_USER}@${ALIYUN_HOST}" "rm -rf '${REMOTE_DIR}'"
