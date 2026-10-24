#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VERSION="${MAKEUP_SDK_VERSION:-$(cat "${ROOT}/VERSION")}"
OUT="${ROOT}/release/ios"
rm -rf "${OUT}"
mkdir -p "${OUT}"

cmake -S "${ROOT}/bindings/ios" -B "${OUT}/device" -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphoneos \
  -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build "${OUT}/device" --config Release

cmake -S "${ROOT}/bindings/ios" -B "${OUT}/simulator" -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build "${OUT}/simulator" --config Release

xcodebuild -create-xcframework \
  -library "${OUT}/device/Release-iphoneos/libMakeupSDK.a" \
  -headers "${ROOT}/bindings/ios/include" \
  -library "${OUT}/simulator/Release-iphonesimulator/libMakeupSDK.a" \
  -headers "${ROOT}/bindings/ios/include" \
  -output "${OUT}/MakeupSDK.xcframework"

(cd "${OUT}" && zip -qr "MakeupSDK-${VERSION}.xcframework.zip" MakeupSDK.xcframework)
