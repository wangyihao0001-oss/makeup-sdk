#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${MAKEUP_SDK_VERSION:-$(cat "${ROOT}/VERSION")}"
ANDROID_HOME="${ANDROID_HOME:-${HOME}/android-sdk}"
GRADLE_BIN="${GRADLE_BIN:-gradle}"
if ! command -v "${GRADLE_BIN}" >/dev/null 2>&1 && [ -x "${HOME}/gradle-8.7/bin/gradle" ]; then
  GRADLE_BIN="${HOME}/gradle-8.7/bin/gradle"
fi

export ANDROID_HOME
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

"${GRADLE_BIN}" -p "${ROOT}/bindings/android" --no-daemon \
  clean :library:assembleRelease :library:generatePomFileForReleasePublication \
  -PsdkVersion="${VERSION}"

mkdir -p "${ROOT}/release"
cp "${ROOT}/bindings/android/library/build/outputs/aar/library-release.aar" \
  "${ROOT}/release/makeup-sdk-android-${VERSION}.aar"
cp "${ROOT}/bindings/android/library/build/publications/release/pom-default.xml" \
  "${ROOT}/release/makeup-sdk-android-${VERSION}.pom"
unzip -l "${ROOT}/release/makeup-sdk-android-${VERSION}.aar" \
  > "${ROOT}/release/makeup-sdk-android-${VERSION}.aar.contents.txt"
