"""
Evren job runner for the Unreal editor (copied to <project>/Content/Python/init_unreal.py, runs at editor start).

Agents drop Python files into <project>/Jobs/inbox/; each one runs once on the game thread, in file-name order, and
its stdout, error and optional RESULT variable are written to <project>/Jobs/outbox/<name>.json. File based, so it
needs no network (Python remote execution relies on loopback multicast, which is unreliable on macOS).
A job that must wait for a cloud request can set RESULT = {"pending": True, ...} and re-queue itself.
A job that crashes the editor is parked in <project>/Jobs/crashed/ at the next start instead of running again.
Avoid deleting or unloading assets in the same job that created or edited them (the editor aborts when a package
is unloaded while async loading is in flight).
"""
import contextlib
import io
import json
import os
import time
import traceback

import unreal

_PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
_JOBS = os.path.join(_PROJECT, "Jobs")
_INBOX = os.path.join(_JOBS, "inbox")
_OUTBOX = os.path.join(_JOBS, "outbox")
_DONE = os.path.join(_JOBS, "done")
_RUNNING = os.path.join(_JOBS, "running")
_CRASHED = os.path.join(_JOBS, "crashed")
for _d in (_INBOX, _OUTBOX, _DONE, _RUNNING, _CRASHED):
    os.makedirs(_d, exist_ok=True)

_state = {"last": 0.0, "busy": False}


def _run(inbox_path):
    # Move the job out of the inbox first, so a job that crashes the editor is not re-run at the next start.
    name = os.path.basename(inbox_path)
    path = os.path.join(_RUNNING, name)
    os.replace(inbox_path, path)
    out = io.StringIO()
    scope = {"__name__": "__evren_job__", "__file__": path}
    ok, error = True, None
    started = time.time()
    try:
        with open(path, encoding="utf-8") as f:
            code = compile(f.read(), path, "exec")
        with contextlib.redirect_stdout(out):
            exec(code, scope)
    except Exception:
        ok, error = False, traceback.format_exc()
    result = {
        "job": name,
        "ok": ok,
        "seconds": round(time.time() - started, 3),
        "stdout": out.getvalue(),
        "error": error,
        "result": scope.get("RESULT"),
    }
    tmp = os.path.join(_OUTBOX, name[:-3] + ".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, default=str, indent=1)
    os.replace(tmp, os.path.join(_OUTBOX, name[:-3] + ".json"))
    os.replace(path, os.path.join(_DONE, name))


def _tick(_dt):
    # Long editor operations (asset loads, MetaHuman edits) pump Slate from progress dialogs, which calls this tick
    # re-entrantly while a job is still running; never start a job inside another one.
    if _state["busy"]:
        return
    now = time.time()
    if now - _state["last"] < 0.5:
        return
    _state["last"] = now
    try:
        names = sorted(n for n in os.listdir(_INBOX) if n.endswith(".py"))
    except OSError:
        return
    if names:
        _state["busy"] = True
        try:
            _run(os.path.join(_INBOX, names[0]))
        finally:
            _state["busy"] = False


# Jobs left in running/ were executing when the editor died: park them in crashed/ with a result saying so.
for _n in os.listdir(_RUNNING):
    os.replace(os.path.join(_RUNNING, _n), os.path.join(_CRASHED, _n))
    with open(os.path.join(_OUTBOX, _n[:-3] + ".json"), "w", encoding="utf-8") as _f:
        json.dump({"job": _n, "ok": False, "error": "the editor crashed while this job was running"}, _f, indent=1)

unreal.register_slate_post_tick_callback(_tick)
unreal.log("[evren] job runner watching " + _INBOX)
