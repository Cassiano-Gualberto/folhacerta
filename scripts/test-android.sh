#!/usr/bin/env bash
set -euo pipefail
SDK="$ANDROID_HOME"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
BUILD=android-test/build
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" -I "$PLATFORM" --manifest android-test/AndroidManifest.xml --java "$BUILD/gen"
find android-test/src "$BUILD/gen" -name '*.java' -print0 | xargs -0 javac --release 8 -classpath "$PLATFORM" -d "$BUILD/classes"
find "$BUILD/classes" -name '*.class' -print0 | xargs -0 "$TOOLS/d8" --lib "$PLATFORM" --min-api 28 --output "$BUILD/dex"
(cd "$BUILD/dex" && zip -q ../unsigned.apk classes.dex)
"$TOOLS/zipalign" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$BUILD/smoke.apk" "$BUILD/aligned.apk"
ADB="$SDK/platform-tools/adb"
"$ADB" wait-for-device
for i in $(seq 1 120); do [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && break; sleep 2; done
"$ADB" shell input keyevent 82
"$ADB" install android/build/FolhaCerta-1.0.0.apk
"$ADB" install "$BUILD/smoke.apk"
"$ADB" shell am instrument -w -r com.folhacerta.smoke/com.folhacerta.smoke.SmokeInstrumentation | tee "$BUILD/result.txt"
rg 'PASS FolhaCerta' "$BUILD/result.txt"
"$ADB" exec-out screencap -p > "$BUILD/android.png"
