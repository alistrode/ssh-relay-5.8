# 5.7 lifecycle repair and runtime observations

The isolated Windows 5.7 installation is now running and has been reached through its own protocol-57 connection. The existing 5.4 installation, profile and processes were preserved. The 5.4 channel was used only for bootstrap and controlled 5.7 maintenance; ordinary verification used 5.7. No 5.6 connection was used.

## Failure and repair

The original 5.7 Guardian logged `clientActive:false` and stopped its Agent while the GUI remained running. Desktop liveness had required a heartbeat newer than 15 seconds. Startup and event-loop stalls could expire that heartbeat, destroying the backend and leaving the window repeatedly requesting a closed loopback endpoint. The old GUI also trusted the continued existence of `agent-runtime.json`, which did not establish that its service was still listening.

Desktop liveness now requires a desired, non-stopping session with both its supervisor and client processes still alive. Heartbeat age remains observable but does not itself order backend destruction. Actual client exit and explicit tray shutdown retain their lifecycle behavior. GUI heartbeat calls are coalesced so a delayed response does not accumulate concurrent requests. Disabled roles remain disabled and do not start backends merely to display status.

A failed status request now returns configured local state plus a service failure, instead of repeatedly presenting an indistinguishable startup state. The affected role exposes an explicit restore-service action. This does not replay commands, reconnect an otherwise healthy device, or restart unrelated components.

Windows child creation and bootstrap-log opening for a Guardian now run in a short-lived Worker rather than Electron's main thread. The Worker reports the actual spawn result, preserves the private profile and inherited runtime environment, and never retries a failed spawn implicitly.

Known terminal command outcomes, including cancellation and command failure, no longer carry connection-recovery instructions. They retain their actual operation IDs, terminal state and exit result. Pending or uncertain work still requires inspection through its saved identifiers.

Renderer/preload diagnostics no longer truncate messages or stacks; nested causes and AggregateError stacks are preserved. Guardian console records no longer cut the tail at 500 characters. Existing redaction, sequence numbers, compressed archives and retention warnings remain in place.

## Actual observations on the designated Windows 11 computer

The application ran in the user's interactive Acer session, not SYSTEM, from the independent 5.7 directory. Its own SSH connection verified the same hostname, account and pinned host identity. The runtime reported Windows 11 25H2, build 26200.9711. A native PrintWindow capture showed the actual rendered application and an online connection; private captures were deleted after inspection.

Manual operation checks:

- A real command returned the expected account, hostname and marker with exit 0.
- A running persistent command was cancelled through its original operation ID. Its terminal result was `cancelled`, and its final marker did not execute. A subsequent new command completed successfully.
- A deliberate ordinary command error returned a failed task, without closing the GUI or prompting connection recovery. A later command again completed with exit 0.
- A rejected IPC request left the same renderer responsive. Both role queries then completed in about 2–3.3 ms.
- A 65,536-byte upload and download through the original MCP file tools completed and compared byte-for-byte equal.
- A local Windows liveness probe advanced its own clock by 60 seconds while checking the real session. The session remained active. This did not block or change the user's GUI.
- A 20,016-character renderer stack retained its final marker in the actual Windows log. An Error cause retained both outer and inner messages and the cause separator.
- A separate standalone Linux cloud package started both roles using its bundled Node and contained production dependencies, without ancestor module resolution. That verification profile was outside the package and was stopped afterward.

The final continuous status observation is recorded in `5.7-RUNTIME-OBSERVATIONS.json`. It measures actual renderer-to-Agent requests; it does not measure Internet round-trip latency.

Build and syntax checks passed. No project test suite was created or run. Automated publication workflows are manual entry points; pushing this branch does not publish an independently built release automatically.

## Bounds and remaining work

The final Windows launch still took about 11.13 seconds from `window_create` to `window_paint_ready`. Its startup logs retained GUI stalls of about 4.56 and 4.96 seconds and Agent initialization stalls. These are not erased or claimed fixed by the liveness repair. No later recurring stall or backend shutdown was observed during the recorded final observation window. A finite observation does not prove that every future freeze is eliminated.

The broader performance plan is not all complete: full asynchronous logging, remaining synchronous target-process identity queries, early Agent control readiness, download hashing/pipelining, and the multi-pass shutdown process scan still need separate work and measurements. Existing changes recovered from the prior 5.7 candidate include independent role polling, cached self metadata, shared scheduling, terminal-session indexing, reused file Workers and bounded log-tail reads. This repair does not present all earlier draft observations as newly repeated Windows measurements.

Source was recovered from the designated machine's actual 5.7 application (the prior candidate identified itself as ae14860), over the existing 29a9742 maintenance baseline. Packaging and maintenance sources are included on this branch. Backups of the remote 5.7 source were made before both modification groups. No private profiles, pairing codes, raw logs or desktop images belong in the repository or packages.
