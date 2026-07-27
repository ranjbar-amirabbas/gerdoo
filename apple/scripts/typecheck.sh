#!/usr/bin/env bash
#
# Type-checks every target against the SDK it actually ships on, without Xcode.
#
# `swift test` covers the ported logic but builds for macOS, so it never sees
# the UIKit, WatchKit, WidgetKit or ActivityKit paths. This does: it builds
# GerdooKit once per platform, then type-checks each app and extension against
# it. It needs only the toolchain — no simulator runtimes, and no
# `xcodebuild -runFirstLaunch`, which a fresh machine has often not had.
#
#   apple/scripts/typecheck.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

kit=()
while IFS= read -r file; do kit+=("$file"); done < <(find GerdooKit/Sources -name '*.swift')

# platform, sdk, target triple, then the source directories that ship on it
check_platform() {
  local name=$1 sdk=$2 triple=$3
  shift 3

  echo "==> $name ($triple)"
  mkdir -p "$work/$name"
  xcrun -sdk "$sdk" swiftc -target "$triple" -swift-version 5 \
    -emit-module -module-name GerdooKit \
    -emit-module-path "$work/$name/GerdooKit.swiftmodule" "${kit[@]}"

  for dir in "$@"; do
    echo "    $dir"
    # -parse-as-library: these are app targets, and a lone @main file would
    # otherwise be read as a script.
    xcrun -sdk "$sdk" swiftc -target "$triple" -swift-version 5 \
      -parse-as-library -typecheck -I "$work/$name" "$dir"/*.swift
  done
}

check_platform ios iphonesimulator arm64-apple-ios17.0-simulator Gerdoo GerdooWidgets
check_platform watchos watchsimulator arm64-apple-watchos10.0-simulator \
  GerdooWatch GerdooWatchWidgets

echo "All targets type-check."
