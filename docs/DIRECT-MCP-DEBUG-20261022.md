# Direct MCP debugging — 2026-10-22

Branch: `fix/ssh-pro-startup-20261019`. Product source: `912d073`.

The user replaced the final one-hour requirement with ten minutes and prohibited test suites. All checks below use normal Agents and individually selected calls through the actual MCP client, with subsequent inspection of real effects. No suite was run after that instruction.

Temporary native hosts: Ubuntu 24.04 and **Windows Server 2022**, leased by [Actions run 39739290068](https://github.com/trlstdin/rororororo/actions/runs/39739290068). This does not certify Windows 10 or desktop GUI installation/autostart.

## Confirmed normal-use defects fixed and uploaded

- `dd4c3c4`: `ssh_execute_sudo` stripped the initial sudo token and turned `sudo -u postgres ...` into an invalid shell command. Preserve the original command. The actual MCP call now returns the postgres account; a plain elevated command returns uid 0.
- `912d073`: PostgreSQL export produced plain SQL although restore promised replacement of existing objects. Importing into the original database failed with an existing-relation error. Export now uses a custom archive; restore detects PGDMP and invokes `pg_restore --clean --if-exists --exit-on-error`. Plain SQL retains its legacy psql path. Actual dump/import and backup/create/restore into the existing database succeeded; SELECT confirmed the original row after each restore. The legacy plain-SQL path was not separately revalidated.
- Earlier `544cb3a`/`d941131`: native Windows PowerShell module selection uses the invoked PowerShell's own modules rather than incompatible inherited module paths. Earlier native hour evidence is in [the limited hour report](UNATTENDED-HOUR-ACCEPTANCE.md); it is not evidence for the final source.

## Actual coverage

All **39 exposed MCP tool names** were invoked, as were all five workflow prompts and the operation guide. This is name-level coverage, not a claim that every option, failure mode, security mode or OS combination passed.

- Verified identities, actual accounts/permissions and relay protocol 2 on both hosts; normal restart retained pairing and automatically reconnected both hosts with the final database job hash.
- Commands, Linux sudo target-user options and the existing elevated Windows token; actual outputs and exit status inspected.
- Upload/download on both hosts: 131096-byte payload, SHA-256 `38db3d5f7dbbc38978c62e46dc97181dad74c4ce555d1739e1e6cd2c29aea9b8`, exact local round-trip comparison.
- Directory synchronization, dry run, checksum and exclusions; read destination contents and checked excluded file absence. Deployment replacement and existing-file backups were inspected.
- Persistent sessions retained cwd and environment after MCP client and far-Agent restarts. A newly opened session was closed and a subsequent send was refused.
- File backup/create/list/restore on both OSes; actual recurring backups produced by cron and Windows Task Scheduler, including after restart.
- PostgreSQL and MySQL on Linux, MongoDB on Windows: real database list/query/export/import. PostgreSQL and MySQL database backups; PostgreSQL backup restore after the fix. These are not every engine on every OS.
- Local forwarding on both OSes, Windows SOCKS5 and Windows remote forwarding through the controller to Linux: real HTTP responses inspected. Individual tunnel close checked.
- Parallel, sequential and rolling groups; group update/add/remove members; aliases and command aliases used for execution; profile list/current/switch; hooks list/status/disable/enable; history and pinned-key list/check/verify.
- Health, memory monitoring, service status, process list/info, log snapshot/bounded follow and alert get/set/check. Disk metrics return an empty list and are not validated. Alerts are on demand, not a background notification daemon.
- Linux command timeout returned EXEC_TIMEOUT/SIGTERM with no completion marker. Windows cancellation returned state cancelled, cancelRequested=true, no cancellation error and no completion marker. All three owned sessions and all four tunnel listeners were closed successfully.

Both hosts were explicitly disconnected and reconnected through MCP; both returned connected=true, and MySQL/MongoDB queries subsequently returned the original data. Temporary VM launching now requires workflow_dispatch rather than a push trigger.

## Limits and observations

Windows image service-start and missing-client issues were handled as environment prerequisites, without product patches. Windows PostgreSQL/MongoDB preinstalled services were not repaired. MongoDB was run as an ordinary owned process with the official database tools. VM Git authentication was not changed.

One earlier parallel read-only MySQL query returned CONTROL_TIMEOUT; the saved operation was inspected before a read-only retry succeeded. Deliberate Agent restarts returned CONTROL_CLOSED, followed by automatic reconnection and original-operation inspection. These are not zero-error results.

After a successful session close, session listing reintroduced the saved closed record as `unknown`; sending another command correctly returned SESSION_UNAVAILABLE. This status-display behavior remains recorded, not fixed or counted as a clean session-list pass. No claim of exhaustive all-function acceptance is made. GUI, Windows 10, five simultaneous real computers, large/interrupted transfer recovery, all privilege/security modes, destructive process termination and every backup variant remain outside this run.

## Final ten-minute window

Started 2026-10-22 09:06:14 UTC after both hosts advertised the final source hash. Ended 2026-10-22T09:16:32.471Z; elapsed 618 seconds, 69 direct MCP calls in the window. Both final connections reported connected=true; final PostgreSQL SELECT returned the original row. The only isError responses in this window were the deliberately closed-session send, deliberately timed-out Linux command and deliberately cancelled Windows command. Owned schedules were removed before disposing of the VMs. This is active debugging with intentional operations, not an unattended one-hour stability certification.
