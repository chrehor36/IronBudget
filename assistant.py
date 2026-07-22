# -*- coding: utf-8 -*-
"""Conversational assistant: onboarding chat + persistent in-app guide.

Drives the app via real tool calls against the pywebview Api instance
(same methods the buttons/panels already call), rather than just narrating.
Verified against a real Hermes 3 round trip before this was written: plain
natural-language tool-calling instructions were unreliable (missed obvious
cases), but priming the conversation with one concrete example turn
(few-shot) made it consistently correct - so every conversation here starts
with that fixed example, never sent to the UI.
"""
import json
import threading

import engine
import local_llm
import settings


# ------------------------- tool schemas -------------------------
SAVE_HOUSEHOLD_TOOL = {
    "type": "function",
    "function": {
        "name": "save_household",
        "description": "Save the names of every person in this budget's household. Call this the moment the user gives you at least one name - don't wait for them to say they're done, you can call it again later if more people come up.",
        "parameters": {
            "type": "object",
            "properties": {
                "people": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"first": {"type": "string"}, "last": {"type": "string"}},
                        "required": ["first", "last"],
                    },
                }
            },
            "required": ["people"],
        },
    },
}

OPEN_FILE_PICKER_TOOL = {
    "type": "function",
    "function": {
        "name": "open_file_picker",
        "description": "Open the native file picker so the user can select their bank's CSV export file(s) right now. Use this once the user says they've downloaded a CSV and are ready to add it, or asks you to open the picker.",
        "parameters": {"type": "object", "properties": {}},
    },
}

RESCAN_TOOL = {
    "type": "function",
    "function": {
        "name": "rescan_csvs",
        "description": "Re-scan the app's folder for CSV files and rebuild the budget from whatever is there now.",
        "parameters": {"type": "object", "properties": {}},
    },
}

GET_SUMMARY_TOOL = {
    "type": "function",
    "function": {
        "name": "get_dashboard_summary",
        "description": "Get the current budget's key numbers: income, expenses, surplus, top categories, the essentials-vs-discretionary spending split (use this for any question about necessities, essentials, what's required to live, or what could be cut), the user's savings goal progress (if set), and their fun money budget status (if set). Always call this - never search_merchants or search_transactions - for questions like these, since they're not merchant/transaction lookups.",
        "parameters": {"type": "object", "properties": {}},
    },
}

GET_SUGGESTIONS_TOOL = {
    "type": "function",
    "function": {
        "name": "categorize_uncategorized",
        "description": "Get AI category suggestions for every merchant that still needs one, and apply them immediately. Use this when the user asks you to categorize their transactions.",
        "parameters": {"type": "object", "properties": {}},
    },
}

CORRECT_CATEGORY_TOOL = {
    "type": "function",
    "function": {
        "name": "correct_category",
        "description": "Changes real, saved data - only call this when the user explicitly tells you to change, fix, correct, or recategorize a merchant (e.g. \"that should be Groceries\", \"fix Amazon's category\"). Never call this to answer a question about a category or how much something cost - questions like \"what's my mortgage cost\" or \"what category is X in\" must NOT call this tool, they just get a plain answer. Applies to every transaction from that merchant, past and future.",
        "parameters": {
            "type": "object",
            "properties": {
                "merchant": {"type": "string", "description": "The merchant name as it appears in their transactions."},
                "category": {"type": "string"},
            },
            "required": ["merchant", "category"],
        },
    },
}

NAVIGATE_TOOL = {
    "type": "function",
    "function": {
        "name": "navigate_to",
        "description": "Switch the app to a specific view for the user.",
        "parameters": {
            "type": "object",
            "properties": {
                "view": {
                    "type": "string",
                    "enum": ["Dashboard", "Monthly", "Categories", "Trends", "Transfers",
                              "Subscriptions", "Savings", "Fun Money", "Transactions", "AI & Categories"],
                }
            },
            "required": ["view"],
        },
    },
}

EXPORT_TOOL = {
    "type": "function",
    "function": {
        "name": "export_excel",
        "description": "Export the current budget to an Excel workbook (opens a save dialog).",
        "parameters": {"type": "object", "properties": {}},
    },
}

SEARCH_TRANSACTIONS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_transactions",
        "description": "Search and/or sort the user's transactions, and switch them to the Transactions view showing exactly that. Use this whenever the user asks to find, filter, or sort their transactions.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text to search for in the description or category, e.g. 'costco'. Leave empty to show all."},
                "sort_by": {"type": "string", "enum": ["date", "acct", "desc", "cat", "amt"]},
                "sort_dir": {"type": "string", "enum": ["asc", "desc"]},
            },
            "required": [],
        },
    },
}

SEARCH_MERCHANTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_merchants",
        "description": "Search and/or sort the merchant list, and switch the user to the AI & Categories view showing exactly that. Use this when the user wants to find or sort merchants rather than individual transactions.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text to search for in the merchant name. Leave empty to show all."},
                "sort_by": {"type": "string", "enum": ["desc", "count", "total", "category"]},
                "sort_dir": {"type": "string", "enum": ["asc", "desc"]},
            },
            "required": [],
        },
    },
}

ONBOARDING_TOOLS = [SAVE_HOUSEHOLD_TOOL, OPEN_FILE_PICKER_TOOL, RESCAN_TOOL]
MAIN_TOOLS = [GET_SUMMARY_TOOL, GET_SUGGESTIONS_TOOL, CORRECT_CATEGORY_TOOL, NAVIGATE_TOOL,
              EXPORT_TOOL, OPEN_FILE_PICKER_TOOL, RESCAN_TOOL, SEARCH_TRANSACTIONS_TOOL, SEARCH_MERCHANTS_TOOL]

ABOUT_IRONBUDGET = (
    "About IronBudget, so you can explain it confidently instead of guessing: it's a private, fully "
    "offline personal budget app - no data ever leaves the user's computer unless they explicitly "
    "export to Excel or turn on an optional cloud AI key (off by default). You point it at CSV "
    "exports from any number of bank accounts (checking, savings, credit cards, etc.) and it "
    "automatically: removes duplicate/pending transactions that show up in multiple exports, detects "
    "transfers between the user's own accounts so they aren't double-counted as spending, detects "
    "travel trips from the locations embedded in transaction descriptions and tries to match them to "
    "a reimbursement deposit, and assigns spending categories. A category can come from the bank's "
    "own data, from an AI guess (which you can drive), or from the user correcting it by hand - "
    "corrections are remembered forever per-merchant via merchant memory, so the app gets more "
    "accurate the more it's used. The views in the sidebar: Dashboard (headline numbers, top "
    "category chart), Monthly (income vs. expenses by month), Categories (full spending "
    "breakdown), Trends (spending over time), Transfers (money moved between the user's own "
    "accounts - only shown if relevant), Subscriptions (merchants billing on a roughly monthly "
    "cycle, auto-detected), Savings (a user-set savings goal - target, current amount, progress, "
    "pace, ETA - plus an essentials-vs-discretionary spending breakdown with what-if cut "
    "scenarios), Fun Money (a user-set monthly discretionary budget tracked against categories "
    "the user picks), Transactions (every transaction, searchable and sortable), and AI & "
    "Categories (categorization, browse and correct merchants). All AI features (chat, "
    "categorization) run on a local model embedded directly in the app - nothing is sent to the "
    "cloud for them."
)

ONBOARDING_SYSTEM = (
    ABOUT_IRONBUDGET + "\n\n"
    "Your name is Dale - a deliberately boring, reassuring accountant name. You are IronBudget's "
    "onboarding assistant - warm, brief, and efficient. Your job, in order:\n"
    "1. Introduce yourself as Dale, greet the user, and ask who this budget is for (names of everyone "
    "in the household).\n"
    "2. The moment they give you a name, call save_household right away.\n"
    "3. After that, ask if they've already downloaded a CSV of their bank transactions. If they're not "
    "sure how, explain briefly: log into their bank's website, look for 'Download transactions' or "
    "'Export', and choose CSV format if given a choice - mention that exact menu wording varies by bank "
    "and to check their bank's own help pages if these general steps don't match what they see.\n"
    "4. Once they say a CSV is downloaded, call open_file_picker so they can select it.\n"
    "5. If they say files are already in the app's folder, call rescan_csvs directly - its result "
    "already tells you how many files it found, so there's no need to check first.\n"
    "Keep every message to 1-3 short sentences. Never ask more than one question at a time. "
    "If a tool's result contains an \"error\", tell the user plainly what went wrong in your own words "
    "- never invent a workaround, a menu, or a settings option that wasn't described to you.\n"
    "Before this message you will see one example conversation turn. That example is a fictional "
    "sample used only to show the correct tool-call format - its person ('Jamie Lee') is not a real "
    "person, was never actually said by the real user, and must never appear in a real save_household "
    "call, in your replies, or be combined with the real user's own name(s). When the real user tells "
    "you their name(s), call save_household with only those real name(s) - a fresh, complete list, "
    "never appended to the example."
)

MAIN_SYSTEM = (
    ABOUT_IRONBUDGET + "\n\n"
    "Your name is Dale - a deliberately boring, reassuring accountant name. You are IronBudget's "
    "in-app assistant - brief, helpful, and able to act. You can check the "
    "budget's numbers, categorize transactions, fix a merchant's category, switch views, search or "
    "sort transactions/merchants, add more CSV files, or export to Excel, all via your tools. Use "
    "get_dashboard_summary before answering questions about the numbers so you don't guess. Use "
    "search_transactions/search_merchants (not just describing results in words) whenever the user "
    "wants to find or sort something - it actually switches their screen to show it. Keep replies "
    "short - 1-3 sentences unless summarizing numbers. If a tool's result contains an \"error\", tell "
    "the user plainly what went wrong in your own words - never invent a workaround, a menu, or a "
    "settings option that wasn't described to you.\n"
    "Not every message needs a tool call - a greeting or small talk just gets a plain reply, no "
    "navigation and no tool use. Only call a tool when the user actually asks for numbers, an action, "
    "or to see/change something."
)

# Fixed example turns, prepended to every conversation for their respective
# phase (never shown to the user) - plain instructions alone were unreliable
# in testing (the model would sometimes give an empty reply with no tool
# call for an obvious case); priming with one concrete example turn made it
# consistently correct.
ONBOARDING_FEWSHOT = [
    {"role": "user", "content": "Hey there"},
    {"role": "assistant", "content": "Hi, I'm Dale! Welcome to IronBudget. Who's this budget for - what's your name?"},
    {"role": "user", "content": "I'm Jamie Lee"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"function": {"name": "save_household", "arguments": {"people": [{"first": "Jamie", "last": "Lee"}]}}}
    ]},
    {"role": "tool", "content": '{"ok": true}'},
    {"role": "assistant", "content": "Got it! Have you already downloaded a CSV of your bank transactions?"},
]

MAIN_FEWSHOT = [
    {"role": "user", "content": "hello"},
    {"role": "assistant", "content": "Hi, I'm Dale! Ask me about your budget, or tell me what you'd like to do."},
    {"role": "user", "content": "Show me my Amazon purchases"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"function": {"name": "search_transactions", "arguments": {"query": "amazon"}}}
    ]},
    {"role": "tool", "content": '{"ok": true, "count": 4, "total_spent": 210.55}'},
    {"role": "assistant", "content": "Found 4 Amazon transactions totaling $210.55 - switched you to the Transactions view to see them."},
    {"role": "user", "content": "Now sort all of them by date, oldest first"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"function": {"name": "search_transactions", "arguments": {"sort_by": "date", "sort_dir": "asc"}}}
    ]},
    {"role": "tool", "content": '{"ok": true, "count": 369, "total_spent": 4589.12}'},
    {"role": "assistant", "content": "Sorted all 369 transactions by date, oldest first."},
    {"role": "user", "content": "what's my mortgage cost?"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"function": {"name": "get_dashboard_summary", "arguments": {}}}
    ]},
    {"role": "tool", "content": '{"top_categories_total_over_whole_period": [["Mortgage & Rent", 12916.16]]}'},
    {"role": "assistant", "content": "Your Mortgage & Rent spending totals $12,916.16."},
    {"role": "user", "content": "what do i actually need to live, versus what could I cut?"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"function": {"name": "get_dashboard_summary", "arguments": {}}}
    ]},
    {"role": "tool", "content": '{"essentials_per_month": 2200.0, "discretionary_per_month": 900.0, "top_discretionary_categories": [["Shopping", 300.0], ["Restaurants", 250.0]]}'},
    {"role": "assistant", "content": "Essentials run about $2,200/mo; the other $900/mo is discretionary - mostly Shopping ($300) and Restaurants ($250), so that's where cutting back would have the most impact."},
]


def _tool_dispatch(api, name, args):
    """Executes one tool call against the real Api instance. Returns a
    JSON-safe dict; never raises - the model gets a {"error": ...} instead
    so it can react in its next reply rather than the whole turn crashing."""
    try:
        if name == "save_household":
            return api.save_household(args.get("people") or [])
        if name == "open_file_picker":
            picked = api.pick_csv_files()
            if picked.get("paths"):
                result = api.scan_and_build(picked["paths"])
                return {"picked": len(picked["paths"]), "scan": _strip_data(result)}
            return {"picked": 0}
        if name == "rescan_csvs":
            result = api.scan_and_build()
            out = _strip_data(result)
            out["csv_file_count"] = len(engine.gather_csv_paths(api_folder()))
            return out
        if name == "get_dashboard_summary":
            with api._lock:
                if not api._data:
                    return {"error": "No data loaded yet."}
                agg = api._data["agg"]
            folder = api_folder()

            classification = settings.load_spend_classification(folder)
            necessary_categories = classification["necessary_categories"] if classification else None
            split = engine.essentials_breakdown(agg, necessary_categories)

            goal = settings.load_savings_goal(folder)
            goal_summary = None
            if goal:
                pace = (agg["xfer_in_by_acct"].get(goal["account"], 0) / agg["MONTHS"]
                        if goal.get("account") else agg["net_m"])
                remaining = max(0, goal["target_amount"] - goal["current_amount"])
                goal_summary = {
                    "label": goal["label"], "current_amount": goal["current_amount"],
                    "target_amount": goal["target_amount"], "remaining": round(remaining, 2),
                    "monthly_pace": round(pace, 2),
                    "months_to_goal": round(remaining / pace, 1) if pace > 0 and remaining > 0 else None,
                }

            fun_money = settings.load_fun_money(folder)
            fun_money_summary = None
            if fun_money and fun_money.get("categories"):
                cur_month = agg["months"][-1] if agg["months"] else None
                spent = (sum(agg["m_cat_adj"].get(cur_month, {}).get(c, 0) for c in fun_money["categories"])
                         if cur_month else 0)
                fun_money_summary = {
                    "monthly_budget": fun_money["monthly_budget"], "spent_this_month": round(spent, 2),
                    "remaining_this_month": round(fun_money["monthly_budget"] - spent, 2),
                }

            return {
                "income_per_month": round(agg["inc_m"], 2), "expenses_per_month": round(agg["exp_m"], 2),
                "surplus_per_month": round(agg["inc_m"] - agg["exp_m"], 2),
                "top_categories_total_over_whole_period": [(c, round(v, 2)) for c, v in agg["cat_sorted"][:5]],
                "period": f"{agg['START']} to {agg['END']} ({agg['MONTHS']:.1f} months)",
                "accounts": agg["accounts"],
                "essentials_per_month": split["essentials_per_month"],
                "discretionary_per_month": split["discretionary_per_month"],
                "top_discretionary_categories": split["top_discretionary_categories"],
                "essentials_classification_reviewed_by_user": not split["using_default_guess"],
                "savings_goal": goal_summary,
                "fun_money": fun_money_summary,
            }
        if name == "categorize_uncategorized":
            with api._lock:
                if not api._data:
                    return {"error": "No data loaded yet."}
                rows = api._data["rows"]
            memory = engine.load_memory(api_folder())
            suggestions = engine.build_ai_suggestions(rows, memory, api_folder())
            applied = []
            for s in suggestions:
                api.correct_category(s["label"], s["category"])
                applied.append({"merchant": s["label"], "category": s["category"]})
            return {"applied": applied}
        if name == "correct_category":
            return _strip_data(api.correct_category(args.get("merchant", ""), args.get("category", "")))
        if name == "navigate_to":
            return {"ok": True, "view": args.get("view")}
        if name == "export_excel":
            return _strip_data(api.export_excel("Household Budget.xlsx"))
        if name == "search_transactions":
            with api._lock:
                if not api._data:
                    return {"error": "No data loaded yet."}
                rows = api._data["rows"]
            query = (args.get("query") or "").lower()
            matches = [t for t in rows if not query or query in t["desc"].lower() or query in t["cat"].lower()]
            spend = sum(-t["amt"] for t in matches if t["amt"] < 0)
            return {"ok": True, "count": len(matches), "total_spent": round(spend, 2)}
        if name == "search_merchants":
            with api._lock:
                if not api._data:
                    return {"error": "No data loaded yet."}
                rows = api._data["rows"]
            memory = engine.load_memory(api_folder())
            merchants = engine.merchant_summary(rows, memory)
            query = (args.get("query") or "").lower()
            matches = [m for m in merchants if not query or query in m["merchant_key"] or query in m["category"].lower()]
            return {"ok": True, "count": len(matches),
                    "merchants": [{"name": m["desc"], "category": m["category"], "total": m["total"]} for m in matches[:10]]}
        return {"error": f"unknown tool {name}"}
    except Exception as e:
        return {"error": str(e)}


def _strip_data(result):
    """Tool results go back into the LLM's context - drop the full transaction
    dataset (huge) and keep just enough for the model to talk about."""
    if not isinstance(result, dict):
        return result
    out = {k: v for k, v in result.items() if k != "data"}
    return out


_FOLDER_GETTER = None


def api_folder():
    return _FOLDER_GETTER()


def set_folder_getter(fn):
    global _FOLDER_GETTER
    _FOLDER_GETTER = fn


def run_turn(api, history, user_message, phase):
    """One conversational turn. `history` is the caller's persisted message
    list (role/content dicts, no fewshot/system baked in) - this function
    appends to it in place. Returns (reply_text, ui_actions) where
    ui_actions is a list of {"type": ..., ...} dicts the frontend reacts to
    (household_saved, data_updated, navigate)."""
    folder = api_folder()
    if not local_llm.is_model_ready(folder):
        return "I need my AI model downloaded first - install it from the AI & Categories tab.", []

    if phase == "onboarding":
        system, tools, fewshot = ONBOARDING_SYSTEM, ONBOARDING_TOOLS, ONBOARDING_FEWSHOT
    else:
        system, tools, fewshot = MAIN_SYSTEM, MAIN_TOOLS, MAIN_FEWSHOT

    history.append({"role": "user", "content": user_message})
    messages = [{"role": "system", "content": system}] + fewshot + history

    ui_actions = []
    final_text = ""
    for _ in range(5):  # hard cap: never loop on tool calls forever
        msg = local_llm.chat(folder, messages, tools)
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            final_text = msg.get("content") or ""
            history.append({"role": "assistant", "content": final_text})
            break
        history.append(msg)
        messages.append(msg)
        for call in tool_calls:
            fn = call.get("function", {})
            name = fn.get("name")
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            tool_result = _tool_dispatch(api, name, args)
            if name == "save_household" and tool_result.get("ok"):
                ui_actions.append({"type": "household_saved", "budget_title": tool_result.get("budget_title")})
            if name in ("open_file_picker", "rescan_csvs", "categorize_uncategorized", "correct_category") \
                    and not tool_result.get("error"):
                ui_actions.append({"type": "data_refresh"})
            if name == "navigate_to" and tool_result.get("ok"):
                ui_actions.append({"type": "navigate", "view": tool_result.get("view")})
            if name == "search_transactions" and tool_result.get("ok"):
                ui_actions.append({"type": "search_transactions", "query": args.get("query", ""),
                                   "sort_by": args.get("sort_by"), "sort_dir": args.get("sort_dir")})
            if name == "search_merchants" and tool_result.get("ok"):
                ui_actions.append({"type": "search_merchants", "query": args.get("query", ""),
                                   "sort_by": args.get("sort_by"), "sort_dir": args.get("sort_dir")})
            tool_msg = {"role": "tool", "content": json.dumps(tool_result)}
            history.append(tool_msg)
            messages.append(tool_msg)
    return final_text, ui_actions


class _WarmupApi:
    """Inert stand-in for the real Api during model warm-up - every method
    is a harmless no-op, so a stray tool call from the throwaway warm-up
    message can never pop a real file dialog, save real household data, or
    touch anything on disk."""
    _data = None
    _lock = threading.Lock()

    def save_household(self, people):
        return {"ok": True, "budget_title": None}

    def scan_and_build(self, extra_paths=None):
        return {"ok": True, "data": None, "error": None}

    def pick_csv_files(self):
        return {"paths": []}

    def correct_category(self, desc, category):
        return {"ok": True, "applied": 0, "data": None, "error": None}

    def export_excel(self, default_filename):
        return {"ok": False, "path": None, "error": "warmup"}


def warm_up(phase):
    """Loads the model and evaluates the system+fewshot prefix for `phase`
    once, up front - call this off the main thread right at app startup.
    The user's real first message then only pays for its own new tokens
    (llama-cpp-python reuses the KV cache for the shared prefix), instead of
    every session's first chat message paying the full cold-prompt cost."""
    try:
        run_turn(_WarmupApi(), [], "hi", phase)
    except Exception:
        pass
