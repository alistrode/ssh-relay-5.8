---
name: project-backup-dev
description: Enforce pre-change pure-source backups and development-mode verification for project code changes, including work performed over SSH on remote machines.
metadata:
  short-description: Backup source before project changes and keep development mode runnable
---

# Project backup and development workflow

Use this skill only when a task changes code or project configuration inside a recognizable project directory. Do not trigger this workflow for loose files, one-off small tools, documentation-only edits, or files without a project directory unless the user explicitly asks for a backup.

## Before every project change

1. Identify the project root and project name.
2. Select the backup root for the machine:
   - Local machine: `E:\beifen`
   - SSH remote machine: `I:\xxm\beifen`
3. Ensure `<backup root>\<project name>\` exists.
4. Before editing, create a new timestamped archive in that directory. Do not overwrite an existing archive. Use a name such as `<project>_vYYYYMMDD_HHmmss_before-change.zip`.
5. If the backup cannot be created, the destination is not writable, or the exclusion set is uncertain, stop before editing and ask how to proceed.

## Archive contents

The archive is a pure-source snapshot. Include source code, configuration templates, scripts, documentation, and required static assets. Exclude dependencies, caches, build directories, compiler intermediates, logs, temporary files, secrets, and runtime-generated data. Common exclusions include `node_modules`, `.venv`, `venv`, `env`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `dist`, `build`, `out`, `target`, `bin`, `obj`, `.next`, `.nuxt`, `coverage`, `.cache`, `.git`, `*.pyc`, `*.log`, `*.tmp`, `*.user`, and `.env`. Do not package dependencies. If a normally excluded file is required to run the project, keep it only after deciding why and record that reason.

For multiple independent edits in one task, create a fresh archive before each edit set; never reuse or overwrite a prior snapshot.

## After changes

Keep the project runnable and debuggable in development mode. Use the project's existing development command or server for the minimal necessary startup check. Do not compile, package, or generate an EXE unless the user explicitly requests it. If development startup fails, fix the issue when within scope or report the exact blocker.

## SSH

Apply the same workflow when changing a project over SSH. Install this skill at `%USERPROFILE%\.codex\skills\project-backup-dev\SKILL.md` on the remote machine. Use `I:\xxm\beifen` as its backup root. Do not put these rules in AGENTS.md.
