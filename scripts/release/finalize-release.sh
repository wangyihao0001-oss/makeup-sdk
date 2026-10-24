#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${MAKEUP_SDK_VERSION:-$(cat "${ROOT}/VERSION")}"
RELEASE_DIR="${ROOT}/release"

mkdir -p "${RELEASE_DIR}"
find "${RELEASE_DIR}" -maxdepth 1 -type f -name 'SHA256SUMS*' -delete
cp "${RELEASE_DIR}/aliyun/makeup-sdk-android-${VERSION}.aar" "${RELEASE_DIR}/"
cp "${RELEASE_DIR}/aliyun/makeup-sdk-android-${VERSION}.pom" "${RELEASE_DIR}/"
cp "${RELEASE_DIR}/aliyun/makeup_sdk_core-${VERSION}.wasm" "${RELEASE_DIR}/"
cp "${RELEASE_DIR}/aliyun/makeup_sdk_core-${VERSION}.manifest.json" "${RELEASE_DIR}/"
cp "${RELEASE_DIR}/aliyun/makeup-sdk-miniprogram-${VERSION}.tgz" "${RELEASE_DIR}/"
cp "${RELEASE_DIR}/ios/MakeupSDK-${VERSION}.xcframework.zip" "${RELEASE_DIR}/"

MAKEUP_SDK_VERSION="${VERSION}" node "${ROOT}/scripts/release/generate-release-reports.mjs"
(cd "${RELEASE_DIR}" && sha256sum \
  "makeup-sdk-android-${VERSION}.aar" \
  "makeup-sdk-android-${VERSION}.pom" \
  "MakeupSDK-${VERSION}.xcframework.zip" \
  "makeup-sdk-miniprogram-${VERSION}.tgz" \
  "makeup_sdk_core-${VERSION}.wasm" \
  "makeup_sdk_core-${VERSION}.manifest.json" \
  "compatibility-${VERSION}.json" \
  "performance-${VERSION}.json" \
  > SHA256SUMS)
