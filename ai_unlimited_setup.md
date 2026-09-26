# Sticker.ly AI Ilimitado — Guía Completa

Sistema: **mitmproxy + Pollinations.ai** como backend de IA gratuito.

Sticker.ly rechaza la generación con error `13001` ("créditos insuficientes") en su
servidor. Este addon intercepta las peticiones ANTES de que lleguen al servidor y
responde con imágenes generadas por Pollinations.ai (FLUX, gratuito, sin API key).

---

## Cómo funciona

```
   Teléfono                   PC (mitmproxy)              Internet
      │                            │                          │
      │── POST /crafts/prompt ────▶│                          │
      │                            │  parsea craftJson        │
      │                            │  prompt → Pollinations   │
      │◀── craftId=90001 ─────────│  URL construida          │
      │                            │                          │
      │── GET /crafts (poll) ─────▶│                          │
      │◀── {outputUrl: "https://   │                          │
      │      image.pollinations    │                          │
      │      .ai/prompt/..."} ────│                          │
      │                            │                          │
      │── GET image.pollinations.ai/prompt/... ─────────────▶│
      │◀──────── PNG (512×512) ──────────────────────────────│
```

---

## PASO 1 — Instalar mitmproxy en el PC

```bash
pip install mitmproxy
```

Versión mínima: `mitmproxy 8.x`

---

## PASO 2 — Iniciar el proxy

```bash
# Modo terminal (recomendado para uso continuo)
mitmdump -s stickerly_ai_unlimited.py --listen-port 8080

# Modo interactivo (ver tráfico en tiempo real)
mitmproxy -s stickerly_ai_unlimited.py --listen-port 8080
```

Anota la IP local de tu PC (ej. `192.168.1.10`).

---

## PASO 3 — Configurar el proxy en el teléfono

### Opción A — Cable USB (recomendado si tienes depuración USB activa)

Más estable que Wi-Fi: no necesitas conocer la IP del PC ni estar en la misma red.

```bash
# En el PC, con el teléfono conectado por USB
adb reverse tcp:8080 tcp:8080
```

Esto redirige el puerto 8080 del teléfono → puerto 8080 del PC por el cable USB.

Luego en el teléfono:
- **Android → Ajustes → Wi-Fi → (mantén pulsada la red) → Modificar red:**
  - Proxy: **Manual**
  - Host: `127.0.0.1`
  - Puerto: `8080`

> El teléfono cree que el proxy está en sí mismo (`127.0.0.1`),
> pero ADB reenvía el tráfico al PC por USB.

Para verificar que el túnel está activo:
```bash
adb reverse --list
# Debe mostrar: reverse tcp:8080 tcp:8080
```

Para desactivar al terminar:
```bash
adb reverse --remove tcp:8080
```

---

### Opción B — Wi-Fi (sin cable)

**Android → Ajustes → Wi-Fi → (mantén pulsada la red) → Modificar red:**
- Proxy: **Manual**
- Host: `192.168.1.10` (IP de tu PC en la red local)
- Puerto: `8080`

---

## PASO 4 — Instalar el certificado CA de mitmproxy

Android 7+ no confía en certificados de usuario para las apps.
Hay dos opciones (elige según si tienes root):

### Opción A — Sin root: parche en el APK (recomendado)

1. Descompila el APK con apktool (ya tienes el entorno listo):
```bash
apktool d stickerly.apk -o stickerly_decoded
```

2. Reemplaza `res/xml/network_security_config.xml` con `network_security_config_patch.xml`
   (incluido en este repo).

3. Comprueba que `AndroidManifest.xml` referencia el archivo:
```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```
   Si ya existe esa línea, no hay que cambiar nada.

4. Recompila y firma (igual que el parche premium):
```bash
apktool b stickerly_decoded -o stickerly_nsc_patched.apk
java -jar uber-apk-signer.jar -a stickerly_nsc_patched.apk
adb install stickerly_nsc_patched-aligned-debugSigned.apk
```

5. En el teléfono, visita `http://mitm.it` con el proxy activo
   y descarga/instala el certificado CA de mitmproxy como
   **Ajustes → Seguridad → Instalar certificado → CA certificate**.

### Opción B — Con root (Magisk)

Instala el módulo **MagiskTrustUserCerts** o copia manualmente:
```bash
# en PC con teléfono conectado (ADB root)
adb push ~/.mitmproxy/mitmproxy-ca-cert.cer /sdcard/
adb shell
su
cp /sdcard/mitmproxy-ca-cert.cer \
   /system/etc/security/cacerts/$(openssl x509 -inform PEM \
   -subject_hash_old -in /sdcard/mitmproxy-ca-cert.cer | head -1).0
chmod 644 /system/etc/security/cacerts/*.0
```

---

## PASO 5 — Usar

1. PC: `mitmdump -s stickerly_ai_unlimited.py`
2. Teléfono: proxy activado, app abierta
3. Escribe cualquier prompt en la sección AI → genera
4. En la terminal del PC verás:
   ```
   [StickerlyAI] Intercepted generate | prompt='a cute cat' category='animals' → craftId=90001
   [StickerlyAI] Returning completed craft id=90001
   ```
5. La app mostrará la imagen generada por FLUX

---

## Backends de IA gratuitos disponibles

El script usa **Pollinations.ai** por defecto (sin API key, sin límites visibles):

| Backend | Modelo | API Key | Límite |
|---------|--------|---------|--------|
| **Pollinations.ai** (default) | FLUX | No | Ninguno documentado |
| Hugging Face Inference | SD XL | Opcional | 1000 req/mes gratis |
| Stable Horde | SD 1.5+ | No (`"0000000000"`) | Cola pública |

Para cambiar a otro backend, edita `_image_url()` en `stickerly_ai_unlimited.py`.

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| App no pasa por proxy | Proxy Wi-Fi no guardado | Re-verifica ajustes Wi-Fi |
| `adb reverse` no funciona | USB debugging no activo | Activa depuración USB |
| Error SSL en app | Cert CA no instalado | Repite PASO 4 |
| Generación falla sin mensaje | Pinning adicional en APK | Usa Opción A (NSC patch) |
| La imagen no carga en la app | outputUrl no accesible | Verifica conexión a pollinations.ai |
| `[StickerlyAI]` no aparece | El addon no cargó | Verifica path y versión mitmproxy |

---

## Por qué funciona esto pero no los créditos simulados

Los créditos de Sticker.ly se validan **servidor a servidor** con Google Play.
No es posible simularlos sin acceso al servidor de Sticker.ly.

En cambio, este addon **reemplaza el backend de IA completo**:
la app nunca ve el error 13001 porque la petición jamás llega al servidor real.
La imagen viene de un servicio externo gratuito y la app la muestra normalmente.
