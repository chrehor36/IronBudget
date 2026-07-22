# -*- coding: utf-8 -*-
"""
IronBudget data engine.

Every detection/classification/aggregation rule here is ported unchanged from
the original BudgetBuilder.py console tool - only the shape changed (explicit
functions with inputs/outputs instead of a top-to-bottom script over globals).
"""
import csv
import glob
import json
import os
import re
import sys
import datetime as dt
from collections import defaultdict, Counter

# ============================== CONFIG (optional) ==============================
# Manual overrides/additions on top of auto-detected trips.
# Reimbursed trips: (start_date, end_date, [extra merchant keywords seen during the trip])
TRIPS = [
    # (dt.date(2026, 6, 22), dt.date(2026, 6, 26), ["UBER", "AIRPORT"]),
]
TRIP_CITY_HINTS = []          # e.g. ["CHICAGO"] - matched anywhere, any date
REIMB_KEYWORDS = [
    # ("EMPLOYER NAME", "DIRECT-PAY"),   # all keywords in a tuple must match the same deposit
]

# Auto-detection tuning (usually fine to leave as-is):
TRIP_GAP_DAYS = 4
TRIP_MIN_TXNS = 2
TRIP_MIN_SPEND = 150.0
TRIP_SMALL_CLUSTER_FLOOR = 50.0
REIMB_WINDOW_DAYS = 45
REIMB_MATCH_RANGE = (0.5, 1.5)
US_STATES = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
             "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
             "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"}
LOCATION_RE = re.compile(r"([A-Za-z][A-Za-z.'&\- ]{1,28}?)\s{2,}([A-Z]{2})\s*$")
DOMAIN_RE = re.compile(r"\.(COM|NET|ORG|CO|BIZ)\b", re.I)
TRAVEL_CATEGORIES = {"Hotel", "Air Travel", "Rental Car & Taxi", "Travel"}
# ================================================================================

PENDING_LABEL = "Pending / Uncategorized"
CAT_RENAME = {"Uncategorized": "Other", "Atm Fee": "Cash", "Food & Dining": "Restaurants"}
INCOME_CATS = ("Paycheck", "Interest Income", "State Tax", "Federal Tax", "Income", "Refund")
P2P_KEYWORDS = ["ZELLE", "VENMO", "CASH APP", "CASHAPP", "PAYPAL"]
HOUSING_HINT = re.compile(r"rent|mortgage", re.I)

# Seeds the essentials/discretionary split before the user has ever reviewed
# it - kept identical to assets/js/views/savings.js's IB_NECESSARY_HINT so the
# in-app assistant's answer always matches what the Savings page shows. Only
# matters for the very first, unconfirmed pass - a saved classification
# (settings.load_spend_classification) always wins once the user has one.
NECESSARY_HINT = re.compile(
    r"mortgage|\brent\b|utilit|insurance|health|medical|grocer|\bauto\b|loan|\btax(es)?\b|"
    r"child|daycare|tuition|educat|phone|internet|\bbill|\bgas\b|fuel|doctor|dentist|pharmacy|prescription",
    re.I,
)

ACCOUNT_HINTS = [("saving", "Savings"), ("checking", "Checking"), ("credit", "Credit Card"),
                 ("visa", "Credit Card"), ("mastercard", "Credit Card"), ("amex", "Credit Card"),
                 ("invest", "Investment"), ("brokerage", "Investment"), ("401k", "Retirement"),
                 ("ira", "Retirement")]

AI_MODEL = "claude-opus-4-8"   # cloud fallback, used only if no local model and ANTHROPIC_API_KEY is set

MEMORY_FILENAME = "ironbudget_memory.json"


# ------------------------- CSV loading & dedup -------------------------
def merchant_key(desc):
    tokens = desc.split()
    def _is_ref_token(tok):
        # A trailing pure-digit token (a reference/date suffix like "071926")
        # or a store-number token like "#1175" - both are noise that splits
        # what's really the same merchant into separate recurring/merchant
        # entries (e.g. "Costco" vs "Costco Whse #1175").
        return tok.isdigit() or (tok.startswith("#") and tok[1:].isdigit())
    while tokens and _is_ref_token(tokens[-1]):
        tokens.pop()
    return " ".join(tokens).strip().lower() or desc.lower()


def load_memory(folder):
    path = os.path.join(folder, MEMORY_FILENAME)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_memory(folder, memory):
    path = os.path.join(folder, MEMORY_FILENAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(memory, f, indent=2, sort_keys=True)


def apply_memory(rows, memory):
    """Learned merchant -> category rules always win, since they represent an
    explicit correction (yours or the AI's) rather than a guess."""
    applied = 0
    for t in rows:
        cat = memory.get(merchant_key(t["desc"]))
        if cat is not None and t["cat"] != cat:
            t["cat"] = cat
            applied += 1
    return applied


def merchant_summary(rows, memory):
    """One row per merchant, for the AI panel's browse/correct table."""
    groups = {}
    for t in rows:
        key = merchant_key(t["desc"])
        g = groups.setdefault(key, {"merchant_key": key, "desc": t["desc"], "category": t["cat"],
                                     "count": 0, "total": 0.0})
        g["count"] += 1
        if t["amt"] < 0:
            g["total"] += -t["amt"]
        g["category"] = t["cat"]
    out = list(groups.values())
    for g in out:
        g["total"] = round(g["total"], 2)
        g["learned"] = g["merchant_key"] in memory
    out.sort(key=lambda g: -g["total"])
    return out


def apply_correction(rows, memory, desc, category):
    """Manual override from the AI panel: remembered from now on for every
    transaction from that merchant, past and future."""
    key = merchant_key(desc)
    memory[key] = category
    applied = 0
    for t in rows:
        if merchant_key(t["desc"]) == key:
            t["cat"] = category
            applied += 1
    return applied


def detect_account(path):
    base = os.path.splitext(os.path.basename(path))[0]
    low = base.lower()
    for hint, label in ACCOUNT_HINTS:
        if hint in low:
            return label
    cleaned = re.sub(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d*[-_]?\d*[-_]?\d*$", "", low, flags=re.I)
    cleaned = re.sub(r"[\d_\-]+$", "", cleaned)
    cleaned = re.sub(r"[_\-]+", " ", cleaned).strip()
    return cleaned.title() if cleaned else "Checking"


def load_file(path):
    acct = detect_account(path)
    out = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if not r.get("Date"):
                continue
            out.append({"date": dt.date.fromisoformat(r["Date"]), "desc": r["Description"].strip(),
                        "orig": r["Original Description"].strip(), "cat": r["Category"].strip(),
                        "amt": float(r["Amount"]), "status": r["Status"].strip(), "acct": acct})
    return out


def gather_csv_paths(folder):
    return sorted(glob.glob(os.path.join(folder, "*.csv")))


def load_and_dedup(paths):
    per_key = defaultdict(dict)
    for path in paths:
        for t in load_file(path):
            key = (t["acct"], t["date"], t["orig"], round(t["amt"], 2))
            per_key[key].setdefault(path, []).append(t)
    rows = []
    for key, byfile in per_key.items():
        best = max(byfile.values(), key=lambda rs: (sum(r["status"] == "Posted" for r in rs), len(rs)))
        rows.extend(best)
    return rows


# ------------------------- trip auto-detection -------------------------
def extract_state(orig):
    m = LOCATION_RE.search(orig)
    if not m:
        return None
    st = m.group(2)
    return st if st in US_STATES else None


def detect_trips(rows):
    """Trip tracking is disabled for now (2026-07-22, user's call - the
    auto-detection needs work and will come back once the AI side is more
    solid). Every row still gets the fields other code expects to exist
    (city/state/trip/reimb), just never flagged - the full detector is kept
    intact in _detect_trips_impl below, so re-enabling this later is just
    swapping this body for `return _detect_trips_impl(rows)`."""
    for t in rows:
        t["city"] = None
        t["state"] = None
        t["trip"] = False
        t["reimb"] = False
    return [], None


def _detect_trips_impl(rows):
    for t in rows:
        m = LOCATION_RE.search(t["orig"])
        t["city"] = m.group(1).strip().title() if m else None
        t["state"] = extract_state(t["orig"])
        t["trip"] = False
        t["reimb"] = False

    state_counts = Counter(t["state"] for t in rows if t["state"])
    home_state = state_counts.most_common(1)[0][0] if state_counts else None

    away_amounts = defaultdict(list)
    for t in rows:
        if t["state"] and t["state"] != home_state and t["amt"] < 0:
            away_amounts[merchant_key(t["desc"])].append(-t["amt"])

    def is_subscription_like(desc, key):
        if DOMAIN_RE.search(desc):
            return True
        amts = away_amounts.get(key, [])
        if len(amts) < 3:
            return False
        mean = sum(amts) / len(amts)
        return mean > 0 and (max(amts) - min(amts)) <= max(2.0, 0.1 * mean)

    detected_trips = []
    if home_state:
        away = sorted([t for t in rows if t["state"] and t["state"] != home_state and t["amt"] < 0
                       and (t["cat"] in TRAVEL_CATEGORIES
                            or not is_subscription_like(t["orig"], merchant_key(t["desc"])))],
                      key=lambda t: t["date"])
        clusters, current = [], []
        for t in away:
            if current and (t["date"] - current[-1]["date"]).days > TRIP_GAP_DAYS:
                clusters.append(current); current = []
            current.append(t)
        if current:
            clusters.append(current)

        def cluster_cost(c): return sum(-x["amt"] for x in c)
        kept = [c for c in clusters
                if cluster_cost(c) >= TRIP_MIN_SPEND
                or (len(c) >= TRIP_MIN_TXNS and cluster_cost(c) >= TRIP_SMALL_CLUSTER_FLOOR)]

        income_candidates = [t for t in rows if t["amt"] > 0 and t["cat"] == "Income"]
        used_reimb_ids = set()
        for c in kept:
            for t in c:
                t["trip"] = True
            start, end = min(t["date"] for t in c), max(t["date"] for t in c)
            cost = cluster_cost(c)
            window_end = end + dt.timedelta(days=REIMB_WINDOW_DAYS)
            lo, hi = REIMB_MATCH_RANGE
            candidates = [t for t in income_candidates
                          if start <= t["date"] <= window_end and id(t) not in used_reimb_ids
                          and lo * cost <= t["amt"] <= hi * cost]
            reimb_amt, reimb_date = None, None
            if candidates:
                best = min(candidates, key=lambda t: abs(t["amt"] - cost))
                best["reimb"] = True
                used_reimb_ids.add(id(best))
                reimb_amt, reimb_date = best["amt"], best["date"]
            locs = sorted({t["state"] for t in c})
            detected_trips.append({"start": start, "end": end, "cost": cost, "count": len(c),
                                    "locations": locs, "reimb_amt": reimb_amt, "reimb_date": reimb_date})

    return detected_trips, home_state


# ------------------------- classify -------------------------
def classify_rows(rows):
    for t in rows:
        up = t["orig"].upper()
        raw_cat = t["cat"]
        if raw_cat == "Category Pending":
            t["cat"] = PENDING_LABEL
        else:
            t["cat"] = CAT_RENAME.get(raw_cat, raw_cat)
        in_window = any(s <= t["date"] <= e and any(k in up for k in extras) for s, e, extras in TRIPS)
        if bool(TRIP_CITY_HINTS and any(h in up for h in TRIP_CITY_HINTS)) or in_window:
            t["trip"] = True
        if any(all(k in up for k in ks) for ks in REIMB_KEYWORDS):
            t["reimb"] = True
        is_p2p = any(k in up for k in P2P_KEYWORDS)
        t["internal"] = (raw_cat == "Transfer") and not is_p2p
        if is_p2p:
            t["cat"] = "Personal Payments"
            if t["amt"] > 0:
                raw_cat = "Income"
        t["income"] = (t["amt"] > 0 and raw_cat in INCOME_CATS
                       and not (t["reimb"] or t["internal"]))


# ------------------------- AI categorization -------------------------
def _needs_help_map(rows, memory):
    """merchant_key -> clean display label, for merchants still unresolved
    after learned rules are applied - the only ones that ever reach an AI
    model. Raw descriptions carry trailing date/reference codes (e.g.
    "BIG PEACH RUNNING CO             071826"); a title-cased merchant_key is
    both a nicer prompt and, critically, something the model can echo back
    verbatim - the raw padded description almost never round-trips exactly."""
    out = {}
    for t in rows:
        if t["cat"] in (PENDING_LABEL, "Other"):
            key = merchant_key(t["desc"])
            if key not in memory and key not in out:
                out[key] = key.title()
    return out


def get_ai_preview(rows, memory, folder):
    """Decide-only half: what would AI categorization do, without doing it."""
    import local_llm
    needs_help = _needs_help_map(rows, memory)
    if not needs_help:
        return {"count": 0, "sample": [], "provider": None, "model": None}
    has_local = local_llm.is_model_ready(folder)
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if not has_local and not has_key:
        return {"count": 0, "sample": [], "provider": None, "model": None}
    sample = sorted(needs_help.values())[:15]
    return {"count": len(needs_help), "sample": sample,
            "provider": "local" if has_local else "claude",
            "model": "Llama 3.2" if has_local else AI_MODEL}


INSIGHT_PROMPT = (
    "You are a plain-spoken financial advisor. Based on these real numbers for a household's "
    "budget, write exactly ONE short sentence (20 words or fewer) summarizing their situation - "
    "say plainly whether they're comfortably covering expenses or under pressure, and why. No "
    "markdown, no bullet points, no more than one sentence, nothing but the sentence itself.\n\n"
    "Income per month: {inc}\n"
    "Expenses per month: {exp}\n"
    "Surplus per month (income minus expenses): {net}\n"
    "{xfer_line}"
    "Biggest spending category: {top_cat} ({top_cat_amt}/mo)\n"
)


def generate_dashboard_insight(agg, folder):
    """One AI-generated sentence summarizing the dashboard, using the same
    local-model-first/Claude-fallback pattern as build_ai_suggestions.
    Returns None (never raises) if neither backend is available or the call
    fails - the frontend falls back to its own plain-computed sentence.

    Deliberately checks is_loaded(), not just is_model_ready(): the dashboard
    is the very first thing shown at launch, so if this called the local
    model unconditionally it would force a multi-GB model load on every
    single app open, even for someone who never touches chat. Only piggybacks
    on the model when it's already warm from real chat use this session;
    otherwise this is skipped entirely and the plain computed banner stands."""
    import local_llm
    has_local = local_llm.is_model_ready(folder) and local_llm.is_loaded()
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if not has_local and not has_key:
        return None
    if not agg.get("cat_sorted"):
        return None
    top_cat, top_cat_total = agg["cat_sorted"][0]
    xfer_line = f"Money moved to savings/other accounts per month: {agg['xfer_m']:.0f}\n" if agg.get("has_transfers") else ""
    prompt = INSIGHT_PROMPT.format(
        inc=f"${agg['inc_m']:.0f}", exp=f"${agg['exp_m']:.0f}", net=f"${agg['net_m']:.0f}",
        xfer_line=xfer_line, top_cat=top_cat, top_cat_amt=f"${top_cat_total / agg['MONTHS']:.0f}",
    )
    try:
        if has_local:
            text = local_llm.ask_json(folder, prompt)
        else:
            import anthropic
            client = anthropic.Anthropic()
            response = client.messages.create(model=AI_MODEL, max_tokens=100,
                                               messages=[{"role": "user", "content": prompt}])
            text = next((b.text for b in response.content if b.type == "text"), "")
        text = text.strip().strip('"')
        return text or None
    except Exception:
        return None


SUGGEST_CATEGORIZE_PROMPT = (
    "You are categorizing bank transaction merchants for a personal budget app.\n"
    "For each merchant name below, suggest a short, general spending category "
    "(like Groceries, Restaurants, Gas, Shopping, Utilities, Recreation, Fitness, "
    "Entertainment) and a one-sentence reason for your guess.\n\n"
    "Reply with ONLY a JSON object, one entry per merchant, in this exact shape:\n"
    '{"Merchant Name": {"category": "...", "reason": "..."}}\n\n'
    "Merchants:\n"
)


def build_ai_suggestions(rows, memory, folder):
    """AI category guesses for merchants still needing one. Does NOT touch
    `memory` or `rows` - every suggestion is just a proposal for the user to
    confirm or edit; Api.correct_category is what actually commits an approved
    one. Raises on failure - the caller turns that into
    {"ok": False, "error": ...} for the UI."""
    import local_llm
    needs_help = _needs_help_map(rows, memory)
    if not needs_help:
        return []
    has_local = local_llm.is_model_ready(folder)
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if not has_local and not has_key:
        return []

    prompt = SUGGEST_CATEGORIZE_PROMPT + "\n".join(needs_help.values())
    if has_local:
        text = local_llm.ask_json(folder, prompt)
    else:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(model=AI_MODEL, max_tokens=2048,
                                           messages=[{"role": "user", "content": prompt}])
        if response.stop_reason == "refusal":
            raise RuntimeError("AI categorization was declined by the model's safety filters.")
        text = next((b.text for b in response.content if b.type == "text"), "")
    mapping = json.loads(text)
    # match by merchant_key (case/format-normalized), not literal string equality -
    # models don't always echo the label back byte-for-byte
    mapping_by_key = {merchant_key(k): v for k, v in mapping.items() if isinstance(k, str)}

    suggestions = []
    for key, label in needs_help.items():
        entry = mapping_by_key.get(key)
        if isinstance(entry, dict):
            category, reason = entry.get("category") or "Other", entry.get("reason") or ""
        elif isinstance(entry, str):
            category, reason = entry, ""
        else:
            category, reason = "Other", "Couldn't get a confident guess for this merchant."
        suggestions.append({"merchant_key": key, "label": label, "category": category, "reason": reason})
    return suggestions


# ------------------------- aggregation -------------------------
def compute_aggregates(rows, detected_trips, home_state):
    START, END = min(t["date"] for t in rows), max(t["date"] for t in rows)
    DAYS = (END - START).days + 1
    MONTHS = max(DAYS / 30.437, 1 / 30.437)

    trip_cost = -sum(t["amt"] for t in rows if t["trip"])
    trip_reimb = sum(t["amt"] for t in rows if t["reimb"])
    xfer_total = sum(-t["amt"] for t in rows if t["internal"] and t["amt"] < 0)
    xfer_by_acct = defaultdict(float)
    xfer_in_by_acct = defaultdict(float)
    for t in rows:
        if t["internal"] and t["amt"] < 0:
            xfer_by_acct[t["acct"]] += -t["amt"]
        elif t["internal"] and t["amt"] > 0:
            xfer_in_by_acct[t["acct"]] += t["amt"]

    def spend_rows(adjusted=True):
        return [t for t in rows
                if not (t["internal"] or t["income"] or t["reimb"])
                and not (adjusted and t["trip"])]

    inc_total = sum(t["amt"] for t in rows if t["income"])
    exp_adj = sum(-t["amt"] for t in spend_rows(True))
    inc_m, exp_m = inc_total / MONTHS, exp_adj / MONTHS
    net_m, xfer_m = inc_m - exp_m, xfer_total / MONTHS
    accounts = sorted({t["acct"] for t in rows})

    cat_tot = defaultdict(float)
    for t in spend_rows(True):
        cat_tot[t["cat"]] += -t["amt"]
    cat_sorted = sorted(cat_tot.items(), key=lambda kv: -kv[1])

    def mkey(d): return d.strftime("%Y-%m")
    months = sorted({mkey(t["date"]) for t in rows})
    m_inc, m_exp_adj, m_xfer = defaultdict(float), defaultdict(float), defaultdict(float)
    for t in rows:
        if t["income"]:
            m_inc[mkey(t["date"])] += t["amt"]
        if t["internal"] and t["amt"] < 0:
            m_xfer[mkey(t["date"])] += -t["amt"]
    for t in spend_rows(True):
        m_exp_adj[mkey(t["date"])] += -t["amt"]

    m_cat_adj = defaultdict(lambda: defaultdict(float))
    for t in spend_rows(True):
        m_cat_adj[mkey(t["date"])][t["cat"]] += -t["amt"]

    def wk(d): return d - dt.timedelta(days=d.weekday())
    w_adj, w_raw, w_inc = defaultdict(float), defaultdict(float), defaultdict(float)
    for t in spend_rows(True):
        w_adj[wk(t["date"])] += -t["amt"]
    for t in spend_rows(False):
        w_raw[wk(t["date"])] += -t["amt"]
    for t in rows:
        if t["income"]:
            w_inc[wk(t["date"])] += t["amt"]

    rec_groups = defaultdict(list)
    for t in spend_rows(True):
        if t["amt"] >= 0:
            continue
        rec_groups[merchant_key(t["desc"])].append(t)
    recurring = [(k.title(), ts) for k, ts in rec_groups.items() if len(ts) >= 2]
    recurring.sort(key=lambda kv: -sum(-t["amt"] for t in kv[1]))

    def _core_amount_cluster(txns):
        # The same merchant key can bundle a real monthly subscription
        # together with unrelated one-off purchases (e.g. "Apple" covers
        # every App Store bill, so a recurring ~$20/mo app subscription and
        # an occasional $120 one-time purchase share one merchant group).
        # Find the largest cluster of transactions whose amounts sit within
        # 2x of each other - wide enough to keep a genuinely variable bill
        # (a utility bill swinging 30-50% with usage) together, but tight
        # enough to split off a charge on a totally different scale.
        best = []
        for t in txns:
            ref = -t["amt"]
            if ref <= 0:
                continue
            cluster = [x for x in txns if ref * 0.5 <= -x["amt"] <= ref * 2.0]
            if len(cluster) > len(best):
                best = cluster
        return best

    def _is_subscription_cadence(txns):
        # A real subscription/monthly bill bills on a roughly-monthly cycle -
        # not just "seen more than once" (that also matches grocery runs,
        # Amazon orders, gas stations...). Needs at least 2 gaps (3 charges)
        # since a single gap can look "monthly" by pure coincidence.
        if len(txns) < 3:
            return False
        dates = sorted(t["date"] for t in txns)
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        monthly = [g for g in gaps if 25 <= g <= 35]
        return len(monthly) / len(gaps) >= 0.6

    subscriptions = []
    for label, ts in recurring:
        core = _core_amount_cluster(ts)
        if _is_subscription_cadence(core):
            # Report on just the recurring core, not any one-off purchases
            # riding along on the same merchant name - that's what actually
            # answers "what am I paying for on a monthly basis here."
            subscriptions.append((label, core))

    lumpy = sorted([t for t in spend_rows(True) if -t["amt"] >= 100 and not HOUSING_HINT.search(t["cat"])],
                   key=lambda x: x["amt"])
    has_transfers = xfer_total > 0

    return {
        # kept as defaultdict(float), not plain dict: excel_export relies on
        # missing keys (e.g. a month with zero transfers) defaulting to 0.0,
        # exactly like the original script did. _jsonify handles defaultdict
        # fine via isinstance(obj, dict) when building the JS-facing copy.
        "cat_tot": cat_tot, "cat_sorted": cat_sorted,
        "m_inc": m_inc, "m_exp_adj": m_exp_adj, "m_xfer": m_xfer, "m_cat_adj": m_cat_adj, "months": months,
        "w_adj": w_adj, "w_raw": w_raw, "w_inc": w_inc,
        "recurring": recurring, "subscriptions": subscriptions, "lumpy": lumpy,
        "xfer_by_acct": xfer_by_acct, "xfer_in_by_acct": xfer_in_by_acct,
        "trip_cost": trip_cost, "trip_reimb": trip_reimb, "xfer_total": xfer_total,
        "inc_total": inc_total, "exp_adj": exp_adj, "inc_m": inc_m, "exp_m": exp_m,
        "net_m": net_m, "xfer_m": xfer_m, "accounts": accounts,
        "detected_trips": detected_trips, "home_state": home_state,
        "START": START, "END": END, "DAYS": DAYS, "MONTHS": MONTHS,
        "has_transfers": has_transfers,
    }


def default_necessary_categories(cat_sorted):
    return [c for c, _ in cat_sorted if NECESSARY_HINT.search(c)]


def essentials_breakdown(agg, necessary_categories=None):
    """necessary_categories=None means "no saved classification yet" - fall
    back to the same name-based guess the Savings page seeds its checkbox
    modal with, so this always agrees with what's on screen."""
    cat_sorted = agg["cat_sorted"]
    necessary_set = (set(necessary_categories) if necessary_categories is not None
                      else set(default_necessary_categories(cat_sorted)))
    necessary_total = sum(v for c, v in cat_sorted if c in necessary_set)
    discretionary_rows = [(c, v) for c, v in cat_sorted if c not in necessary_set]
    discretionary_total = sum(v for _, v in discretionary_rows)
    return {
        "essentials_per_month": round(necessary_total / agg["MONTHS"], 2),
        "discretionary_per_month": round(discretionary_total / agg["MONTHS"], 2),
        "top_discretionary_categories": [(c, round(v / agg["MONTHS"], 2)) for c, v in discretionary_rows[:5]],
        "using_default_guess": necessary_categories is None,
    }


# ------------------------- JSON-safe conversion for the JS bridge -------------------------
def _jsonify(obj):
    if isinstance(obj, dt.date):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {(_jsonify(k) if isinstance(k, dt.date) else k): _jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify(v) for v in obj]
    if isinstance(obj, float):
        return round(obj, 2)
    return obj


def to_json_safe(agg, rows):
    return {"agg": _jsonify(agg), "transactions": _jsonify(rows)}


# ------------------------- orchestration -------------------------
def build_dataset(csv_paths, folder):
    """CSV paths in, (json_for_js, raw_rows) out. json_for_js is fully
    JSON-serializable; raw_rows keeps native dt.date objects for excel_export
    and for re-running compute_aggregates after AI categorization.
    `folder` is where ironbudget_memory.json (learned merchant categories)
    lives - same folder as the CSVs/settings."""
    rows = load_and_dedup(csv_paths)
    detected_trips, home_state = detect_trips(rows)
    classify_rows(rows)
    apply_memory(rows, load_memory(folder))
    agg = compute_aggregates(rows, detected_trips, home_state)
    return to_json_safe(agg, rows), rows, agg
