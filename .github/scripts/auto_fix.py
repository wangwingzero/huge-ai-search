#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Set
from urllib import error, request


FILE_PATTERN = re.compile(
    r"([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|py|sh|toml|md|css|html))(?::\d+(?::\d+)?)?"
)
FENCE_PATTERN = re.compile(r"^```(?:diff|patch)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a code patch from CI logs.")
    parser.add_argument("--log-file", required=True, help="Path to CI/build log file.")
    parser.add_argument("--output-file", required=True, help="Path to write generated patch.")
    parser.add_argument("--attempt", type=int, default=1, help="Current fix attempt index.")
    parser.add_argument("--max-attempts", type=int, default=3, help="Maximum attempts.")
    parser.add_argument("--repo-root", default=".", help="Repository root path.")
    return parser.parse_args()


def run_git_ls_files(repo_root: Path) -> List[str]:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def detect_candidate_files(log_text: str, repo_root: Path, tracked_files: List[str]) -> List[str]:
    tracked_set: Set[str] = set(tracked_files)
    candidates: List[str] = []
    suffix_map = {f"/{path}": path for path in tracked_files}

    def try_add(rel_path: str) -> None:
        normalized = rel_path.replace("\\", "/").strip(" .,:;()[]{}<>\"'")
        if not normalized:
            return
        if normalized.startswith("a/") or normalized.startswith("b/"):
            normalized = normalized[2:]
        if normalized.startswith("/"):
            normalized = normalized[1:]
        if normalized not in tracked_set:
            matched = suffix_map.get(f"/{normalized}")
            if not matched:
                for tracked in tracked_files:
                    if normalized.endswith(f"/{tracked}"):
                        matched = tracked
                        break
            if matched:
                normalized = matched
        if normalized in tracked_set and normalized not in candidates:
            candidates.append(normalized)

    for match in FILE_PATTERN.finditer(log_text):
        try_add(match.group(1))

    for fallback in ["package.json", "package-lock.json", "tsconfig.json"]:
        if fallback in tracked_set and fallback not in candidates:
            candidates.append(fallback)

    if not candidates:
        for file_path in tracked_files:
            if file_path.startswith("src/") and file_path.endswith(".ts"):
                candidates.append(file_path)
            if len(candidates) >= 12:
                break

    return candidates[:20]


def read_file_snippet(path: Path, max_chars: int = 12000) -> str:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if len(content) > max_chars:
        return content[:max_chars] + "\n\n/* ...truncated... */\n"
    return content


def extract_text_from_response(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    chunks: List[str] = []
    for item in payload.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                    chunks.append(content["text"])
        elif item.get("type") in {"output_text", "text"} and isinstance(item.get("text"), str):
            chunks.append(item["text"])
    return "\n".join(chunks).strip()


def normalize_patch(text: str) -> str:
    cleaned = FENCE_PATTERN.sub("", text).strip()
    if cleaned.upper() == "NO_FIX":
        return ""
    if "diff --git " not in cleaned and ("--- " not in cleaned or "+++ " not in cleaned):
        return ""
    return cleaned + ("\n" if not cleaned.endswith("\n") else "")


def build_prompts(log_text: str, file_context: str, attempt: int, max_attempts: int) -> tuple[str, str]:
    system_prompt = (
        "You are an automated CI code-fix bot.\n"
        "Return only a valid unified git diff patch.\n"
        "Rules:\n"
        "1) Fix the failing build/test issue using minimal edits.\n"
        "2) Do not refactor unrelated code.\n"
        "3) You may edit dependency/config files only when required.\n"
        "4) Use repository-relative paths in diff headers.\n"
        "5) Output patch text only, no markdown, no explanation.\n"
        "6) If you cannot produce a safe fix, output exactly: NO_FIX"
    )
    user_prompt = (
        f"Attempt: {attempt}/{max_attempts}\n\n"
        "CI failure log:\n"
        "----- LOG START -----\n"
        f"{log_text}\n"
        "----- LOG END -----\n\n"
        "Repository file snippets (subset):\n"
        "----- FILES START -----\n"
        f"{file_context}\n"
        "----- FILES END -----\n\n"
        "Generate one minimal unified diff patch."
    )
    return system_prompt, user_prompt


def call_responses_api(system_prompt: str, user_prompt: str) -> str:
    api_key = os.getenv("CODEX_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing API key. Set CODEX_API_KEY or OPENAI_API_KEY.")

    endpoint = os.getenv("CODEX_API_ENDPOINT") or "https://api.openai.com/v1"
    endpoint = endpoint.rstrip("/")
    model = os.getenv("CODEX_MODEL") or "gpt-5-codex"
    timeout = int(os.getenv("CODEX_TIMEOUT_SECONDS", "180"))

    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_prompt}],
            },
        ],
    }

    req = request.Request(
        url=f"{endpoint}/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API request failed: HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"API request failed: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid API JSON response: {raw[:500]}") from exc

    text = extract_text_from_response(data)
    if not text:
        raise RuntimeError("API returned empty output.")
    return text


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    log_path = (repo_root / args.log_file).resolve()
    output_path = (repo_root / args.output_file).resolve()

    if not log_path.exists():
        print(f"Log file not found: {log_path}", file=sys.stderr)
        return 2

    log_text = log_path.read_text(encoding="utf-8", errors="replace")
    if len(log_text) > 50000:
        log_text = log_text[-50000:]

    tracked_files = run_git_ls_files(repo_root)
    candidates = detect_candidate_files(log_text, repo_root, tracked_files)
    file_blocks: List[str] = []
    for rel_path in candidates:
        abs_path = repo_root / rel_path
        snippet = read_file_snippet(abs_path)
        if snippet:
            file_blocks.append(f"### {rel_path}\n{snippet}")
    file_context = "\n\n".join(file_blocks)

    system_prompt, user_prompt = build_prompts(
        log_text=log_text,
        file_context=file_context,
        attempt=args.attempt,
        max_attempts=args.max_attempts,
    )

    try:
        response_text = call_responses_api(system_prompt, user_prompt)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    patch_text = normalize_patch(response_text)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(patch_text, encoding="utf-8")

    if patch_text:
        print(f"Patch generated: {output_path}")
    else:
        print("No valid patch generated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
