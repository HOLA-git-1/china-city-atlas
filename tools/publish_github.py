#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Publish this project to a GitHub repository and turn on GitHub Pages.

The script only talks to https://api.github.com, so it works even when
github.com itself is slow or blocked. It asks for a token at runtime and
never writes it to disk.

Usage:
    python tools/publish_github.py [--repo china-city-atlas]

Before running, create a classic personal access token with the `public_repo`
scope:
    https://github.com/settings/tokens/new?scopes=public_repo&description=china-city-atlas
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.github.com"
TOKEN_HELP = (
    "https://github.com/settings/tokens/new"
    "?scopes=public_repo&description=china-city-atlas"
)
REPO_DESCRIPTION = "随机抽取或自由选择中国 359 个市级地点 —— 离线单页地图（ECharts）"
TOPICS = ["china", "map", "echarts", "city", "random", "geojson", "static-site"]


class ApiError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(f"HTTP {code}: {message}")
        self.code = code
        self.message = message


def api(path: str, token: str, method: str = "GET", payload: dict | None = None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "china-city-atlas-publisher")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with request.urlopen(req, timeout=120) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            message = json.loads(raw).get("message", raw)
        except json.JSONDecodeError:
            message = raw
        raise ApiError(exc.code, message) from exc


def read_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    print("请先在浏览器创建 token（只需 public_repo 权限）：")
    print("  " + TOKEN_HELP)
    print()
    token = getpass.getpass("粘贴 GitHub token（输入时不显示）: ").strip()
    if not token:
        sys.exit("没有拿到 token，已退出。")
    return token


def tracked_files() -> list[str]:
    raw = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z"]
    )
    return [name for name in raw.decode("utf-8").split("\0") if name]


def sitemap(base_url: str) -> bytes:
    today = date.today().isoformat()
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{base_url}</loc><lastmod>{today}</lastmod>"
        "<changefreq>monthly</changefreq><priority>1.0</priority></url>\n"
        "</urlset>\n"
    )
    return xml.encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="china-city-atlas")
    args = parser.parse_args()
    repo = args.repo

    token = read_token()

    user = api("/user", token)
    login = user["login"]
    print(f"已登录：{login}")

    # ---- repository -------------------------------------------------------
    try:
        api(f"/repos/{login}/{repo}", token)
        print(f"仓库已存在：{login}/{repo}")
    except ApiError as exc:
        if exc.code != 404:
            raise
        api("/user/repos", token, "POST", {
            "name": repo,
            "description": REPO_DESCRIPTION,
            "private": False,
            "has_wiki": False,
            "has_projects": False,
        })
        print(f"已创建仓库：{login}/{repo}")

    is_user_site = repo.lower() == f"{login.lower()}.github.io"
    base_url = (
        f"https://{login}.github.io/"
        if is_user_site
        else f"https://{login}.github.io/{repo}/"
    )

    # ---- one commit with every tracked file -------------------------------
    files: dict[str, bytes] = {}
    for name in tracked_files():
        files[name] = (ROOT / name).read_bytes()
    files["sitemap.xml"] = sitemap(base_url)
    print(f"准备上传 {len(files)} 个文件...")

    try:
        ref = api(f"/repos/{login}/{repo}/git/ref/heads/main", token)
        parent = ref["object"]["sha"]
        base_tree = api(
            f"/repos/{login}/{repo}/git/commits/{parent}", token
        )["tree"]["sha"]
    except ApiError as exc:
        if exc.code != 404:
            raise
        parent = None
        base_tree = None

    entries = []
    for index, (name, content) in enumerate(sorted(files.items()), 1):
        blob = api(f"/repos/{login}/{repo}/git/blobs", token, "POST", {
            "content": base64.b64encode(content).decode("ascii"),
            "encoding": "base64",
        })
        entries.append({
            "path": name,
            "mode": "100644",
            "type": "blob",
            "sha": blob["sha"],
        })
        print(f"  [{index}/{len(files)}] {name}")

    tree_payload: dict = {"tree": entries}
    if base_tree:
        tree_payload["base_tree"] = base_tree
    tree = api(f"/repos/{login}/{repo}/git/trees", token, "POST", tree_payload)

    commit_payload = {
        "message": "Deploy China City Atlas",
        "tree": tree["sha"],
    }
    if parent:
        commit_payload["parents"] = [parent]
    commit = api(f"/repos/{login}/{repo}/git/commits", token, "POST", commit_payload)

    if parent:
        api(f"/repos/{login}/{repo}/git/refs/heads/main", token, "PATCH", {
            "sha": commit["sha"],
            "force": False,
        })
    else:
        api(f"/repos/{login}/{repo}/git/refs", token, "POST", {
            "ref": "refs/heads/main",
            "sha": commit["sha"],
        })
    print("代码已上传。")

    # ---- GitHub Pages -----------------------------------------------------
    pages = None
    try:
        pages = api(f"/repos/{login}/{repo}/pages", token, "POST", {
            "source": {"branch": "main", "path": "/"},
        })
        print("GitHub Pages 已开启。")
    except ApiError as exc:
        if exc.code == 409:
            pages = api(f"/repos/{login}/{repo}/pages", token)
            print("GitHub Pages 原本已开启。")
        elif exc.code == 403:
            print("无法通过 API 开启 Pages（token 权限不足）。")
            print("请手动打开：")
            print(f"  https://github.com/{login}/{repo}/settings/pages")
            print("  Source 选择 Deploy from a branch，分支 main，目录 / (root)，保存。")
        else:
            raise

    # ---- metadata ---------------------------------------------------------
    try:
        api(f"/repos/{login}/{repo}", token, "PATCH", {
            "description": REPO_DESCRIPTION,
            "homepage": base_url,
        })
        api(f"/repos/{login}/{repo}/topics", token, "PUT", {"names": TOPICS})
    except ApiError as exc:
        print(f"（仓库描述/标签更新失败，可忽略：{exc.message}）")

    result = {
        "owner": login,
        "repo": repo,
        "repo_url": f"https://github.com/{login}/{repo}",
        "pages_url": base_url,
        "pages_enabled": pages is not None,
    }
    out = ROOT / "tmp" / "publish-result.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print("完成：")
    print(f"  仓库：{result['repo_url']}")
    print(f"  站点：{base_url}（首次构建通常 1-2 分钟）")


if __name__ == "__main__":
    main()
