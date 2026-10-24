#!/usr/bin/env bash
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${HOME}/android-sdk}"
GRADLE_VERSION="${GRADLE_VERSION:-8.7}"
CMDLINE_TOOLS_VERSION="${CMDLINE_TOOLS_VERSION:-11076708}"
CMDLINE_TOOLS_URL="${CMDLINE_TOOLS_URL:-https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip}"
GRADLE_URL="${GRADLE_URL:-https://mirrors.cloud.tencent.com/gradle/gradle-${GRADLE_VERSION}-bin.zip}"

sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk unzip curl ninja-build

mkdir -p "${ANDROID_HOME}/cmdline-tools"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
curl -fsSL "${CMDLINE_TOOLS_URL}" -o "${tmp_dir}/commandline-tools.zip"
rm -rf "${ANDROID_HOME}/cmdline-tools/latest"
mkdir -p "${ANDROID_HOME}/cmdline-tools/latest"
unzip -q "${tmp_dir}/commandline-tools.zip" -d "${tmp_dir}/cmdline-tools"
mv "${tmp_dir}/cmdline-tools/cmdline-tools"/* "${ANDROID_HOME}/cmdline-tools/latest/"

export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"
yes | sdkmanager --licenses >/dev/null || true
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.2.12479018"

if ! command -v gradle >/dev/null 2>&1; then
  gradle_dir="${HOME}/gradle-${GRADLE_VERSION}"
  if [ ! -x "${gradle_dir}/bin/gradle" ]; then
    curl -fsSL "${GRADLE_URL}" -o "${tmp_dir}/gradle.zip"
    unzip -q "${tmp_dir}/gradle.zip" -d "${HOME}"
  fi
  ln -sfn "${gradle_dir}/bin/gradle" "${HOME}/bin-gradle"
  export PATH="${gradle_dir}/bin:${PATH}"
fi

echo "ANDROID_HOME=${ANDROID_HOME}"
java -version
gradle --version | sed -n '1,8p'
sdkmanager --list_installed | sed -n '1,20p'
