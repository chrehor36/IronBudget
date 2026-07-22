# -*- coding: utf-8 -*-
"""IronBudget desktop app entry point."""
import json
import os
import sys
import threading
import time
import traceback

import webview
from webview.dom import DOMEventHandler

import assistant
import engine
import excel_export
import local_llm
import settings


def base_path():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def asset_path(*parts):
    return os.path.join(base_path(), "assets", *parts)


FOLDER = os.path.dirname(os.path.abspath(sys.argv[0]))
DEBUG = "--debug" in sys.argv or bool(os.environ.get("IRONBUDGET_DEBUG"))
assistant.set_folder_getter(lambda: FOLDER)

_ai_warming_up = False  # True from the moment the startup warm-up thread begins until it finishes


class Api:
    def __init__(self):
        self._window = None
        self._lock = threading.Lock()
        self._chat_lock = threading.Lock()
        self._household = None
        self._data = None  # {"rows": [...], "agg": {...}, "json": {...}}
        self._chat_onboarding = []
        self._chat_main = []

    # ---------- startup / settings ----------
    def get_startup_state(self):
        self._household = settings.load_settings(FOLDER)
        csvs = engine.gather_csv_paths(FOLDER)
        return {
            "household": self._household,
            "csvs_in_folder": [os.path.basename(p) for p in csvs],
            "ai_ready": local_llm.is_model_ready(FOLDER),
        }

    def get_household(self):
        self._household = settings.load_settings(FOLDER)
        return self._household or {"people": [], "budget_title": None}

    def save_household(self, people):
        self._household = settings.save_settings(FOLDER, people)
        return {"ok": True, "budget_title": self._household["budget_title"]}

    def get_savings_goal(self):
        return settings.load_savings_goal(FOLDER)

    def save_savings_goal(self, goal):
        return {"ok": True, "goal": settings.save_savings_goal(FOLDER, goal)}

    def get_fun_money(self):
        return settings.load_fun_money(FOLDER)

    def save_fun_money(self, fun_money):
        return {"ok": True, "fun_money": settings.save_fun_money(FOLDER, fun_money)}

    # ---------- data ----------
    def _rebuild(self, extra_paths=None):
        paths = engine.gather_csv_paths(FOLDER)
        if extra_paths:
            for p in extra_paths:
                if p not in paths:
                    paths.append(p)
        if not paths:
            return {"ok": False, "data": None, "error": "No CSV files found. Export your transactions into this folder."}
        try:
            json_data, rows, agg = engine.build_dataset(paths, FOLDER)
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "data": None, "error": str(e)}
        with self._lock:
            self._data = {"rows": rows, "agg": agg, "json": json_data}
        return {"ok": True, "data": json_data, "error": None}

    def scan_and_build(self, extra_paths=None):
        return self._rebuild(extra_paths=extra_paths)

    def pick_csv_files(self):
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=("CSV files (*.csv)", "All files (*.*)"),
        )
        return {"paths": list(paths) if paths else []}

    # ---------- AI-generated dashboard insight ----------
    def get_dashboard_insight(self):
        with self._lock:
            if not self._data:
                return {"ok": False, "insight": None}
            agg = self._data["agg"]
        try:
            insight = engine.generate_dashboard_insight(agg, FOLDER)
        except Exception:
            traceback.print_exc()
            insight = None
        return {"ok": insight is not None, "insight": insight}

    # ---------- AI categorization ----------
    def get_ai_preview(self):
        with self._lock:
            if not self._data:
                return {"count": 0, "sample": [], "provider": None, "model": None}
            rows = self._data["rows"]
        memory = engine.load_memory(FOLDER)
        return engine.get_ai_preview(rows, memory, FOLDER)

    def get_ai_suggestions(self):
        """Search-informed category guesses for merchants still needing one.
        Purely a proposal - nothing is saved until the UI calls
        correct_category() for a suggestion the user approves (or edits)."""
        with self._lock:
            if not self._data:
                return {"ok": False, "suggestions": [], "error": "No data loaded yet."}
            rows = self._data["rows"]
        memory = engine.load_memory(FOLDER)
        try:
            suggestions = engine.build_ai_suggestions(rows, memory, FOLDER)
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "suggestions": [], "error": str(e)}
        return {"ok": True, "suggestions": suggestions, "error": None}

    # ---------- AI panel: browse / correct merchants ----------
    def get_merchants(self):
        with self._lock:
            if not self._data:
                return {"merchants": []}
            rows = self._data["rows"]
        memory = engine.load_memory(FOLDER)
        return {"merchants": engine.merchant_summary(rows, memory)}

    def correct_category(self, desc, category):
        with self._lock:
            if not self._data:
                return {"ok": False, "applied": 0, "data": None, "error": "No data loaded yet."}
            rows = self._data["rows"]
        memory = engine.load_memory(FOLDER)
        applied = engine.apply_correction(rows, memory, desc, category)
        engine.save_memory(FOLDER, memory)
        detected_trips = self._data["agg"]["detected_trips"]
        home_state = self._data["agg"]["home_state"]
        agg = engine.compute_aggregates(rows, detected_trips, home_state)
        json_data = engine.to_json_safe(agg, rows)
        with self._lock:
            self._data = {"rows": rows, "agg": agg, "json": json_data}
        return {"ok": True, "applied": applied, "data": json_data, "error": None}

    # ---------- embedded AI model ----------
    def get_ai_status(self):
        return {"ready": local_llm.is_model_ready(FOLDER), "size_gb": local_llm.MODEL_SIZE_GB}

    def install_ai_model(self):
        """Downloads the embedded local AI model file - no separate app,
        installer, or server, just a file IronBudget loads itself."""
        def progress_cb(payload):
            try:
                self._window.evaluate_js(f"window.__ironbudget && window.__ironbudget.onAiProgress({json.dumps(payload)})")
            except Exception:
                pass

        def run():
            try:
                local_llm.download_model(FOLDER, progress_cb)
            except Exception as e:
                progress_cb({"phase": "error", "error": str(e)})

        threading.Thread(target=run, daemon=True).start()
        return {"started": True}

    # ---------- export ----------
    def export_excel(self, default_filename):
        with self._lock:
            if not self._data:
                return {"ok": False, "path": None, "error": "No data loaded yet."}
            rows, agg = self._data["rows"], self._data["agg"]
        budget_title = (self._household or {}).get("budget_title") or "Household Budget"
        path = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            directory=os.path.join(os.path.expanduser("~"), "Documents"),
            save_filename=default_filename,
            file_types=("Excel Workbook (*.xlsx)",),
        )
        if not path:
            return {"ok": False, "path": None, "error": None}
        dest = path[0] if isinstance(path, (list, tuple)) else path
        try:
            excel_export.build_workbook(agg, rows, budget_title, dest)
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "path": None, "error": str(e)}
        try:
            os.startfile(dest)
        except Exception:
            pass
        return {"ok": True, "path": dest, "error": None}

    # ---------- conversational assistant ----------
    def is_ai_warming_up(self):
        return {"warming_up": _ai_warming_up}

    def assistant_send(self, message, phase):
        """phase: "onboarding" (household + CSV setup chat) or "main" (the
        persistent in-app guide). Each phase keeps its own history so the
        onboarding conversation doesn't bleed into ongoing app chat.
        _chat_lock serializes turns end-to-end (not just the model call) -
        pywebview runs each js_api call on its own thread, so two overlapping
        sends (e.g. a fast double-submit) would otherwise both append a
        "user" message to the same history list before either turn actually
        ran, producing two consecutive user turns with no assistant reply
        between them - a malformed conversation the chat template was never
        meant to render (reproduced: this actually happens under a real
        race, not just theoretical)."""
        history = self._chat_onboarding if phase == "onboarding" else self._chat_main
        t0 = time.time()
        try:
            with self._chat_lock:
                reply, ui_actions = assistant.run_turn(self, history, message, phase)
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "reply": None, "ui_actions": [], "data": None, "error": str(e)}
        finally:
            print(f"[assistant] {phase} turn ({message[:40]!r}) took {time.time() - t0:.2f}s", flush=True)
        with self._lock:
            data = self._data["json"] if self._data else None
        return {"ok": True, "reply": reply, "ui_actions": ui_actions, "data": data, "error": None}


def bind_drag_drop(window, api):
    def on_drop(e):
        files = (e or {}).get("dataTransfer", {}).get("files", [])
        csvs = [f["pywebviewFullPath"] for f in files
                if f.get("pywebviewFullPath", "").lower().endswith(".csv")]
        if not csvs:
            return
        result = api._rebuild(extra_paths=csvs)
        window.evaluate_js(f"window.__ironbudget && window.__ironbudget.onData({json.dumps(result)})")

    window.dom.document.events.dragenter += DOMEventHandler(lambda e: None, True, True)
    window.dom.document.events.dragover += DOMEventHandler(lambda e: None, True, True, debounce=500)
    window.dom.document.events.drop += DOMEventHandler(on_drop, True, True)


def _warm_up_ai():
    """Loads the model and evaluates its fixed prompt prefix in the
    background at startup, so the user's real first chat message doesn't
    pay that cost - a no-op if the model hasn't been downloaded yet."""
    global _ai_warming_up
    try:
        if not local_llm.is_model_ready(FOLDER):
            return
        _ai_warming_up = True
        household = settings.load_settings(FOLDER)
        phase = "main" if household else "onboarding"
        t0 = time.time()
        assistant.warm_up(phase)
        print(f"[assistant] warm-up ({phase}) took {time.time() - t0:.2f}s", flush=True)
    except Exception:
        pass
    finally:
        _ai_warming_up = False


def main():
    api = Api()
    window = webview.create_window(
        "IronBudget", url=asset_path("index.html"), js_api=api,
        width=1440, height=900, min_size=(480, 360), resizable=True,
        text_select=True,
    )
    api._window = window
    threading.Thread(target=_warm_up_ai, daemon=True).start()

    def on_loaded():
        bind_drag_drop(window, api)

    window.events.loaded += on_loaded
    webview.start(debug=DEBUG)


if __name__ == "__main__":
    main()
