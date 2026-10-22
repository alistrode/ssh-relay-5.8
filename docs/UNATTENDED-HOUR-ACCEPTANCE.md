# Unattended one-hour acceptance — 2026-10-21

Requested branch: `fix/ssh-pro-startup-20261019`.

Completed historical attempt: https://github.com/trlstdin/rororororo/actions/runs/39613605609

Tested commit: `d9411314dc52d08cd79856ef483675a81584c872`.
Result: **the limited SSH/SFTP hour passed on both native platforms**. This is not all-function or all-AI acceptance.

| Platform | Measured seconds | SSH/SFTP samples | Active ticks | Unexpected events | Manual interventions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ubuntu 24.04 | 3618.504994131 | 147 | 242 | 0 | 0 |
| Windows Server 2022 | 3622.1762712 | 140 | 243 | 0 | 0 |

Windows measured 2026-10-21 14:06:38.957–15:07:01.203 UTC; Linux measured 14:05:47.635–15:06:06.140 UTC. Native Actions artifacts contain the original sanitized reports.

## Latest user direction

Do not run test suites or change the product to accommodate VM-only setup problems. The added scripted all-AI suite and database fixture have been removed, and automatic native-suite triggering has been disabled. The subsequent work uses normal Agents on leased Actions VMs and actual MCP calls selected individually by the AI operator. No all-AI pass is claimed. The Windows PowerShell module compatibility fix addresses a real normal-launch path; fixture-only problems do not establish product bugs.

## Scope and pass criteria

- Fresh GitHub-hosted Ubuntu 24.04 and Windows Server 2022 VMs, fixed Node 24.22.0 and lockfile production dependencies.
- Native preflight: detached tasks, cancellation, timeout, persistent shells, shared execution budget and file transfers.
- Fresh owned near/far identities on each VM; real public EMQX WSS relay, pinned SSH host identity. No existing user devices or credentials.
- At least 3,600 continuous seconds after both long SSH connections are established and initial SSH/SFTP probes pass. A monotonic clock measures the interval.
- One active SSH channel and one idle SSH channel remain open throughout, with client keepalive disabled. Repeated new SSH commands and 64 KiB SFTP round trips must all succeed with exact contents.
- Unexpected worker exits/restarts, MQTT offline, loss of online status, heartbeat stalls, transport errors, command failures, changed application source or content mismatches fail the attempt. No manual repair or resumed accumulation during the measured interval.
- Upload only `stability-results/result.json`, including platform, source hash, tested SHA, times, samples and outcome. No private profiles, connection reports, pairing codes or raw logs are artifacts or Git contents.

Windows Server 2022 is **not Windows 10**. This attempt cannot certify Windows 10, GUI installation/autostart, cross-VM Windows/Linux interoperability, five real user devices, or real database/sudo positive scenarios.

## Patches and earlier attempts

Earlier attempts failed before Windows measurement began or were cancelled; none counts toward the final hour. That historical fixture restricted only its newly created Windows temporary directory using `icacls`, without changing existing profiles or system permissions.

Native PowerShell 5.1 ACL inspection failed under the PowerShell 7 module search environment inherited from Actions. Production patch `544cb3a`, completed in `d941131`, explicitly imports the matching security and JSON utility modules from the invoked PowerShell's own `$PSHOME`. Existing ACL rejection rules remain intact. That historical Windows harness checked its private fixture and deliberately shared child directory; the harness was later removed at the user’s request.

The Linux private-state regression passed locally. Separate historical native preflight run: https://github.com/trlstdin/rororororo/actions/runs/39613605836 . The completed limited-hour results are recorded above. The later final-source debugging uses the user-requested ten-minute window; see [direct MCP debugging](DIRECT-MCP-DEBUG-20261022.md).
