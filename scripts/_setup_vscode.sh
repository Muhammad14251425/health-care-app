#!/usr/bin/env bash
# Configure VS Code for the bench so that:
#   * the Python interpreter is the BENCH venv (python3.14), not system python
#   * `import frappe` / `import healthcare` resolve for Pylance
#   * pytest/bench tests are discoverable
#   * huge upstream dirs are excluded from search so it stays fast
set -euo pipefail

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
VS="$BENCH/.vscode"
mkdir -p "$VS"

cat > "$VS/settings.json" <<'JSON'
{
  // Use the BENCH virtualenv (Python 3.14.6), not the system python.
  "python.defaultInterpreterPath": "${workspaceFolder}/env/bin/python",

  // Let Pylance resolve `import frappe`, `import erpnext`, `import healthcare`,
  // `import clinic_core`. These are editable installs living under apps/.
  "python.analysis.extraPaths": [
    "${workspaceFolder}/apps/frappe",
    "${workspaceFolder}/apps/erpnext",
    "${workspaceFolder}/apps/healthcare",
    "${workspaceFolder}/apps/clinic_core"
  ],
  "python.analysis.autoSearchPaths": true,
  "python.analysis.typeCheckingMode": "basic",
  "python.analysis.diagnosticSeverityOverrides": {
    "reportMissingImports": "warning"
  },

  // Keep search/indexing fast: these dirs are hundreds of MB of vendor code.
  "search.exclude": {
    "**/node_modules": true,
    "**/env": true,
    "**/.git": true,
    "**/dist": true,
    "**/sites/assets": true,
    "**/*.min.js": true,
    "**/locale": true
  },
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/env/**": true,
    "**/sites/**": true,
    "**/.git/**": true
  },

  // Frappe uses tabs for Python indentation.
  "[python]": {
    "editor.insertSpaces": false,
    "editor.tabSize": 4
  },
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
JSON

cat > "$VS/launch.json" <<'JSON'
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Bench: serve (debug)",
      "type": "debugpy",
      "request": "launch",
      "program": "${workspaceFolder}/env/bin/bench",
      "args": ["serve", "--port", "8000", "--noreload"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "justMyCode": false
    },
    {
      "name": "Bench: execute current selection target",
      "type": "debugpy",
      "request": "launch",
      "module": "frappe.utils.bench_helper",
      "args": ["frappe", "--site", "clinic.localhost", "execute", "clinic_core.inventory.run"],
      "cwd": "${workspaceFolder}/sites",
      "console": "integratedTerminal",
      "justMyCode": false
    }
  ]
}
JSON

cat > "$VS/extensions.json" <<'JSON'
{
  "recommendations": [
    "ms-python.python",
    "ms-python.vscode-pylance",
    "ms-python.debugpy"
  ]
}
JSON

echo "wrote:"
ls -la "$VS"
echo
echo "interpreter that will be used:"
"$BENCH/env/bin/python" --version
echo
echo "sanity: can that interpreter import the apps?"
"$BENCH/env/bin/python" - <<'PY'
for m in ("frappe", "erpnext", "healthcare", "clinic_core"):
    try:
        mod = __import__(m)
        print(f"  OK  {m:12s} {getattr(mod,'__file__','')}")
    except Exception as e:
        print(f"  FAIL {m}: {e}")
PY
