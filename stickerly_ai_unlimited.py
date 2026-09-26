#!/usr/bin/env python3
"""
stickerly_ai_unlimited.py
─────────────────────────────────────────────────────────────────────────────
Mitmproxy addon: bypasses Sticker.ly AI credit enforcement (error 13001)
Routes generation requests to Pollinations.ai — completely free, no API key.

Usage
─────
  pip install mitmproxy
  mitmproxy -s stickerly_ai_unlimited.py          # interactive UI
  mitmdump  -s stickerly_ai_unlimited.py          # headless / terminal

Then set the phone's Wi-Fi proxy to <your-PC-IP>:8080 and install the
mitmproxy CA cert (see SETUP section in ai_unlimited_setup.md).

How it works
────────────
1. Intercepts POST  /v4/ai-play/crafts/prompt  (the generation request)
   • Extracts prompt/category from the multipart craftJson field
   • Returns a fake "pending" response with craftId=9xxxx and 9999 credits
   • The real request NEVER reaches Sticker.ly's server

2. Intercepts GET   /v4/ai-play/crafts  (the polling loop)
   • Returns a fake "completed" response whose outputUrl points to
     Pollinations.ai (free FLUX model) with the original prompt
   • The app downloads the image directly from Pollinations.ai

3. Intercepts any credit-balance endpoint
   • Returns balance=9999 so the UI never shows "buy credits" dialog

API shapes confirmed from APK smali reverse-engineering:
  craftJson   → {prompt, type, category, samplePromptSlugId?}
  POST resp   → {result: {craftId:Long, generationStatus:String,
                           remainingCredit:Int, createdAt:String}}
  GET  resp   → {result: {crafts: [{id, generationStatus, outputUrl,
                           thumbnailUrl, categorySlugId, ...}],
                           remainingCredit:Int}}
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
from typing import Optional

from mitmproxy import ctx, http

# ── State ─────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_pending: dict[int, dict] = {}   # fake_craft_id → {prompt, category, ts}
_counter = [90001]               # mutable int wrapper (list trick for closure)


def _next_id() -> int:
    with _lock:
        cid = _counter[0]
        _counter[0] += 1
        return cid


# ── Pollinations.ai ───────────────────────────────────────────────────────────

def _image_url(prompt: str, category: str) -> str:
    """
    Build a deterministic Pollinations.ai image URL.
    The URL itself serves the image — no upload/hosting needed.
    Free, no API key required, FLUX model.
    """
    full = f"{prompt.strip()}, {category} art style, clean transparent background, high quality"
    encoded = urllib.parse.quote(full)
    return (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?width=512&height=512&nologo=true&model=flux"
    )


# ── Response factories ────────────────────────────────────────────────────────

def _resp_create(craft_id: int) -> bytes:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return json.dumps({
        "result": {
            "craftId": craft_id,
            "generationStatus": "pending",
            "remainingCredit": 9999,
            "createdAt": now,
        }
    }).encode()


def _resp_history(craft_id: int, prompt: str, category: str) -> bytes:
    url = _image_url(prompt, category)
    ts = int(time.time() * 1000)
    return json.dumps({
        "result": {
            "crafts": [{
                "id": craft_id,
                "generationStatus": "completed",
                "categorySlugId": category,
                "templateSlugId": category,
                "templateTitle": category.replace("-", " ").title(),
                "thumbnailUrl": url,
                "type": "sticker",
                "ratio": "1:1",
                "outputUrl": url,
                "errorCode": None,
                "createdAt": ts,
                "updatedAt": ts,
                "prompt": prompt,
                "inputType": "text",
            }],
            "remainingCredit": 9999,
        }
    }).encode()


def _resp_balance() -> bytes:
    expiry = int(time.time() * 1000) + 365 * 24 * 3600 * 1000  # +1 year
    return json.dumps({
        "result": {
            "balance": 9999,
            "planType": "premium",
            "expiryTime": expiry,
        }
    }).encode()


# ── craftJson parser ──────────────────────────────────────────────────────────

def _parse_craft_json(flow: http.HTTPFlow) -> tuple[str, str]:
    """
    Extract (prompt, category) from the multipart craftJson part.
    Falls back to empty strings on any parse failure.
    """
    prompt = "cute sticker"
    category = "sticker"
    try:
        ct = flow.request.headers.get("content-type", "")
        if "multipart/form-data" in ct:
            for key, val in flow.request.multipart_form.items():
                if key == b"craftJson":
                    d = json.loads(val.decode("utf-8", errors="replace"))
                    prompt = d.get("prompt") or prompt
                    category = d.get("category") or category
                    break
        else:
            d = json.loads(flow.request.content)
            prompt = d.get("prompt") or prompt
            category = d.get("category") or category
    except Exception as exc:
        ctx.log.warn(f"[StickerlyAI] craftJson parse failed: {exc}")
    return prompt, category


# ── Addon ─────────────────────────────────────────────────────────────────────

class StickerlyAiUnlimited:

    def request(self, flow: http.HTTPFlow) -> None:
        path = flow.request.path

        # Intercept generation before it reaches the server
        if "/v4/ai-play/crafts/prompt" in path and flow.request.method == "POST":
            self._on_generate(flow)

    def response(self, flow: http.HTTPFlow) -> None:
        path = flow.request.path

        # Intercept polling response
        if flow.request.method == "GET" and "/v4/ai-play/crafts" in path \
                and "/prompt" not in path:
            self._on_poll(flow)

        # Override credit balance wherever it appears
        if "/v4/ai-play/credit" in path or "/ai-play/balance" in path:
            self._on_balance(flow)

    # ── handlers ──────────────────────────────────────────────────────────────

    def _on_generate(self, flow: http.HTTPFlow) -> None:
        prompt, category = _parse_craft_json(flow)
        cid = _next_id()
        with _lock:
            _pending[cid] = {"prompt": prompt, "category": category,
                              "ts": time.time()}

        ctx.log.info(
            f"[StickerlyAI] Intercepted generate | "
            f"prompt='{prompt}' category='{category}' → craftId={cid}"
        )
        flow.response = http.Response.make(
            200, _resp_create(cid), {"Content-Type": "application/json"}
        )

    def _on_poll(self, flow: http.HTTPFlow) -> None:
        with _lock:
            if not _pending:
                return
            cid = max(_pending.keys())
            info = dict(_pending[cid])

        prompt = info["prompt"]
        category = info["category"]
        ctx.log.info(f"[StickerlyAI] Returning completed craft id={cid}")
        flow.response = http.Response.make(
            200,
            _resp_history(cid, prompt, category),
            {"Content-Type": "application/json"},
        )

    def _on_balance(self, flow: http.HTTPFlow) -> None:
        ctx.log.info("[StickerlyAI] Returning fake balance=9999")
        flow.response = http.Response.make(
            200, _resp_balance(), {"Content-Type": "application/json"}
        )


addons = [StickerlyAiUnlimited()]
