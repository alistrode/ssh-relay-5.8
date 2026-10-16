---
name: xxm-workspace-governance
description: Keep projects and generated artifacts organized under X:\xxm (Windows) or ./xxm (Linux). Use whenever creating, cloning, downloading, extracting, or organizing project files in this workspace.
---

# XXM Workspace Governance

On Windows, use `X:\xxm`, where `X` is the drive letter of the non-system drive with the most free space; on Linux, use `./xxm`.

Apply these conventions within `X:\xxm` (Windows) or `./xxm` (Linux):

- Give every project one dedicated immediate child directory, named after the project.
- Put all source files, dependencies, build outputs, downloaded archives, generated scripts, logs, and project-specific configuration inside that project's directory.
- Do not scatter project files directly in `X:\xxm` (Windows) or `./xxm` (Linux).
- Keep unrelated projects in separate sibling directories; never merge their files.
- Before creating or downloading project content, choose or create its project directory and work there.
- When loose existing files clearly belong to one project, collect them into that project's directory. Ask the user only when ownership is genuinely ambiguous.
- Reserve `X:\xxm\.codex` (Windows) or `./xxm/.codex` (Linux) for directory-level Codex configuration and skills; it is not a project.
