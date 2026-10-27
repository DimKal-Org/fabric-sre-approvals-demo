import importlib.util
import inspect
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import urlsplit


ROOT = Path(__file__).parent
SOURCE = ROOT / "function-sre-recommendation-skills.UserDataFunction" / "function_app.py"
REGISTERED = []


class Functions:
    def function(self):
        def register(function):
            REGISTERED.append(function.__name__)
            return function
        return register

    def connection(self, **kwargs):
        return lambda function: function


sdk = types.ModuleType("fabric.functions")
sdk.UserDataFunctions = Functions
sdk.FabricSqlConnection = object
sdk.FabricVariablesClient = object
fabric = types.ModuleType("fabric")
fabric.functions = sdk
modules = {"fabric": fabric, "fabric.functions": sdk}
HAS_JSONPATCH = importlib.util.find_spec("jsonpatch") is not None
if not HAS_JSONPATCH:
    unavailable = types.ModuleType("jsonpatch")
    unavailable.JsonPatchException = type("JsonPatchException", (Exception,), {})
    unavailable.JsonPointerException = type("JsonPointerException", (Exception,), {})

    def unavailable_patch(*args, **kwargs):
        raise RuntimeError("Install jsonpatch in your test environment to exercise JSON Patch.")

    unavailable.JsonPatch = unavailable_patch
    modules["jsonpatch"] = unavailable

with patch.dict(sys.modules, modules):
    spec = importlib.util.spec_from_file_location("public_demo_udf", SOURCE)
    app = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app)

ID = "01234567-89ab-4cde-8fab-0123456789ab"
BRANCH = "sre/rec-01234567"
NOTEBOOK = "# Fabric notebook source\n# CELL ********************\nx = 1\n"
CHANGE = {
    "path": "Demo.Notebook/notebook-content.py",
    "format": "search_replace",
    "edits": [{"search": "x = 1", "replace": "x = 2"}],
}


class UdfTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.config = MagicMock()
        self.config.getVariables.return_value = {"GITHUB_PAT": "test-only-token"}
        self.record = dict.fromkeys(app.FIELDS)
        self.record.update(
            id=ID, status="Approved", branch_name=BRANCH, item_type="Notebook",
            item_name="Demo", item_path="Demo.Notebook", title="Improve notebook",
            git_repo_url="https://github.com/example/workloads",
            git_base_branch="release", git_folder="workspace",
        )
        self.network = patch.object(
            app.requests, "request",
            side_effect=AssertionError("A unit test attempted an unexpected external request."),
        ).start()
        self.addCleanup(patch.stopall)

    def row(self):
        return tuple(self.record[field] for field in app.FIELDS)

    def commit(self, **overrides):
        args = dict(
            recommendationId=ID, branch=BRANCH, message="Improve notebook",
            changes=[CHANGE],
        )
        args.update(overrides)
        with patch.object(app, "sql", return_value=self.row()) as database:
            result = app.commit_change_set(self.db, self.config, **args)
        return result, database

    def log(self, **overrides):
        args = dict(
            threadId="test-thread", workspaceId="test-workspace", itemType="Notebook",
            itemName="Demo", itemPath="Demo.Notebook", title="Improve notebook",
            severity="Medium", estimatedImpact="Estimate requiring validation",
            summary="Summary", details="Details", proposedChanges="Replace x = 1",
            gitRepoUrl="https://github.com/example/workloads",
            gitBaseBranch="release", gitFolder="",
        )
        args.update(overrides)
        with patch.object(app, "sql") as database:
            result = app.log_recommendation(self.db, **args)
        return result, database

    def test_registered_contract_and_pr_default(self):
        self.assertEqual(REGISTERED, ["log_recommendation", "commit_change_set"])
        self.assertIs(
            inspect.signature(app.commit_change_set).parameters["openPullRequest"].default,
            False,
        )

    def test_git_target_root_and_nested_folder(self):
        for folder in ("", "workspace/nested"):
            with self.subTest(folder=folder):
                self.record["git_folder"] = folder
                self.assertEqual(
                    app.git_target(self.record), ("example", "workloads", "release", folder),
                )

    def test_missing_git_metadata_has_no_default(self):
        for field in ("git_repo_url", "git_base_branch", "git_folder"):
            with self.subTest(field=field):
                record = dict(self.record, **{field: None})
                with self.assertRaises(ValueError):
                    app.git_target(record)

    def test_invalid_repo_branch_and_folder(self):
        for field, value in (
            ("git_repo_url", "https://github.example.com/example/workloads"),
            ("git_base_branch", "bad..branch"),
            ("git_folder", "../outside"),
            ("git_folder", "workspace/.platform"),
        ):
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    app.git_target(dict(self.record, **{field: value}))

    def test_logger_stores_pending_and_git_snapshot(self):
        result, database = self.log()
        self.assertEqual(result["status"], "logged")
        statement, values = database.call_args.args[1:3]
        self.assertIn("git_repo_url, git_base_branch, git_folder", statement)
        self.assertEqual(values[-4:], ("https://github.com/example/workloads", "release", "", "Pending"))
        self.network.assert_not_called()

    def test_logger_rejects_oversized_text_without_sql(self):
        result, database = self.log(details="x" * 4001)
        self.assertEqual(result["status"], "validation_failed")
        database.assert_not_called()

    def test_logger_rejects_unknown_item_type_without_sql(self):
        result, database = self.log(itemType="Unknown")
        self.assertEqual(result["status"], "validation_failed")
        database.assert_not_called()

    def test_commit_requires_approved(self):
        for status in ("Pending", "Rejected"):
            with self.subTest(status=status):
                self.record["status"] = status
                result, database = self.commit()
                self.assertEqual(result["status"], "validation_failed")
                self.assertEqual(database.call_count, 1)
                self.network.assert_not_called()
                self.config.getVariables.assert_not_called()

    def test_commit_requires_exact_stored_branch(self):
        result, _ = self.commit(branch="sre/another-recommendation")
        self.assertEqual(result["status"], "validation_failed")
        self.network.assert_not_called()

    def test_commit_forbids_base_branch(self):
        self.record["branch_name"] = self.record["git_base_branch"]
        result, _ = self.commit(branch=self.record["git_base_branch"])
        self.assertEqual(result["status"], "validation_failed")
        self.network.assert_not_called()

    def test_commit_forbids_outside_paths(self):
        result, _ = self.commit(changes=[dict(CHANGE, path="Other.Notebook/notebook-content.py")])
        self.assertEqual(result["status"], "validation_failed")
        self.network.assert_not_called()

    def test_notebook_validation_preserves_format(self):
        self.assertEqual(app.validate_notebook(NOTEBOOK, NOTEBOOK.replace("x = 1", "x = 2")), [])
        self.assertTrue(app.validate_notebook(NOTEBOOK, "x = 2"))
        self.assertTrue(app.validate_notebook(NOTEBOOK, NOTEBOOK.replace("x = 1", "x =")))

    @unittest.skipUnless(HAS_JSONPATCH, "jsonpatch is not installed; no substitute implementation is tested")
    def test_real_json_patch(self):
        updated, count, errors = app.apply_change(
            '{"name":"before"}',
            {"format": "json_patch", "edits": [{"op": "replace", "path": "/name", "value": "after"}]},
        )
        self.assertEqual(errors, [])
        self.assertEqual(json.loads(updated), {"name": "after"})
        self.assertEqual(count, 1)

    def test_commit_uses_stored_folder_and_no_pr_by_default(self):
        def response(data=None, text=""):
            return types.SimpleNamespace(status_code=200, json=lambda: data, content=text.encode())

        def route(method, url, **kwargs):
            path = urlsplit(url).path.removeprefix("/repos/example/workloads")
            if method == "GET" and path.startswith("/git/ref/heads/"):
                return response({"object": {"sha": "head"}})
            if method == "GET" and path == "/git/commits/head":
                return response({"tree": {"sha": "tree"}})
            if method == "GET" and path == "/contents/workspace/Demo.Notebook/notebook-content.py":
                return response(text=NOTEBOOK)
            if method == "POST" and path == "/git/trees":
                self.assertEqual(kwargs["json"]["tree"][0]["path"], "workspace/Demo.Notebook/notebook-content.py")
                return response({"sha": "new-tree"})
            if method == "POST" and path == "/git/commits":
                return response({"sha": "new-commit"})
            if method == "PATCH" and path.startswith("/git/refs/heads/"):
                self.assertIs(kwargs["json"]["force"], False)
                return response()
            self.fail(f"Unexpected request: {method} {path}")

        self.network.side_effect = route
        result, database = self.commit()
        self.assertEqual(result["status"], "committed")
        self.assertEqual(result["commit_sha"], "new-commit")
        self.assertIsNone(result["pr_url"])
        self.assertEqual(database.call_args.args[2][-2:], ("Approved", BRANCH))
        self.assertNotIn("SET status", database.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
