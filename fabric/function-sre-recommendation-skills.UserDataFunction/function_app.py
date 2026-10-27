import ast
import datetime as dt
import json
import re
from contextlib import closing
from urllib.parse import quote
from uuid import UUID, uuid4

import fabric.functions as fn
import jsonpatch
import requests

udf = fn.UserDataFunctions()
TABLE = "[dbo].[Recommendations]"
LIMITS = {
    "thread_id": 500, "workspace_id": 500, "item_type": 100, "item_name": 500,
    "item_path": 500, "title": 250, "severity": 6, "estimated_impact": 500,
    "summary": 4000, "details": 4000, "proposed_changes": 4000,
    "git_repo_url": 500, "git_base_branch": 500, "git_folder": 500,
}
FIELDS = (
    "id status branch_name item_type item_name item_path title summary "
    "proposed_changes decided_by_name decided_by_email decided_at pr_url "
    "git_repo_url git_base_branch git_folder"
).split()


def failed(errors):
    return {"status": "validation_failed", "errors": errors}


def sql(db, statement, args, read=False):
    with closing(db.connect()) as connection, closing(connection.cursor()) as cursor:
        try:
            cursor.execute(statement, *args)
            if read:
                return cursor.fetchone()
            if cursor.rowcount != 1:
                raise RuntimeError("Recommendation changed or was not found")
            connection.commit()
        except Exception:
            connection.rollback()
            raise RuntimeError("SQL failed; check connection, permissions and recommendation state") from None


def github_repo(url):
    match = re.fullmatch(r"https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)/?", url)
    
    if not match or match[2].removesuffix(".git") in ("", ".", ".."):
        raise ValueError("git_repo_url must be https://github.com/<owner>/<repo>, optionally ending in .git or /")
    
    return match[1], match[2].removesuffix(".git")


def git_target(record):
    url, base, folder = (record.get(key) for key in ("git_repo_url", "git_base_branch", "git_folder"))
    if not isinstance(url, str) or not url or not isinstance(base, str) or not base or not isinstance(folder, str):
        raise ValueError("Recommendation is missing Git metadata; log it again after discovering the workspace Git connection")
    owner, repo = github_repo(url)
    invalid_branch = (
        base == "@" or base.startswith("-") or ".." in base or "@{" in base
        or re.search(r"[\s\x00-\x1f\x7f~^:?*\[\\]", base) or base.endswith(".")
        or any(not part or part.startswith(".") or part.endswith(".lock") for part in base.split("/"))
    )
    if invalid_branch:
        raise ValueError("git_base_branch is not a valid Git branch")
    if re.search(r"[\\\x00-\x1f\x7f]", folder) or (
        folder and any(part in ("", ".", "..", ".platform") for part in folder.split("/"))
    ):
        raise ValueError("git_folder must be relative without traversal, or empty for the repository root")
    try:
        if any(len(value.encode("utf-16-le")) // 2 > 500 for value in (url, base, folder)):
            raise ValueError("Git metadata exceeds its database length limit")
    except UnicodeError:
        raise ValueError("Git metadata contains invalid Unicode") from None
    return owner, repo, base, folder


def validate_notebook(original, updated):
    errors, metadata = [], {}
    pattern = r"(?m)^# (CELL|MARKDOWN|METADATA) \*{20}[ \t]*\r?$"
    parts = re.split(pattern, updated)
    sections = [("PREAMBLE", parts[0]), *zip(parts[1::2], parts[2::2])]
    
    for text in (updated, original):
        if text is not None and text.splitlines()[:1] != ["# Fabric notebook source"]:
            errors.append("the first line must remain '# Fabric notebook source'")
            break
    
    if original and parts[1::2].count("METADATA") < re.findall(pattern, original).count("METADATA"):
        errors.append("existing metadata blocks must not be removed")
    
    # Fabric exports put each cell's metadata after its code.
    for kind, source in reversed(sections):
        try:
            if kind == "METADATA":
                lines = [line for line in source.splitlines() if line.strip()]
                metadata = json.loads("\n".join(line[7:] for line in lines))
                valid_prefixes = all(line == "# META" or line.startswith("# META ") for line in lines)
                if not isinstance(metadata, dict) or not valid_prefixes:
                    raise ValueError()
            else:
                language = metadata.get("language", "python") if kind == "CELL" else "python"
                if not isinstance(language, str):
                    raise ValueError()
                if kind != "MARKDOWN" and language.lower() == "python":
                    code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("# MAGIC"))
                    ast.parse(code)
                metadata = {}
        except (SyntaxError, ValueError, UnicodeError):
            errors.append("notebook has invalid metadata or Python cell syntax")
            metadata = {}
    return errors


def validate_json(original, updated):
    try:
        before = json.loads(original) if original is not None else {}
        after = json.loads(updated)
        if isinstance(before, dict) and isinstance(after, dict) and before.keys() <= after.keys():
            return []
    except (ValueError, TypeError):
        pass
    return ["JSON must be an object and retain the original top-level keys"]


ITEM_TYPES = {
    "Notebook": {
        "files": ["notebook-content.py"],
        "formats": ["search_replace", "replace_file"], "validator": validate_notebook,
    },
    "DataPipeline": {
        "files": ["pipeline-content.json"],
        "formats": ["json_patch", "search_replace", "replace_file"], "validator": validate_json,
    },
}


def item_errors(kind, path):
    if kind in ITEM_TYPES and re.fullmatch(r"[^/\\\x00-\x1f\x7f]+\." + re.escape(kind), path):
        return []
    
    return ["unknown item_type or invalid item_path"]


def apply_change(original, change):
    if change["format"] == "replace_file":
        return change["content"], 1, []
    
    if original is None:
        return None, 0, ["file not found; only replace_file may create it"]
    
    edits = change.get("edits")
    
    if not isinstance(edits, list) or not edits or any(not isinstance(edit, dict) for edit in edits):
        return None, 0, ["edits must be a non-empty list of objects"]
    
    if change["format"] == "search_replace":
        errors, count = [], 0
        
        for number, edit in enumerate(edits, 1):
            search, replacement = edit.get("search"), edit.get("replace")
            
            if not isinstance(search, str) or not search or not isinstance(replacement, str):
                errors.append(f"edit {number}: search must be non-empty text and replace must be text")
                continue
            matches = len(re.findall("(?=" + re.escape(search) + ")", original))
            
            if matches != 1:
                errors.append(f"edit {number} in {change['path']}: search text matched {matches} times; "
                              f"search prefix: {search[:80]!r}")
            else:
                original = original.replace(search, replacement, 1)
                count += 1
        
        return original, count, errors
    
    try:
        patched = jsonpatch.JsonPatch(edits).apply(json.loads(original), in_place=False)
        updated = json.dumps(patched, indent=2, ensure_ascii=False, allow_nan=False)
        ending = next((e for e in ("\r\n", "\n", "\r") if original.endswith(e)), "")
        updated = updated.replace("\n", ending) + ending if ending else updated
        return updated, len(edits), []
    
    except (ValueError, TypeError, KeyError, IndexError, jsonpatch.JsonPatchException, jsonpatch.JsonPointerException):
        return None, 0, ["JSON Patch could not be applied"]


@udf.connection(argName="sqlDB", alias="sqlDB")
@udf.function()
def log_recommendation(
    sqlDB: fn.FabricSqlConnection, threadId: str, workspaceId: str, itemType: str, itemName: str,
    itemPath: str, title: str, severity: str, estimatedImpact: str, summary: str, details: str, proposedChanges: str,
    gitRepoUrl: str, gitBaseBranch: str, gitFolder: str,
) -> dict:
    
    values = {
        "thread_id": threadId, "workspace_id": workspaceId, "item_type": itemType, "item_name": itemName,
        "item_path": itemPath, "title": title, "severity": severity, "estimated_impact": estimatedImpact,
        "summary": summary, "details": details, "proposed_changes": proposedChanges,
        "git_repo_url": gitRepoUrl, "git_base_branch": gitBaseBranch, "git_folder": gitFolder,
    }
    errors = []
    
    for name, value in values.items():
        try:
            if (not isinstance(value, str) or (name != "git_folder" and not value.strip())
                    or len(value.encode("utf-16-le")) // 2 > LIMITS[name]):
                errors.append(f"{name} must be non-empty text within its database length limit")
        except UnicodeError:
            errors.append(f"{name} contains invalid Unicode")
    
    if isinstance(title, str) and len(title) > 200:
        errors.append("title must not exceed 200 characters")
    
    if severity not in ("Low", "Medium", "High"):
        errors.append("severity must be Low, Medium or High")
    
    if isinstance(itemType, str) and isinstance(itemPath, str):
        errors.extend(item_errors(itemType, itemPath))
    try:
        git_target(values)
    except ValueError as error:
        errors.append(str(error))
    
    if errors:
        return failed(errors)
    identifier = str(uuid4())
    columns = ["id", "created_at", *values, "status"]
    sql(sqlDB, f"INSERT INTO {TABLE} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)});",
        (identifier, dt.datetime.now(dt.timezone.utc).replace(tzinfo=None), *values.values(), "Pending"))
    
    return {"status": "logged", "recommendation_id": identifier}


@udf.connection(argName="sqlDB", alias="sqlDB")
@udf.connection(argName="githubConfig", alias="githubConfig")
@udf.function()
def commit_change_set(
    sqlDB: fn.FabricSqlConnection, githubConfig: fn.FabricVariablesClient,
    recommendationId: str, branch: str, message: str, changes: list, openPullRequest: bool = False,
) -> dict:
    
    try:
        recommendationId = str(UUID(recommendationId))
    except (ValueError, TypeError, AttributeError):
        return failed(["recommendationId must be a UUID"])
    
    if not all(isinstance(v, str) and v.strip() for v in (branch, message)) or not isinstance(openPullRequest, bool):
        return failed(["branch/message must be non-empty text; openPullRequest must be a Boolean"])
    
    row = sql(sqlDB, f"SELECT {', '.join(FIELDS)} FROM {TABLE} WHERE id = ?;", (recommendationId,), read=True)
    
    if row is None:
        return failed(["recommendation not found"])
    
    record = dict(zip(FIELDS, row))
    errors, seen = [], []
    
    if record["status"] != "Approved":
        errors.append(f"recommendation is {record['status']}, not approved")
    
    if branch != record["branch_name"]:
        errors.append("branch must equal the stored branch_name")
    try:
        owner, repo, base, folder = git_target(record)
        if branch == base:
            errors.append("branch must never be git_base_branch")
    except ValueError as error:
        errors.append(str(error))
    errors.extend(item_errors(record["item_type"], record["item_path"]))
    
    if openPullRequest and not all(record[k] for k in ("decided_by_name", "decided_by_email", "decided_at")):
        errors.append("approved recommendation is missing reviewer information")
    
    if not isinstance(changes, list) or not 1 <= len(changes) <= 20:
        return failed(errors + ["changes must contain 1 to 20 files"])
    config = ITEM_TYPES.get(record["item_type"], {"files": [], "formats": []})
    allowed_paths = [record["item_path"] + "/" + name for name in config["files"]]
    
    for change in changes:
        if not isinstance(change, dict):
            errors.append("each change must be an object")
            continue
        path, form = change.get("path"), change.get("format")
        

        if path not in allowed_paths or path in seen or ".platform" in path.split("/"):
            errors.append(f"path {path!r} must be unique and in {allowed_paths}; .platform is forbidden")
        
        seen.append(path)
        
        if form not in config["formats"]:
            errors.append("format is not allowed for this item type")
        
        if form == "replace_file" and (not isinstance(change.get("content"), str) or len(change["content"]) > 20_000):
            errors.append("replace_file requires text content of at most 20000 characters")
    
    if errors:
        return failed(errors)
    
    settings = githubConfig.getVariables()
    if not isinstance(settings.get("GITHUB_PAT"), str) or not settings["GITHUB_PAT"].strip():
        raise RuntimeError("Missing Variable Library value: GITHUB_PAT")

    def call(method, path, raw=False, allowed=(), **kwargs):
        headers = {
            "Authorization": f"Bearer {settings['GITHUB_PAT']}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json",
        }
        try:
            response = requests.request(method, f"https://api.github.com/repos/{owner}/{repo}" + path,
                                        headers=headers, timeout=30, allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise RuntimeError("GitHub request failed or timed out") from None
        
        if not 200 <= response.status_code < 300 and response.status_code not in allowed:
            raise RuntimeError(f"GitHub {method} {path} returned HTTP {response.status_code}")
        
        return response

    head = call("GET", "/git/ref/heads/" + quote(branch, safe="")).json()["object"]["sha"]
    tree = call("GET", "/git/commits/" + head).json()["tree"]["sha"]
    prepared, applied = [], 0
    
    for change in changes:
        # Inputs are item-relative; GitHub paths include the workspace's Git folder.
        path = f"{folder}/{change['path']}" if folder else change["path"]
        response = call("GET", "/contents/" + quote(path, safe="/"), raw=True, allowed=(404,), params={"ref": branch})
        
        try:
            original = None if response.status_code == 404 else response.content.decode("utf-8")
            updated, count, problems = apply_change(original, change)
            errors.extend(f"{path}: {error}" for error in problems)
            
            if updated is not None:
                updated.encode("utf-8")
                errors.extend(f"{path}: {error}" for error in config["validator"](original, updated))
                
                if updated != original:
                    prepared.append(dict(path=path, mode="100644", type="blob", content=updated))
                    applied += count
        except UnicodeError:
            errors.append(f"{path}: content must be valid UTF-8")
    
    if errors or not prepared:
        return failed(errors or ["no file contents changed"])
    
    tree = call("POST", "/git/trees", json={"base_tree": tree, "tree": prepared}).json()["sha"]
    sha = call("POST", "/git/commits", json={
        "message": f"[rec {recommendationId[:8]}] " + message, "tree": tree, "parents": [head],
    }).json()["sha"]
    
    result = call("PATCH", "/git/refs/heads/" + quote(branch, safe=""),
                  json={"sha": sha, "force": False}, allowed=(422,))
    
    if result.status_code == 422:
        return {"status": "conflict", "errors": ["branch moved, re-read files and retry"]}
    
    pr_url = record["pr_url"]
    
    try:
        if openPullRequest:
            pulls = call("GET", "/pulls", params={"head": f"{owner}:{branch}", "state": "open"}).json()
            
            if not pulls:
                at = record["decided_at"].replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")
                body = (
                    f"Recommendation: {recommendationId}\n\n"
                    f"Item: {record['item_type']} / {record['item_name']} (`{record['item_path']}`)\n\n"
                    f"## Summary\n\n{record['summary']}\n\n## Proposed changes\n\n{record['proposed_changes']}\n\n"
                    f"Approved by {record['decided_by_name']} ({record['decided_by_email']}) at {at}"
                )
                pulls = [call("POST", "/pulls", json={
                    "head": branch, "base": base, "title": "[SRE] " + record["title"], "body": body,
                }).json()]
            pr_url = pulls[0]["html_url"]
        sql(sqlDB, f"UPDATE {TABLE} SET commit_sha = ?, pr_url = ?, error_message = ? "
            "WHERE id = ? AND status = ? AND branch_name = ?;",
            (sha, pr_url, None, recommendationId, "Approved", branch))
    except Exception:
        raise RuntimeError(f"Commit {sha} was published, but PR or SQL update failed. "
                           "Inspect the branch before retrying.") from None
    
    return {
        "status": "committed", "commit_sha": sha, "pr_url": pr_url,
        "files": [file["path"] for file in prepared], "edits_applied": applied,
    }
