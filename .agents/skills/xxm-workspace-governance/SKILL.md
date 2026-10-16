---
name: xxm-workspace-governance
description: Keep projects and generated artifacts organized under the user's current confirmed project workspace on the target computer. Use whenever creating, cloning, downloading, extracting, or organizing project files in that workspace, including after moving to another computer or drive.
---

# XXM Workspace Governance

## Resolve the current workspace

`WORKSPACE_ROOT` means the user's current confirmed directory for sibling projects on the computer where the work will run. Resolve it from the user's latest instructions and the active workspace on that computer before creating project content.

- Follow the current workspace when the user changes computers, drives, or directories. `D:\jfj\xxm` is the historical location, not a fixed destination.
- A directory's existence alone does not establish that it is the active workspace. Do not select a historical directory just because it still exists.
- For remote work, resolve paths on the verified remote computer. A cloud checkout or cloud working directory does not establish the user's remote workspace path.
- Distinguish the directory containing sibling projects from an existing project's own directory. Continue existing projects in their established directories; do not create another nested project directory merely to apply this skill.
- If a new project's workspace root cannot be established from the available context, clarify the root before creating or moving its files. Do not create a replacement for an unavailable historical drive.

## Keep each project together

Apply these conventions within the resolved `WORKSPACE_ROOT`:

- Give every new project one dedicated immediate child directory, named after the project.
- Put all source files, dependencies, build outputs, downloaded archives, generated scripts, logs, and project-specific configuration inside that project's directory.
- Do not scatter project files directly in `WORKSPACE_ROOT`.
- Keep unrelated projects in separate sibling directories; never merge their files.
- Before creating or downloading project content, choose or create its project directory and work there.
- When loose existing files clearly belong to one project, collect them into that project's directory. Ask the user only when ownership is genuinely ambiguous.
- Reserve `WORKSPACE_ROOT/.codex` for directory-level Codex configuration and skills; it is not a project.
- Changing the workspace root does not by itself authorize moving existing projects from other locations. Keep their current locations unless relocation is part of the user's request.

For a project named `example-project`, use `WORKSPACE_ROOT/example-project` and keep its archives, scripts, dependencies, outputs, and logs within that directory. Resolve separators and absolute paths for the target operating system.
