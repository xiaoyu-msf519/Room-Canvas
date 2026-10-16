#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p verification
printf 'RoomCanvas verification: %s\n' "$(date -u +%FT%TZ)"
xcodebuild -version
plutil -lint RoomCanvas/Info.plist RoomCanvas/PrivacyInfo.xcprivacy RoomCanvas.xcodeproj/project.pbxproj
xcodebuild -project RoomCanvas.xcodeproj -scheme RoomCanvas -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build > verification/device-build.log 2>&1 || {
    tail -100 verification/device-build.log
    exit 1
}
printf '\nDevice SDK build succeeded.\n'
if [[ "${1:-}" == "--test" ]]; then
    if [[ -z "${ROOMCANVAS_SIMULATOR_ID:-}" ]]; then
        printf 'Set ROOMCANVAS_SIMULATOR_ID to an available iOS simulator UDID.\n'
        xcrun simctl list devices available
        exit 2
    fi
    xcodebuild -project RoomCanvas.xcodeproj -scheme RoomCanvas -configuration Debug \
        -destination "platform=iOS Simulator,id=$ROOMCANVAS_SIMULATOR_ID" \
        -resultBundlePath "verification/Tests-$(date +%s).xcresult" \
        CODE_SIGNING_ALLOWED=NO test > verification/tests.log 2>&1 || {
        tail -100 verification/tests.log
        exit 1
    }
    printf 'XCTest succeeded.\n'
fi
