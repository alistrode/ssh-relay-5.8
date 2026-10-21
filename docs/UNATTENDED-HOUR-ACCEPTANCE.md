# Unattended one-hour acceptance — 2026-10-21

Requested branch: `fix/ssh-pro-startup-20261019`.

Current attempt: https://github.com/trlstdin/rororororo/actions/runs/39613605609

Tested commit: `d9411314dc52d08cd79856ef483675a81584c872`.
Status at this checkpoint: **running; no one-hour pass claimed**.

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

Earlier attempts failed before Windows measurement began or were cancelled; none counts toward the final hour. The fixture now restricts only its newly created Windows temporary directory using `icacls`, without changing existing profiles or system permissions.

Native PowerShell 5.1 ACL inspection failed under the PowerShell 7 module search environment inherited from Actions. Production patch `544cb3a`, completed in `d941131`, explicitly imports the matching security and JSON utility modules from the invoked PowerShell's own `$PSHOME`. Existing ACL rejection rules remain intact. The Windows harness must accept the private fixture and reject a deliberately shared child directory before starting the agents.

The Linux private-state regression passed locally. Separate native preflight run for the final source: https://github.com/trlstdin/rororororo/actions/runs/39613605836 . Final one-hour evidence is pending and must be recorded after completion, without substituting historical short tests.
