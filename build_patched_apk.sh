#!/usr/bin/env bash
# build_patched_apk.sh
# Aplica TODOS los parches a Sticker.ly en un solo paso:
#   1. Premium (subscribed=true)  — bypass Google Play subscription check
#   2. NSC patch                  — permite cert CA de mitmproxy (Android 7+)
# Luego recompila, firma, instala y activa el túnel ADB.
#
# Uso:
#   chmod +x build_patched_apk.sh
#   ./build_patched_apk.sh stickerly.apk
#
# Requisitos: apktool, java, uber-apk-signer.jar, adb (en PATH o misma carpeta)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
APK_IN="${1:-stickerly.apk}"
WORK_DIR="stickerly_decoded"
APK_UNSIGNED="stickerly_patched.apk"
SIGNER_JAR="${UBER_SIGNER:-uber-apk-signer.jar}"
PROXY_PORT=8080

# Smali target — SubscriptionModel field patch
SMALI_TARGET="com/snowcorp/stickerly/android/base/domain/payment/SubscriptionModel.smali"

# ── Checks ────────────────────────────────────────────────────────────────────
check_cmd() { command -v "$1" &>/dev/null || { echo "[ERROR] '$1' no encontrado en PATH"; exit 1; }; }
check_cmd apktool
check_cmd java
check_cmd adb

if [[ ! -f "$SIGNER_JAR" ]]; then
    echo "[ERROR] uber-apk-signer.jar no encontrado."
    echo "  Descarga: https://github.com/patrickfav/uber-apk-signer/releases"
    exit 1
fi

if [[ ! -f "$APK_IN" ]]; then
    echo "[ERROR] APK no encontrado: $APK_IN"
    echo "  Uso: $0 <ruta/al/stickerly.apk>"
    exit 1
fi

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Sticker.ly Full Patch — premium + AI ilimitado    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── PASO 1: Decode ────────────────────────────────────────────────────────────
echo "[1/6] Descompilando APK..."
rm -rf "$WORK_DIR"
apktool d "$APK_IN" -o "$WORK_DIR" --no-res 2>/dev/null \
    || apktool d "$APK_IN" -o "$WORK_DIR"
echo "      OK → $WORK_DIR/"

# ── PASO 2: Premium smali patch ───────────────────────────────────────────────
echo "[2/6] Aplicando parche premium (subscribed=true)..."

SMALI_FILE=$(find "$WORK_DIR/smali"* -path "*/$SMALI_TARGET" 2>/dev/null | head -1)

if [[ -z "$SMALI_FILE" ]]; then
    echo "  [WARN] SubscriptionModel.smali no encontrado — omitiendo parche smali."
    echo "         (puede que el APK ya esté parcheado o la ruta cambió)"
else
    # Reemplaza el getter getSubscribed para que devuelva siempre 1 (true)
    python3 - "$SMALI_FILE" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path, "r") as f:
    src = f.read()

# Encuentra método getSubscribed() y reemplaza el cuerpo
patched = re.sub(
    r'(\.method public getSubscribed\(\)Z\s*\n(?:\s+\..*\n)*?)'
    r'(\s+iget-boolean v\d+, p0, [^\n]+\n\s+return v\d+)',
    r'\1    const/4 v0, 0x1\n    return v0',
    src
)

# Si no hubo match exacto, intento alternativo
if patched == src:
    patched = re.sub(
        r'(\.method public getSubscribed\(\)Z.*?)(iget-boolean (v\d+), p0, \S+\n(\s+)return \3)',
        lambda m: m.group(1) + f'const/4 {m.group(3)}, 0x1\n{m.group(4)}return {m.group(3)}',
        src, flags=re.DOTALL
    )

if patched == src:
    print("  [WARN] No se pudo parchear getSubscribed — verifica manualmente")
else:
    with open(path, "w") as f:
        f.write(patched)
    print(f"  OK → {path}")
PYEOF
fi

# ── PASO 3: NSC patch ─────────────────────────────────────────────────────────
echo "[3/6] Aplicando NSC patch (mitmproxy CA trust)..."

NSC_DIR="$WORK_DIR/res/xml"
NSC_FILE="$NSC_DIR/network_security_config.xml"
NSC_SRC="network_security_config_patch.xml"

if [[ ! -f "$NSC_SRC" ]]; then
    echo "  [WARN] $NSC_SRC no encontrado — generando inline..."
    mkdir -p "$NSC_DIR"
    cat > "$NSC_FILE" <<'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
        </trust-anchors>
    </base-config>
</network-security-config>
XMLEOF
else
    mkdir -p "$NSC_DIR"
    cp "$NSC_SRC" "$NSC_FILE"
fi

# Asegura que AndroidManifest.xml referencia el NSC
MANIFEST="$WORK_DIR/AndroidManifest.xml"
if ! grep -q "networkSecurityConfig" "$MANIFEST"; then
    sed -i 's/<application/<application android:networkSecurityConfig="@xml\/network_security_config"/' "$MANIFEST"
    echo "  OK → networkSecurityConfig añadido a AndroidManifest.xml"
else
    echo "  OK → networkSecurityConfig ya presente"
fi

# ── PASO 4: Build ─────────────────────────────────────────────────────────────
echo "[4/6] Recompilando APK..."
apktool b "$WORK_DIR" -o "$APK_UNSIGNED"
echo "      OK → $APK_UNSIGNED"

# ── PASO 5: Sign ──────────────────────────────────────────────────────────────
echo "[5/6] Firmando APK..."
java -jar "$SIGNER_JAR" -a "$APK_UNSIGNED" --allowResign
SIGNED=$(ls stickerly_patched-aligned-debugSigned.apk 2>/dev/null \
      || ls stickerly_patched*Signed*.apk 2>/dev/null | head -1)
echo "      OK → $SIGNED"

# ── PASO 6: Install + ADB reverse ─────────────────────────────────────────────
echo "[6/6] Instalando en dispositivo..."
adb install -r "$SIGNED" && echo "      OK → APK instalado"

echo ""
echo "Activando túnel ADB (proxy USB)..."
adb reverse "tcp:${PROXY_PORT}" "tcp:${PROXY_PORT}"
adb reverse --list

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Todo listo. Pasos finales:                         ║"
echo "║                                                      ║"
echo "║  1. PC: mitmdump -s stickerly_ai_unlimited.py       ║"
echo "║  2. Teléfono: Wi-Fi proxy → 127.0.0.1:8080         ║"
echo "║  3. Visita http://mitm.it → instala cert CA        ║"
echo "║  4. Abre Sticker.ly → AI → genera                  ║"
echo "╚══════════════════════════════════════════════════════╝"
