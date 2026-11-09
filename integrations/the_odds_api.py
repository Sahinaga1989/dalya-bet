"""Secondary odds feed for DALYA BET; only fills missing real pre-match 1-X-2 odds."""
import datetime as dt
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api.the-odds-api.com/v4"
KEY = os.getenv("THE_ODDS_API_KEY", "").strip()
STATE = Path("the-odds-api-budget.json")
MAX_MONTHLY = 240  # 500-credit free plan; leave a substantial safety buffer
MAX_PER_RUN = 4

def read(path, fallback):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "").casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)

def kickoff(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except (TypeError, ValueError):
        return None

def fetch(path, params):
    query = urllib.parse.urlencode(dict(params, apiKey=KEY))
    req = urllib.request.Request(BASE + path + "?" + query, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = json.load(response)
        remaining = response.headers.get("x-requests-remaining")
        cost = response.headers.get("x-requests-last")
    return data, int(cost or 0), (int(remaining) if remaining is not None else None)

def main():
    if not KEY:
        raise SystemExit("THE_ODDS_API_KEY missing: secondary odds cannot run")
    now = dt.datetime.now(dt.timezone.utc)
    month = now.strftime("%Y-%m")
    budget = read(STATE, {})
    if budget.get("month") != month:
        budget = {"month": month, "used": 0}
    if budget["used"] >= MAX_MONTHLY:
        print("Secondary provider monthly safety budget reached")
        return
    fixtures = read("scores.json", {}).get("response", [])
    existing = read("odds.json", {})
    odds = existing.get("matches", {})
    if not isinstance(odds, dict):
        raise ValueError("Invalid existing odds format")
    candidates = {}
    for match in fixtures:
        f = match.get("fixture") or {}
        status = (f.get("status") or {}).get("short")
        when = kickoff(f.get("date"))
        if status != "NS" or not when or not now < when < now + dt.timedelta(days=2):
            continue
        ident = str(f.get("id", ""))
        if not ident or ident in odds and all(odds[ident].get(k) for k in ("1", "X", "2")):
            continue
        teams = match.get("teams") or {}
        home, away = norm((teams.get("home") or {}).get("name")), norm((teams.get("away") or {}).get("name"))
        if home and away:
            candidates.setdefault((home, away), []).append((ident, when))
    if not candidates:
        print("No missing upcoming fixture odds")
        return
    # Sports discovery endpoint is free. Only request active soccer competitions.
    sports, _, _ = fetch("/sports", {})
    keys = [s["key"] for s in sports if s.get("active") and str(s.get("key", "")).startswith("soccer_")]
    # Prefer Turkish league and popular European competitions when available.
    preferred = ["soccer_turkey_super_league", "soccer_uefa_champs_league",
                 "soccer_uefa_europa_league", "soccer_epl", "soccer_spain_la_liga",
                 "soccer_italy_serie_a", "soccer_germany_bundesliga", "soccer_france_ligue_one"]
    keys.sort(key=lambda k: (preferred.index(k) if k in preferred else 100, k))
    used = 0
    found = 0
    for key in keys:
        if used >= MAX_PER_RUN or budget["used"] >= MAX_MONTHLY:
            break
        # Reserve the maximum expected one-credit cost before each request.
        budget["used"] += 1
        STATE.write_text(json.dumps(budget, indent=2), encoding="utf-8")
        try:
            events, cost, remaining = fetch("/sports/" + urllib.parse.quote(key) + "/odds",
                                            {"regions": "eu", "markets": "h2h", "oddsFormat": "decimal"})
        except Exception as exc:
            print("Secondary odds request failed:", key, type(exc).__name__)
            continue
        used += 1
        if remaining is not None and remaining < 20:
            print("Secondary provider remaining credits low; stopping")
            break
        for event in events:
            pair = (norm(event.get("home_team")), norm(event.get("away_team")))
            event_time = kickoff(event.get("commence_time"))
            if not event_time or pair not in candidates:
                continue
            matched = [(ident, when) for ident, when in candidates[pair]
                       if abs((when - event_time).total_seconds()) <= 7200]
            if len(matched) != 1:
                continue
            ident, _ = matched[0]
            if ident in odds and all(odds[ident].get(k) for k in ("1", "X", "2")):
                continue
            for bookmaker in event.get("bookmakers", []):
                market = next((m for m in bookmaker.get("markets", []) if m.get("key") == "h2h"), None)
                if not market:
                    continue
                prices = {norm(o.get("name")): o.get("price") for o in market.get("outcomes", [])}
                try:
                    one = float(prices[pair[0]])
                    two = float(prices[pair[1]])
                    draw = float(prices["draw"])
                except (KeyError, ValueError, TypeError):
                    continue
                if not all(1.0 < x < 1000 for x in (one, draw, two)):
                    continue
                odds[ident] = {"1": str(one), "X": str(draw), "2": str(two),
                               "bookmaker": bookmaker.get("title", "The Odds API"),
                               "source": "the-odds-api", "fetched_at": now.isoformat()}
                found += 1
                break
    if found:
        existing["matches"] = odds
        existing["updated_at"] = now.isoformat()
        Path("odds.json").write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Secondary odds: requests", used, "new matches", found, "budget reserved", budget["used"])

if __name__ == "__main__":
    main()
