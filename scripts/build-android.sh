#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${SDK:?Android SDK não encontrado}"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
BUILD="android/build"
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex" "$BUILD/assets/www" "$BUILD/gen" android/res/drawable
cp -R dist/. "$BUILD/assets/www/"
cp icons/icon-192.png android/res/drawable/icon.png
"$TOOLS/aapt2" compile --dir android/res -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" -I "$PLATFORM" --manifest android/AndroidManifest.xml --java "$BUILD/gen" -A "$BUILD/assets" "$BUILD/resources.zip"
find android/src "$BUILD/gen" -name '*.java' -print0 | xargs -0 javac --release 8 -classpath "$PLATFORM" -d "$BUILD/classes"
find "$BUILD/classes" -name '*.class' -print0 | xargs -0 "$TOOLS/d8" --lib "$PLATFORM" --min-api 28 --output "$BUILD/dex"
(cd "$BUILD/dex" && zip -q ../unsigned.apk classes.dex)
"$TOOLS/zipalign" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
mkdir -p "${HOME}/.android"
KEYSTORE="${HOME}/.android/debug.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
 keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$BUILD/FolhaCerta-1.0.0.apk" "$BUILD/aligned.apk"
"$TOOLS/zipalign" -c -p 4 "$BUILD/FolhaCerta-1.0.0.apk"
"$TOOLS/apksigner" verify --verbose --print-certs "$BUILD/FolhaCerta-1.0.0.apk" > "$BUILD/verification.txt"
"$TOOLS/aapt2" dump badging "$BUILD/FolhaCerta-1.0.0.apk" >> "$BUILD/verification.txt"
sha256sum "$BUILD/FolhaCerta-1.0.0.apk" > "$BUILD/SHA256SUMS.txt"
cat "$BUILD/verification.txt"
