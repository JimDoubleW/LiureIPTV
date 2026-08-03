#!/usr/bin/env bash

set -euo pipefail

show_help() {
    cat <<'EOF'
Usage: build-android.sh [-b] [-i] [-l] [-s] [-a ADDRESS]
                        [--build] [--install] [--launch] [--screenshot]
                        [--address ADDRESS]

Builds the LiureIPTV Android app only with --build. Without --build,
ADB-only actions use the existing installation or APK.

Options:
  -b, --build       Build the Android APK.
  -i, --install     Install the resulting APK with adb -r.
  -l, --launch      Launch the app on the target device with adb.
  -s, --screenshot  Capture a PNG screenshot from the target device with adb.
  -a, --address ADDRESS  Target a specific adb device or emulator.
  -h, --help        Show this help text.
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

java_major_version() {
    local java_bin="$1"
    local version

    version="$("$java_bin" -version 2>&1 | sed -n 's/^.*version "\([0-9][0-9]*\).*$/\1/p' | head -n1)"
    [[ -n "$version" ]] || return 1
    printf '%s\n' "$version"
}

pick_java_home() {
    local candidate
    local java_bin
    local major

    if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
        java_bin="$JAVA_HOME/bin/java"
        major="$(java_major_version "$java_bin" || true)"
        if [[ -n "$major" && "$major" -ge 21 ]]; then
            printf '%s\n' "$JAVA_HOME"
            return 0
        fi
    fi

    for candidate in \
        /usr/lib/jvm/java-21-openjdk-amd64 \
        /usr/lib/jvm/java-21-openjdk \
        /usr/lib/jvm/openjdk-21 \
        /usr/lib/jvm/java-1.21.0-openjdk-amd64 \
    ; do
        if [[ -x "$candidate/bin/java" ]]; then
            java_bin="$candidate/bin/java"
            major="$(java_major_version "$java_bin" || true)"
            if [[ -n "$major" && "$major" -ge 21 ]]; then
                printf '%s\n' "$candidate"
                return 0
            fi
        fi
    done

    return 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"

install_apk=0
launch_app=0
screenshot_app=0
build_app=0
adb_address=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install)
            install_apk=1
            ;;
        --launch)
            launch_app=1
            ;;
        --screenshot)
            screenshot_app=1
            ;;
        --build)
            build_app=1
            ;;
        --address|--serial)
            shift
            [[ $# -gt 0 ]] || die "--address needs a device address"
            adb_address="$1"
            ;;
        -b)
            build_app=1
            ;;
        -i)
            install_apk=1
            ;;
        -l)
            launch_app=1
            ;;
        -s)
            screenshot_app=1
            ;;
        -a)
            shift
            [[ $# -gt 0 ]] || die "-a needs a device address"
            adb_address="$1"
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
    shift
done

if [[ "$build_app" -eq 0 && "$install_apk" -eq 0 && "$launch_app" -eq 0 && "$screenshot_app" -eq 0 ]]; then
    die "no action requested; use --build, --install, --launch, or --screenshot"
fi

if [[ "$build_app" -eq 1 ]]; then
    require_cmd pnpm

    if java_home="$(pick_java_home)"; then
        export JAVA_HOME="$java_home"
        export PATH="$JAVA_HOME/bin:$PATH"
    else
        die "JDK 21 not found; install it or set JAVA_HOME to a Java 21 installation"
    fi

    if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
        if [[ -f "$root_dir/android/local.properties" ]]; then
            sdk_dir="$(sed -n 's/^sdk.dir=//p' "$root_dir/android/local.properties" | head -n1)"
            [[ -n "$sdk_dir" ]] || die "android/local.properties exists but does not define sdk.dir"
            export ANDROID_HOME="$sdk_dir"
            export ANDROID_SDK_ROOT="$sdk_dir"
        else
            die "set ANDROID_HOME or ANDROID_SDK_ROOT, or create android/local.properties with sdk.dir"
        fi
    fi

    export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
fi

if [[ "$install_apk" -eq 1 ]]; then
    require_cmd adb
fi

if [[ "$launch_app" -eq 1 ]]; then
    require_cmd adb
fi

if [[ -n "$adb_address" || "$screenshot_app" -eq 1 ]]; then
    require_cmd adb
fi

run_adb() {
    if [[ -n "$adb_address" ]]; then
        if adb -s "$adb_address" "$@"; then
            return 0
        fi

        echo "ADB target $adb_address was not reachable; trying adb connect..."
        adb connect "$adb_address"
        adb -s "$adb_address" "$@"
    else
        adb "$@"
    fi
}

take_screenshot() {
    local screenshot_path

    screenshot_path="$root_dir/android/screenshot-$(date +%Y%m%d-%H%M%S).png"
    echo "Taking screenshot: $screenshot_path"

    if [[ -n "$adb_address" ]]; then
        if adb -s "$adb_address" exec-out screencap -p > "$screenshot_path"; then
            :
        else
            echo "ADB target $adb_address was not reachable; trying adb connect..."
            adb connect "$adb_address"
            adb -s "$adb_address" exec-out screencap -p > "$screenshot_path"
        fi
    else
        adb exec-out screencap -p > "$screenshot_path"
    fi

    echo "Screenshot saved to $screenshot_path"
}

apk_path="$root_dir/android/app/build/outputs/apk/debug/app-debug.apk"

if [[ "$build_app" -eq 1 ]]; then
    echo "Building web bundle for Android..."
    cd "$root_dir"
    pnpm nx build web --configuration=pwa

    echo "Syncing Capacitor Android project..."
    rm -rf "$root_dir/android/app/src/main/assets/public"
    pnpm exec cap sync android

    echo "Assembling Android debug APK..."
    cd "$root_dir/android"
    ./gradlew -Dorg.gradle.java.home="$JAVA_HOME" assembleDebug

    [[ -f "$apk_path" ]] || die "APK not found at $apk_path"
    echo "APK ready: $apk_path"
else
    echo "Skipping build step."
fi

if [[ "$install_apk" -eq 1 ]]; then
    [[ -f "$apk_path" ]] || die "APK not found at $apk_path; run with --build first"
    echo "Installing APK with adb..."
    run_adb install -r "$apk_path"
    echo "Install complete."
fi

if [[ "$launch_app" -eq 1 ]]; then
    echo "Launching app with adb..."
    run_adb shell monkey -p com.liureiptv.tv -c android.intent.category.LEANBACK_LAUNCHER 1
    echo "Launch requested."
fi

if [[ "$screenshot_app" -eq 1 ]]; then
    if [[ "$launch_app" -eq 1 ]]; then
        sleep 2
    fi
    take_screenshot
fi
