#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${MAKEUP_SDK_VERSION:-$(cat "${ROOT}/VERSION")}"
RELEASE_DIR="${ROOT}/release"
mkdir -p "${RELEASE_DIR}"

if [ -f "${ROOT}/bindings/miniprogram/dist/makeup_sdk_core.wasm" ]; then
  cp "${ROOT}/bindings/miniprogram/dist/makeup_sdk_core.wasm" \
    "${RELEASE_DIR}/makeup_sdk_core-${VERSION}.wasm"
  cp "${ROOT}/bindings/miniprogram/dist/manifest.json" \
    "${RELEASE_DIR}/makeup_sdk_core-${VERSION}.manifest.json"
  cp "${ROOT}/bindings/miniprogram/dist/openmakeup-assets.manifest.json" \
    "${RELEASE_DIR}/makeup_sdk_assets-${VERSION}.manifest.json"
fi

(cd "${ROOT}/bindings/miniprogram" && npm pack \
  --pack-destination "${RELEASE_DIR}") >/dev/null
package_file="$(find "${RELEASE_DIR}" -maxdepth 1 -name 'wangyihao0001-makeup-sdk-miniprogram-*.tgz' -type f -print -quit)"
test -n "${package_file}"
mv "${package_file}" "${RELEASE_DIR}/makeup-sdk-miniprogram-${VERSION}.tgz"

(cd "${RELEASE_DIR}" && sha256sum \
  "makeup-sdk-miniprogram-${VERSION}.tgz" \
  "makeup_sdk_core-${VERSION}.wasm" \
  "makeup_sdk_core-${VERSION}.manifest.json" \
  "makeup_sdk_assets-${VERSION}.manifest.json" \
  > SHA256SUMS)
