# -*- coding: utf-8 -*-
"""Embedded local AI - a small Llama 3.2 GGUF model runs in-process via
llama-cpp-python. No separate app, installer, server, or tray icon - just a
model file IronBudget downloads once and loads into its own process.
Replaces the earlier Ollama-based design at the user's explicit request:
Ollama itself showed up as a distinct, visible app (tray icon, Start Menu
entry) even though it was just the engine underneath - this removes that
entirely. Originally tried with Hermes 3 (8B) - correct and fast on a GPU,
but ~2+ minutes per reply on CPU alone, which is what most users actually
have; swapped to this 3B model for CPU speed (~10-20s/reply) at some cost
to conversation/reasoning quality."""
import json
import os
import re
import threading
import urllib.request

MODEL_FILENAME = "llama32-3b-q4.gguf"
MODEL_URL = "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
MODEL_SIZE_GB = 2.02
_MIN_VALID_BYTES = 1_000_000_000  # sanity floor so a partial/failed download never looks "installed"

_lock = threading.RLock()  # reentrant: chat() holds this and calls get_llm(), which also locks
_llm = None  # lazily-loaded llama_cpp.Llama instance, one per process


def model_path(folder):
    return os.path.join(folder, MODEL_FILENAME)


def is_model_ready(folder):
    path = model_path(folder)
    return os.path.exists(path) and os.path.getsize(path) > _MIN_VALID_BYTES


def download_model(folder, progress_cb):
    """Blocking - call off the main thread. Downloads to a .part file first
    so a half-finished download can never be mistaken for a ready model."""
    dest = model_path(folder)
    tmp = dest + ".part"
    progress_cb({"phase": "download", "pct": 0})

    def hook(block_num, block_size, total_size):
        if total_size > 0:
            pct = min(100, int(block_num * block_size * 100 / total_size))
            progress_cb({"phase": "download", "pct": pct})

    urllib.request.urlretrieve(MODEL_URL, tmp, reporthook=hook)
    os.replace(tmp, dest)
    progress_cb({"phase": "done"})


def get_llm(folder):
    """Loads the model into memory on first use, then reuses it - loading
    the GGUF takes real time, so this must only happen once per process."""
    global _llm
    with _lock:
        if _llm is None:
            from llama_cpp import Llama
            # Half the cores, not all of them - benchmarked on a 16-core
            # machine: using every core pegs total system CPU at ~93-100%
            # (the whole computer feels sluggish) for identical latency on
            # the interactive post-warm-up path (cache-boosted replies are
            # decode-bound, not compute-bound, so extra threads don't help
            # there) - the only place more threads meaningfully help is the
            # one-time cold prompt prefill, which the startup warm-up now
            # already absorbs invisibly in the background regardless of
            # thread count. Halving cores leaves real headroom for the rest
            # of the user's computer at effectively no interactive cost.
            threads = max(2, (os.cpu_count() or 4) // 2)
            # No chat_format override - let llama-cpp-python use the GGUF's own
            # embedded chat template. Different model families use different
            # native formats (Hermes: ChatML: Llama 3.x: its own header tokens);
            # hardcoding one would misformat the others. The <tool_call> XML
            # convention below is plain text content, not tied to any one
            # template, so it still layers on top correctly either way.
            _llm = Llama(model_path=model_path(folder),
                          n_ctx=4096, n_threads=threads, n_threads_batch=threads,
                          verbose=False)
        return _llm


# Hermes 3's native tool-calling convention (confirmed from its model card),
# reused here as a general-purpose prompting strategy - llama-cpp-python's
# built-in "tools=" support only targets a different model family
# (Functionary), so this replicates by hand what Ollama's Modelfile was doing
# transparently: a <tools> block in the system prompt,
# <tool_call>{"name":...,"arguments":...}</tool_call> in the model's own
# output, and <tool_response>{"name":...,"content":...}</tool_response> for
# feeding results back. Verified this also works well with Llama 3.2 3B
# (not natively trained on this exact convention) once primed with a
# few-shot example - the model just needs to see the pattern once.
# The closing tag is optional in the match - a smaller model occasionally
# stops generating right after the JSON without emitting </tool_call>, and
# without this fallback the whole raw <tool_call>{...} fragment would leak
# into the displayed reply text instead of being parsed and stripped.
_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*(?:</tool_call>|$)", re.S)

_TOOLS_SYSTEM_SUFFIX = (
    "\n\nYou are a function calling AI model. You are provided with function signatures within "
    "<tools></tools> XML tags. You may call one or more functions to assist with the user query. "
    "For each function call, return a JSON object with function name and arguments within "
    "<tool_call></tool_call> XML tags as follows:\n"
    '<tool_call>\n{"name": <function-name>, "arguments": <args-dict>}\n</tool_call>\n'
    "<tools>\n%s\n</tools>"
)


def _inject_tools_into_system(messages, tools):
    tools_json = json.dumps([t["function"] for t in tools])
    suffix = _TOOLS_SYSTEM_SUFFIX % tools_json
    out = list(messages)
    if out and out[0].get("role") == "system":
        out[0] = dict(out[0], content=out[0]["content"] + suffix)
    else:
        out.insert(0, {"role": "system", "content": suffix.strip()})
    return out


def _format_tool_messages(messages):
    """Rewrites assistant tool_calls / tool-result messages into the
    <tool_call>/<tool_response> inline text convention above, since
    llama-cpp-python's chat templates have no built-in concept of either."""
    out = []
    pending_names = []
    for m in messages:
        role = m.get("role")
        if role == "assistant" and m.get("tool_calls"):
            names, blocks = [], []
            for call in m["tool_calls"]:
                fn = call.get("function", {})
                name = fn.get("name")
                args = fn.get("arguments")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                names.append(name)
                blocks.append(json.dumps({"name": name, "arguments": args}))
            pending_names = names
            content = "\n".join(f"<tool_call>\n{b}\n</tool_call>" for b in blocks)
            out.append({"role": "assistant", "content": content})
        elif role == "tool":
            name = pending_names.pop(0) if pending_names else None
            try:
                inner = json.loads(m.get("content") or "{}")
            except Exception:
                inner = m.get("content")
            wrapped = json.dumps({"name": name, "content": inner})
            out.append({"role": "tool", "content": f"<tool_response>\n{wrapped}\n</tool_response>"})
        else:
            out.append(m)
    return out


def _parse_tool_calls(text):
    calls = []
    for match in _TOOL_CALL_RE.finditer(text or ""):
        try:
            obj = json.loads(match.group(1))
        except Exception:
            continue
        calls.append({"function": {"name": obj.get("name"), "arguments": obj.get("arguments") or {}}})
    return calls


def chat(folder, messages, tools=None):
    """One chat completion turn. Returns a dict shaped like an OpenAI/Ollama
    chat message: {"role": "assistant", "content": ..., "tool_calls": [...]}.
    Holds _lock for the whole call, not just model load - llama.cpp's
    context is not safe for concurrent generation calls, and with the
    startup warm-up now running create_chat_completion on a background
    thread, a real chat message arriving mid-warm-up would otherwise hit
    the same context from two threads at once (crashed in practice)."""
    with _lock:
        llm = get_llm(folder)
        msgs = _format_tool_messages(messages)
        if tools:
            msgs = _inject_tools_into_system(msgs, tools)
        # max_tokens bounds worst-case latency per call - without it, an
        # ambiguous message that never leads the model to a natural stop
        # point can generate for minutes (up to n_ctx) instead of the usual
        # few seconds. Replies are meant to be 1-3 sentences (or one tool
        # call), so 350 tokens is generous headroom, not a real limit.
        result = llm.create_chat_completion(messages=msgs, max_tokens=350)
    msg = result["choices"][0]["message"]
    content = msg.get("content") or ""
    tool_calls = _parse_tool_calls(content)
    if tool_calls:
        clean = _TOOL_CALL_RE.sub("", content).strip()
        return {"role": "assistant", "content": clean or None, "tool_calls": tool_calls}
    return {"role": "assistant", "content": content}


def ask_json(folder, prompt):
    """Single-prompt convenience call for the (non-tool-calling) category
    suggestion prompts - returns the raw text response."""
    msg = chat(folder, [{"role": "user", "content": prompt}])
    return msg.get("content") or ""
