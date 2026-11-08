"""DALYA BET secondary odds provider adapter.

Independent of API-Football. Requires a licensed provider endpoint and secret.
This module never invents odds and does not publish secrets to the browser.
Provider integration must be configured and mapped to API-Football fixture IDs
before merging data into odds.json.
"""
import json
import os
import urllib.parse
import urllib.request

def configured():
    return bool(os.getenv("SECONDARY_ODDS_API_URL") and os.getenv("SECONDARY_ODDS_API_KEY"))

def fetch_raw():
    """Retrieve provider-authorized JSON only; no fixture merging without ID mapping."""
    endpoint = os.getenv("SECONDARY_ODDS_API_URL", "").strip()
    key = os.getenv("SECONDARY_ODDS_API_KEY", "").strip()
    if not endpoint or not key:
        return {"status": "not_configured", "matches": []}
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Secondary provider URL must be HTTPS")
    request = urllib.request.Request(endpoint, headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
        "User-Agent": "DALYA-BET-odds-integration/1.0"
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    return {"status": "retrieved_unmapped", "payload": payload}

if __name__ == "__main__":
    if not configured():
        print("Secondary odds provider: not configured; primary feed unchanged.")
    else:
        # Never print credentials or raw potentially licensed provider data.
        result = fetch_raw()
        print("Secondary odds provider:", result["status"])
