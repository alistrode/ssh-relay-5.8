---
name: xxm-workspace-governance
description: Keep projects and generated artifacts organized under `.`. Use whenever creating, cloning, downloading, extracting, or organizing project files in this workspace.
---

# XXM Workspace Governance

Apply these conventions within `.`:

- Give every project one dedicated immediate child directory, named after the project.
- Put all source files, dependencies, build outputs, downloaded archives, generated scripts, logs, and project-specific configuration inside that project's directory.
- Do not scatter project files directly in `.`.
- Keep unrelated projects in separate sibling directories; never merge their files.
- Before creating or downloading project content, choose or create its project directory and work there.
- When loose existing files clearly belong to one project, collect them into that project's directory. Ask the user only when ownership is genuinely ambiguous.
- Reserve `./.codex` for directory-level Codex configuration and skills; it is not a project.
