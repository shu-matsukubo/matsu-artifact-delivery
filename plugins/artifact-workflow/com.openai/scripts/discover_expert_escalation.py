#!/usr/bin/env python3
"""List expert-escalation metadata through Codex's skills/list API; never invoke it."""

import argparse
import json
from pathlib import Path
import queue
import subprocess
import threading
import time


def discover(cwd: Path, timeout: float = 15, codex: str = "codex") -> dict:
    messages = queue.Queue()
    process = subprocess.Popen(
        [codex, "app-server"],
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    def read_output():
        try:
            for line in process.stdout:
                messages.put(json.loads(line))
        except (ValueError, OSError) as error:
            messages.put(error)
        finally:
            messages.put(None)

    def send(payload):
        process.stdin.write(json.dumps(payload) + "\n")
        process.stdin.flush()

    deadline = time.monotonic() + timeout

    def request(identifier, method, params):
        send({"id": identifier, "method": method, "params": params})
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Skill discovery timed out")
            try:
                message = messages.get(timeout=remaining)
            except queue.Empty as error:
                raise TimeoutError("Skill discovery timed out") from error
            if message is None:
                raise RuntimeError("App Server closed before replying")
            if isinstance(message, Exception):
                raise RuntimeError("Invalid App Server output") from message
            if "method" in message:
                if "id" in message:
                    raise RuntimeError("Unexpected App Server request during discovery")
                continue
            if message.get("id") == identifier:
                if "error" in message:
                    raise RuntimeError(str(message["error"]))
                return message["result"]

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    try:
        request(1, "initialize", {
            "clientInfo": {"name": "artifact_workflow_skill_discovery", "version": "0.1.0"}
        })
        send({"method": "initialized", "params": {}})
        result = request(2, "skills/list", {"cwds": [str(cwd)], "forceReload": True})
        entry, = result["data"]
        names = {"expert-escalation", "expert-escalation:expert-escalation"}
        return {
            "cwd": entry["cwd"],
            "skills": [
                {key: skill.get(key) for key in ("name", "path", "enabled", "pluginId")}
                for skill in entry["skills"] if skill["name"] in names
            ],
            "errors": entry["errors"],
        }
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        reader.join(timeout=1)
        process.stdin.close()
        process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", type=Path, default=Path.cwd(), help="Current task's working directory")
    args = parser.parse_args()
    try:
        result = discover(args.cwd.resolve())
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(json.dumps({"error": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
