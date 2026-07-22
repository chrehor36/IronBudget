# -*- coding: utf-8 -*-
"""IronBudget settings persistence - household names + the computed budget title."""
import json
import os
import re

SETTINGS_FILENAME = "ironbudget_settings.json"
SCHEMA_VERSION = 1


def _settings_path(folder):
    return os.path.join(folder, SETTINGS_FILENAME)


def join_and(items):
    items = list(items)
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} & {items[1]}"
    return ", ".join(items[:-1]) + f" & {items[-1]}"


def compute_budget_title(people):
    """people: list of {"first": str, "last": str}. Same logic as the
    original console tool: 1 person -> "First Last Budget"; same last name ->
    "First1 & First2 Last Budget"; different last names -> "Last1 & Last2 Budget"."""
    if not people:
        return "Household Budget"
    if len(people) == 1:
        first, last = people[0]["first"], people[0]["last"]
        return f"{first} {last} Budget".replace("  ", " ").strip()
    lasts_seen = []
    for p in people:
        last = p["last"]
        if last and last not in lasts_seen:
            lasts_seen.append(last)
    if len(lasts_seen) == 1:
        return f"{join_and([p['first'] for p in people])} {lasts_seen[0]} Budget"
    elif lasts_seen:
        return f"{join_and(lasts_seen)} Budget"
    return "Household Budget"


def safe_filename(title):
    return re.sub(r'[\\/:*?"<>|]', "", title)


def _load_raw(folder):
    path = _settings_path(folder)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_raw(folder, data):
    data["schema_version"] = SCHEMA_VERSION
    with open(_settings_path(folder), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_settings(folder):
    return _load_raw(folder).get("household")


def save_settings(folder, people):
    """people: list of {"first": str, "last": str}."""
    budget_title = compute_budget_title(people)
    household = {"people": people, "budget_title": budget_title}
    data = _load_raw(folder)
    data["household"] = household
    _save_raw(folder, data)
    return household
