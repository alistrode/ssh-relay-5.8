// Tool names, descriptions and schemas preserved from stable-near-far@b724289 src/index.js.
import { z } from "zod";
const DEFAULT_BACKUP_DIR = "~/.relay-mcp/backups";
export const catalog = [
  {
    name: "ssh_execute",
    config: {
      description:
        "Runs a shell command over SSH on a named configured server and returns stdout, stderr, and exit code. Mutates remote state depending on the command; not read-only. Expands command aliases before running. Uses the cwd parameter or, if omitted, the server configured default directory; adapts syntax for Linux versus Windows PowerShell targets. Timeout defaults to 120000 ms and is capped at 300000 ms. Under readonly mode destructive commands like rm or dd are refused; under restricted mode the command must match allow patterns. Output is truncated when very large.",
      inputSchema: {
        server: z.string().describe("Server name from configuration"),
        command: z.string().describe("Command to execute"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory (optional, uses default if configured)"),
        timeout: z
          .number()
          .optional()
          .describe(
            "Command timeout in milliseconds (default: 120000, max: 300000)",
          ),
      },
    },
  },
  {
    name: "ssh_upload",
    config: {
      description:
        "Uploads one local file to a remote destination path over SFTP on the named server, overwriting any existing remote file at that path. Mutates remote state and is not idempotent beyond replacing the target. Creates no backup. Requires the local file to exist. Does not use sudo, so the remote path must be writable by the configured SSH user. This tool is blocked entirely on servers set to readonly or restricted security mode. For directory trees use ssh_sync instead.",
      inputSchema: {
        server: z.string().describe("Server name"),
        localPath: z.string().describe("Local file path"),
        remotePath: z.string().describe("Remote destination path"),
      },
    },
  },
  {
    name: "ssh_download",
    config: {
      description:
        "Downloads one remote file from the named server to a local destination path over SFTP, overwriting any existing local file at that path. Affects only the local filesystem and is read-only on the remote side, so it stays allowed even on servers in readonly or restricted security mode. Reads the remote file using the configured SSH user, which must have permission to read it. Handles single files only; use ssh_sync for directories.",
      inputSchema: {
        server: z.string().describe("Server name"),
        remotePath: z.string().describe("Remote file path"),
        localPath: z.string().describe("Local destination path"),
      },
    },
  },
  {
    name: "ssh_sync",
    config: {
      description:
        "Synchronizes files or directories between local and remote using rsync over SSH on the named server. Each of source and destination must carry a local: or remote: prefix and one side must be local and the other remote; with no prefix it assumes a push from local to remote. On Windows MCP hosts, provide native Windows local paths such as C:\\project or .\\project; the tool converts drive-letter and UNC paths to MSYS2 format before spawning rsync. Do not pre-convert a local path to /c/project because Node performs local filesystem checks using Windows path semantics. Mutates the destination. Setting delete true removes destination files absent from source, which is destructive; dryRun true previews without changing anything. Compression is on by default. Password authentication requires sshpass installed locally. Blocked on readonly or restricted servers. Timeout defaults to 30000 ms.",
      inputSchema: {
        server: z.string().describe("Server name from configuration"),
        source: z
          .string()
          .describe(
            'Source path with a "local:" or "remote:" prefix. On Windows, use a native local path such as "local:C:\\project" or "local:.\\project"; do not pre-convert it to MSYS2 /c/... syntax.',
          ),
        destination: z
          .string()
          .describe(
            'Destination path with a "local:" or "remote:" prefix. On Windows, use a native local path such as "local:C:\\output" or "local:.\\output"; do not pre-convert it to MSYS2 /c/... syntax.',
          ),
        exclude: z
          .array(z.string())
          .optional()
          .describe("Patterns to exclude from sync"),
        dryRun: z
          .boolean()
          .optional()
          .describe("Perform dry run without actual changes"),
        delete: z
          .boolean()
          .optional()
          .describe("Delete files in destination not in source"),
        compress: z.boolean().optional().describe("Compress during transfer"),
        verbose: z.boolean().optional().describe("Show detailed progress"),
        checksum: z
          .boolean()
          .optional()
          .describe("Use checksum instead of timestamp for comparison"),
        timeout: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default: 30000)"),
      },
    },
  },
  {
    name: "ssh_tail",
    config: {
      description:
        "Reads the tail of a remote log file on the named server, optionally filtered by a grep pattern. Read-only; it does not modify remote state. Behavior depends on follow, which defaults to true: in follow mode it starts a streaming tail whose output is written to the server process stderr rather than returned, and the response only reports a session note, so to capture content directly set follow to false to get the last N lines back. The lines parameter defaults to 10.",
      inputSchema: {
        server: z.string().describe("Server name from configuration"),
        file: z.string().describe("Path to the log file to tail"),
        lines: z
          .number()
          .optional()
          .describe("Number of lines to show initially (default: 10)"),
        follow: z
          .boolean()
          .optional()
          .describe("Follow file for new content (default: true)"),
        grep: z.string().optional().describe("Filter lines with grep pattern"),
      },
    },
  },
  {
    name: "ssh_monitor",
    config: {
      description:
        "Collects a read-only snapshot of system resources on the named Linux server by running inspection commands such as top, free, df, ss, and ps. The type parameter selects the view and defaults to overview; other values are cpu, memory, disk, network, and process. Does not change remote state and needs no sudo. The interval and duration parameters are accepted for continuous monitoring intent but a single snapshot is gathered. Targets Linux tooling, so output may be empty on Windows hosts.",
      inputSchema: {
        server: z.string().describe("Server name from configuration"),
        type: z
          .enum(["overview", "cpu", "memory", "disk", "network", "process"])
          .optional()
          .describe("Type of monitoring (default: overview)"),
        interval: z
          .number()
          .optional()
          .describe("Update interval in seconds for continuous monitoring"),
        duration: z
          .number()
          .optional()
          .describe("Duration in seconds for continuous monitoring"),
      },
    },
  },
  {
    name: "ssh_history",
    config: {
      description:
        "Returns the in-memory log of SSH commands previously run through this server process during the current session, formatted with timestamps, server, duration, and success status. Purely local and read-only: it opens no SSH connection and does not persist across restarts. Optional filters narrow the results by server name, by success or failure, and by a search substring in the command text; limit defaults to 20 most recent entries. Does not expose command output, only the commands and their outcomes.",
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe("Number of commands to show (default: 20)"),
        server: z.string().optional().describe("Filter by server name"),
        success: z.boolean().optional().describe("Filter by success/failure"),
        search: z.string().optional().describe("Search in commands"),
      },
    },
  },
  {
    name: "ssh_session_start",
    config: {
      description:
        "Opens a new persistent interactive shell on the named configured server and returns a generated session ID. Stateful and side-effecting: it establishes (or reuses pooled) SSH connection and keeps an open shell that preserves working directory, environment, and command history across later ssh_session_send calls, unlike one-shot ssh_execute. The optional name is only a human label. The session stays open and consumes a remote shell until ssh_session_close is called.",
      inputSchema: {
        server: z.string().describe("Server name from configuration"),
        name: z
          .string()
          .optional()
          .describe("Optional session name for identification"),
      },
    },
  },
  {
    name: "ssh_session_send",
    config: {
      description:
        "Runs one command inside an already-open session identified by its session ID, reusing the persisted working directory, environment, and history of that shell. Mutates remote state like any shell command and is not idempotent; cd and export update the saved context for subsequent calls. Commands run through a bash-style shell (Unix-oriented). The security policy of the underlying server is enforced, so readonly or restricted servers may refuse. Default timeout is 30000 ms.",
      inputSchema: {
        session: z.string().describe("Session ID from ssh_session_start"),
        command: z.string().describe("Command to execute in the session"),
        timeout: z
          .number()
          .optional()
          .describe("Command timeout in milliseconds (default: 30000)"),
      },
    },
  },
  {
    name: "ssh_session_list",
    config: {
      description:
        "Lists currently active SSH sessions with their ID, server, state, working directory, command count, age, idle time, and any defined variables. Read-only: it inspects in-memory session state and changes nothing on remote hosts or local config. The optional server argument is a case-insensitive substring filter on server name; omit it to list every active session. Closed sessions are excluded from the results.",
      inputSchema: {
        server: z.string().optional().describe("Filter by server name"),
      },
    },
  },
  {
    name: "ssh_session_close",
    config: {
      description:
        "Terminates an open SSH session given its session ID, writing exit to the remote shell, ending it, and discarding its in-memory history and context; the session ID becomes unusable afterward. Destructive to session state but does not delete remote files. Passing the literal value all closes every active session at once, ignoring individual close errors. It does not drop the pooled underlying connection, only the interactive shell.",
      inputSchema: {
        session: z
          .string()
          .describe('Session ID to close (or "all" to close all sessions)'),
      },
    },
  },
  {
    name: "ssh_execute_group",
    config: {
      description:
        "Runs one command on every server belonging to the named group and returns a per-server success or failure report. Members come from the groups defined with ssh_group_manage plus every server whose configuration carries a matching group field, so a group can exist through the config alone. Mutates remote state on each member and is not idempotent. Best-effort: the security policy of each server is evaluated independently, so readonly or restricted members are reported as failed without aborting the rest unless stopOnError is set. Strategy may be parallel, sequential, or rolling (delay applies between servers). Per-server timeout is 30000 ms; cwd defaults to the default_dir of each server.",
      inputSchema: {
        group: z
          .string()
          .describe('Group name (e.g., "production", "staging", "all")'),
        command: z.string().describe("Command to execute"),
        strategy: z
          .enum(["parallel", "sequential", "rolling"])
          .optional()
          .describe("Execution strategy"),
        delay: z
          .number()
          .optional()
          .describe("Delay between servers in ms (for rolling)"),
        stopOnError: z
          .boolean()
          .optional()
          .describe("Stop execution on first error"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
  },
  {
    name: "ssh_group_manage",
    config: {
      description:
        "Creates, updates, deletes, and inspects named server groups used by ssh_execute_group, persisting changes to local configuration only with no remote side effects. The action selects the operation: create, update, delete, add-servers, remove-servers, or list. Every action except list requires name; add-servers and remove-servers also require a non-empty servers array. list is read-only and also reports the groups derived from the per-server group field of the SSH configuration, which are read-only here and change only by editing that configuration. Optional strategy, delay, and stopOnError set default group execution behavior.",
      inputSchema: {
        action: z
          .enum([
            "create",
            "update",
            "delete",
            "list",
            "add-servers",
            "remove-servers",
          ])
          .describe("Action to perform"),
        name: z.string().optional().describe("Group name"),
        servers: z.array(z.string()).optional().describe("Server names"),
        description: z.string().optional().describe("Group description"),
        strategy: z
          .enum(["parallel", "sequential", "rolling"])
          .optional()
          .describe("Execution strategy"),
        delay: z.number().optional().describe("Delay between servers in ms"),
        stopOnError: z.boolean().optional().describe("Stop on error flag"),
      },
    },
  },
  {
    name: "ssh_list_servers",
    config: {
      description:
        "Lists all SSH servers defined in the loaded configuration, returning for each the name, host, user, port, authentication type (password or key), default directory, group, and description. Read-only and local: it reads configuration only and opens no SSH connections. Deliberately omits secrets, so no passwords, key paths, passphrases, or sudo passwords are returned. Takes no parameters. Useful as a first call to discover which server names other tools accept.",
      inputSchema: {},
    },
  },
  {
    name: "ssh_deploy",
    config: {
      description:
        "Deploys a list of local files to remote paths on the named server, uploading each to a temporary location first and then moving it into place. Mutates remote state. By default it backs up any existing target file before overwriting; backup can be disabled per call. Options can set owner and permissions, supply a sudo password, and name a single service to restart afterward. Detects sensible owner and permission defaults from the remote path. Runs pre and post deploy hooks. Blocked entirely on servers in readonly or restricted security mode.",
      inputSchema: {
        server: z.string().describe("Server name or alias"),
        files: z
          .array(
            z.object({
              local: z.string().describe("Local file path"),
              remote: z.string().describe("Remote file path"),
            }),
          )
          .describe("Array of files to deploy"),
        options: z
          .object({
            owner: z
              .string()
              .optional()
              .describe('Set file owner (e.g., "user:group")'),
            permissions: z
              .string()
              .optional()
              .describe('Set file permissions (e.g., "644")'),
            backup: z
              .boolean()
              .optional()
              .default(true)
              .describe("Backup existing files"),
            restart: z
              .string()
              .optional()
              .describe("Service to restart after deployment"),
            sudoPassword: z
              .string()
              .optional()
              .describe("Sudo password if needed (use with caution)"),
          })
          .optional()
          .describe("Deployment options"),
      },
    },
  },
  {
    name: "ssh_execute_sudo",
    config: {
      description:
        "Runs a command with elevated privileges via sudo on the named server and returns the exit code and output. Prepends sudo when absent. If a password is given, or a sudo password is configured for the server, it is piped to sudo -S and masked in the returned output. Mutates remote state and can be destructive. Honors the cwd parameter or the server default directory and adapts to Linux or Windows. Timeout defaults to 30000 ms. Blocked entirely in readonly mode; in restricted mode the command must satisfy the allow and deny patterns.",
      inputSchema: {
        server: z.string().describe("Server name or alias"),
        command: z.string().describe("Command to execute with sudo"),
        password: z
          .string()
          .optional()
          .describe("Sudo password (will be masked in output)"),
        cwd: z.string().optional().describe("Working directory"),
        timeout: z
          .number()
          .optional()
          .describe("Command timeout in milliseconds (default: 30000)"),
      },
    },
  },
  {
    name: "ssh_command_alias",
    config: {
      description:
        "Manages local shorthand aliases that map a short name to a full command string, stored in local config with no remote execution or side effects. The action selects behavior: add (requires both alias and command), remove (requires alias), list to show all aliases tagged as profile or custom, or suggest to return existing aliases matching a search term passed in the command field. Adding an existing alias overwrites it.",
      inputSchema: {
        action: z
          .enum(["add", "remove", "list", "suggest"])
          .describe("Action to perform"),
        alias: z.string().optional().describe("Alias name (for add/remove)"),
        command: z
          .string()
          .optional()
          .describe("Command to alias (for add) or search term (for suggest)"),
      },
    },
  },
  {
    name: "ssh_hooks",
    config: {
      description:
        "Manages automation hooks that fire around SSH operations such as pre-deploy, toggling them on or off in local configuration only with no immediate remote action. The action selects behavior: list shows each hook with its enabled state, description, and action count; enable and disable flip a hook and both require the hook name; status summarizes which hooks are currently enabled versus disabled. Toggling persists and affects later operations.",
      inputSchema: {
        action: z
          .enum(["list", "enable", "disable", "status"])
          .describe("Action to perform"),
        hook: z.string().optional().describe("Hook name (for enable/disable)"),
      },
    },
  },
  {
    name: "ssh_profile",
    config: {
      description:
        "Manages SSH Manager profiles that bundle command aliases and hooks for different project types, affecting local configuration only with no remote side effects. The action selects behavior: list shows available profiles and the active one, current shows the active profile details, and switch activates a named profile and requires the profile argument. A successful switch reports that Claude Code must be restarted before the new profile takes effect.",
      inputSchema: {
        action: z
          .enum(["list", "switch", "current"])
          .describe("Action to perform"),
        profile: z.string().optional().describe("Profile name (for switch)"),
      },
    },
  },
  {
    name: "ssh_connection_status",
    config: {
      description:
        "Inspects and manages the pooled SSH connections held by this server process; affects only local in-memory connections, never remote state. The action parameter selects: status lists active connections with age and keepalive (read-only); reconnect closes then reopens one connection; disconnect closes one connection; cleanup drops aged-out and dead connections. The server parameter is required for reconnect and disconnect and ignored otherwise.",
      inputSchema: {
        action: z
          .enum(["status", "reconnect", "disconnect", "cleanup"])
          .describe("Action to perform"),
        server: z
          .string()
          .optional()
          .describe("Server name (for reconnect/disconnect)"),
      },
    },
  },
  {
    name: "ssh_tunnel_create",
    config: {
      description:
        "Opens a new SSH connection to the named server and starts a port-forwarding or SOCKS proxy tunnel that keeps running until closed. The type parameter selects local forward, remote forward, or dynamic SOCKS5 proxy. localPort is always required; remoteHost and remotePort are required for local and remote types but ignored for dynamic. localHost defaults to 127.0.0.1. Returns a tunnel ID used later to close it.",
      inputSchema: {
        server: z.string().describe("Server name or alias"),
        type: z.enum(["local", "remote", "dynamic"]).describe("Tunnel type"),
        localHost: z
          .string()
          .optional()
          .describe("Local host (default: 127.0.0.1)"),
        localPort: z.number().describe("Local port"),
        remoteHost: z
          .string()
          .optional()
          .describe("Remote host (not needed for dynamic)"),
        remotePort: z
          .number()
          .optional()
          .describe("Remote port (not needed for dynamic)"),
      },
    },
  },
  {
    name: "ssh_tunnel_list",
    config: {
      description:
        "Lists currently active SSH tunnels tracked by this process, showing each tunnel ID, server, type, state, local and remote endpoints, active and total connection counts, bytes transferred, error count, and timestamps. Read-only: it does not create, modify, or close anything. The optional server parameter filters results to one server; omit it to list every active tunnel across all servers.",
      inputSchema: {
        server: z.string().optional().describe("Filter by server name"),
      },
    },
  },
  {
    name: "ssh_tunnel_close",
    config: {
      description:
        "Tears down active SSH tunnels created earlier, freeing the bound local ports; this affects only local tunnel state, not the remote host. Exactly one of tunnelId or server must be supplied: tunnelId closes that single tunnel, while server closes every tunnel for the named server and reports how many were closed. Supplying neither raises an error. Closing is final and cannot be undone.",
      inputSchema: {
        tunnelId: z.string().optional().describe("Tunnel ID to close"),
        server: z
          .string()
          .optional()
          .describe("Close all tunnels for this server"),
      },
    },
  },
  {
    name: "ssh_key_manage",
    config: {
      description:
        "Manages SSH host key fingerprints in your local known_hosts file for the named server. The action parameter selects: verify, check, and list are read-only comparisons or listings; accept adds or updates the host key in known_hosts; remove deletes it. accept and remove mutate local state and are blocked on servers configured as readonly. server is required for every action except list. autoAccept defaults to false and should be used with caution.",
      inputSchema: {
        action: z
          .enum(["verify", "accept", "remove", "list", "check"])
          .describe("Action to perform"),
        server: z
          .string()
          .optional()
          .describe("Server name (required for most actions)"),
        autoAccept: z
          .boolean()
          .optional()
          .describe("Automatically accept new keys (use with caution)"),
      },
    },
  },
  {
    name: "ssh_alias",
    config: {
      description:
        "Manages local name aliases that let you reference a configured server by a shorter or alternative name. The action parameter selects add, remove, or list. add creates an alias pointing to an existing server and requires both alias and server; remove deletes an alias and requires alias; list shows all aliases (read-only). add and remove persist the alias mapping locally. The target server must already exist for add to succeed.",
      inputSchema: {
        action: z.enum(["add", "remove", "list"]).describe("Action to perform"),
        alias: z.string().optional().describe("Alias name (for add/remove)"),
        server: z.string().optional().describe("Server name (for add)"),
      },
    },
  },
  {
    name: "ssh_backup_create",
    config: {
      description:
        "Creates a database or file backup on the remote server over SSH, writing a compressed archive plus a JSON metadata file into backupDir. Supports mysql, postgresql, mongodb, and files (full is not yet implemented and errors). Database types require database; files requires paths. After writing it prunes backups older than retention days (default 7); compress defaults to true. Runs pre-backup and post-backup hooks.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb", "files", "full"])
          .describe("Backup type: mysql, postgresql, mongodb, files, or full"),
        name: z.string().describe("Backup name (e.g., production, app-data)"),
        database: z
          .string()
          .optional()
          .describe("Database name (required for db types)"),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
        paths: z
          .array(z.string())
          .optional()
          .describe("Paths to backup (for files type)"),
        exclude: z
          .array(z.string())
          .optional()
          .describe("Patterns to exclude from backup"),
        backupDir: z
          .string()
          .optional()
          .describe(`Backup directory (default: ${DEFAULT_BACKUP_DIR})`),
        retention: z
          .number()
          .optional()
          .describe("Retention period in days (default: 7)"),
        compress: z
          .boolean()
          .optional()
          .describe("Compress backup (default: true)"),
      },
    },
  },
  {
    name: "ssh_backup_list",
    config: {
      description:
        "Lists existing backups found in backupDir on the remote server, returning each backup id, type, database or paths, size, compression, retention, status, and creation time parsed from stored metadata. Read-only: it inspects the filesystem and mutates nothing. Optional type filters results to mysql, postgresql, mongodb, files, or full. backupDir defaults to the configured backup directory.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb", "files", "full"])
          .optional()
          .describe("Filter by backup type"),
        backupDir: z
          .string()
          .optional()
          .describe(`Backup directory (default: ${DEFAULT_BACKUP_DIR})`),
      },
    },
  },
  {
    name: "ssh_backup_restore",
    config: {
      description:
        "Restores a previously created backup identified by backupId, reading its metadata to pick the engine. This is destructive and overwrites the target: PostgreSQL runs pg_restore with --clean --if-exists which DROPs existing objects, MongoDB runs mongorestore --drop, and MySQL pipes the dump into the live database replacing matching objects. Supports mysql, postgresql, mongodb, and files. Runs pre-restore and post-restore hooks.",
      inputSchema: {
        server: z.string().describe("Server name"),
        backupId: z.string().describe("Backup ID to restore"),
        database: z
          .string()
          .optional()
          .describe("Target database name (for db restores)"),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
        targetPath: z
          .string()
          .optional()
          .describe("Target path for files restore (default: /)"),
        backupDir: z
          .string()
          .optional()
          .describe(`Backup directory (default: ${DEFAULT_BACKUP_DIR})`),
      },
    },
  },
  {
    name: "ssh_backup_schedule",
    config: {
      description:
        "Schedules a recurring backup on the remote server by writing an executable bash script to /usr/local/bin/ssh-manager-backup-NAME.sh and installing a crontab entry for the given cron expression. Mutates the remote filesystem and crontab, and typically needs root to write that path. Supports mysql, postgresql, mongodb, and files; the generated script also deletes backups older than retention days (default 7).",
      inputSchema: {
        server: z.string().describe("Server name"),
        schedule: z
          .string()
          .describe('Cron schedule (e.g., "0 2 * * *" for daily at 2 AM)'),
        type: z
          .enum(["mysql", "postgresql", "mongodb", "files"])
          .describe("Backup type"),
        name: z.string().describe("Backup name"),
        database: z
          .string()
          .optional()
          .describe("Database name (for db types)"),
        paths: z
          .array(z.string())
          .optional()
          .describe("Paths to backup (for files type)"),
        retention: z
          .number()
          .optional()
          .describe("Retention period in days (default: 7)"),
      },
    },
  },
  {
    name: "ssh_health_check",
    config: {
      description:
        "Runs a comprehensive read-only health check on the named server by executing diagnostic shell commands over SSH, then returns parsed JSON with overall status, CPU, memory, disk usage, and uptime. It only reads metrics and changes nothing on the remote host. Set detailed to true to additionally include load average and network metrics; it defaults to false. Critical CPU, memory, or disk conditions are surfaced in a critical_issues list.",
      inputSchema: {
        server: z.string().describe("Server name"),
        detailed: z
          .boolean()
          .optional()
          .describe("Include detailed metrics (network, load average)"),
      },
    },
  },
  {
    name: "ssh_service_status",
    config: {
      description:
        "Checks the running state of the named system services on a remote server by querying each one over SSH, returning JSON per service plus running and stopped counts and an aggregate health rating. Read-only: it inspects status without starting, stopping, or restarting anything. The services array parameter is required and lists the service names to check, for example nginx, mysql, or docker; common names are resolved to their actual unit names automatically.",
      inputSchema: {
        server: z.string().describe("Server name"),
        services: z
          .array(z.string())
          .describe("Service names to check (e.g., nginx, mysql, docker)"),
      },
    },
  },
  {
    name: "ssh_process_manager",
    config: {
      description:
        "Lists, inspects, or terminates processes on a remote server over SSH. The action parameter selects: list returns top processes (read-only), info returns details for one process (read-only), and kill sends a signal to terminate a process and mutates remote state. pid is required for kill and info. kill is blocked on servers configured as readonly. signal defaults to TERM, sortBy defaults to cpu, and limit defaults to 20; filter narrows the list by name or command.",
      inputSchema: {
        server: z.string().describe("Server name"),
        action: z
          .enum(["list", "kill", "info"])
          .describe(
            "Action: list processes, kill process, or get process info",
          ),
        pid: z
          .number()
          .optional()
          .describe("Process ID (required for kill and info actions)"),
        signal: z
          .enum(["TERM", "KILL", "HUP", "INT", "QUIT"])
          .optional()
          .describe("Signal to send when killing (default: TERM)"),
        sortBy: z
          .enum(["cpu", "memory"])
          .optional()
          .describe("Sort processes by CPU or memory (default: cpu)"),
        limit: z
          .number()
          .optional()
          .describe("Number of processes to return (default: 20)"),
        filter: z
          .string()
          .optional()
          .describe("Filter processes by name/command"),
      },
    },
  },
  {
    name: "ssh_alert_setup",
    config: {
      description:
        "Configures and evaluates CPU, memory, and disk usage alert thresholds for a remote server. The action parameter selects: set writes the threshold config to /etc/ssh-manager-alerts.json on the remote host (mutating, may need write access to /etc, and is blocked on readonly servers); get reads back that config; check reads current metrics and compares them to stored thresholds. get and check are read-only. enabled defaults to true; check errors if no config exists yet.",
      inputSchema: {
        server: z.string().describe("Server name"),
        action: z
          .enum(["set", "get", "check"])
          .describe(
            "Action: set thresholds, get config, or check current metrics against thresholds",
          ),
        cpuThreshold: z
          .number()
          .optional()
          .describe("CPU usage threshold percentage (e.g., 80)"),
        memoryThreshold: z
          .number()
          .optional()
          .describe("Memory usage threshold percentage (e.g., 90)"),
        diskThreshold: z
          .number()
          .optional()
          .describe("Disk usage threshold percentage (e.g., 85)"),
        enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable alerts (default: true)"),
      },
    },
  },
  {
    name: "ssh_db_dump",
    config: {
      description:
        "Dumps a database to a file on the remote server over SSH; it reads data only and does not modify the database. Supports mysql (using --single-transaction --routines --triggers), postgresql (custom format with --clean --if-exists, restorable via pg_restore), and mongodb. compress defaults to true and gzips the output. The optional tables list applies to MySQL and PostgreSQL only and is ignored for MongoDB.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb"])
          .describe("Database type"),
        database: z.string().describe("Database name"),
        outputFile: z
          .string()
          .describe("Output file path (will be created on remote server)"),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
        compress: z
          .boolean()
          .optional()
          .describe("Compress output with gzip (default: true)"),
        tables: z
          .array(z.string())
          .optional()
          .describe("Specific tables to dump (MySQL/PostgreSQL only)"),
      },
    },
  },
  {
    name: "ssh_db_import",
    config: {
      description:
        "Imports a dump file into a target database on the remote server and is destructive to existing data. PostgreSQL uses pg_restore --clean --if-exists which DROPs existing objects before loading; MongoDB uses mongorestore with --drop controlled by the drop flag (default true); MySQL pipes the file into the live database, replacing objects defined in it. Supports mysql, postgresql, mongodb. Compressed .gz inputs are decompressed automatically.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb"])
          .describe("Database type"),
        database: z.string().describe("Target database name"),
        inputFile: z.string().describe("Input file path (on remote server)"),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
        drop: z
          .boolean()
          .optional()
          .describe(
            "Drop existing collections/tables before import (MongoDB only, default: true)",
          ),
      },
    },
  },
  {
    name: "ssh_db_list",
    config: {
      description:
        "Lists database objects on the remote server for the given engine without modifying anything. When database is provided it lists the tables (SQL) or collections (MongoDB) of that database; when omitted it lists all databases with common system databases filtered out. Supports mysql, postgresql, and mongodb. Returns the items and a count. Read-only and safe to call repeatedly.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb"])
          .describe("Database type"),
        database: z
          .string()
          .optional()
          .describe(
            "Database name (if provided, lists tables/collections; if omitted, lists databases)",
          ),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
      },
    },
  },
  {
    name: "ssh_db_query",
    config: {
      description:
        "Runs a read-only query against a remote database. For mysql and postgresql it is strictly limited to SELECT: the query must begin with SELECT and any insert, update, delete, drop, create, alter, truncate, grant, revoke, or exec keyword is rejected before execution. For mongodb it runs a find() and requires the collection parameter. Returns the raw command output as text.",
      inputSchema: {
        server: z.string().describe("Server name"),
        type: z
          .enum(["mysql", "postgresql", "mongodb"])
          .describe("Database type"),
        database: z.string().describe("Database name"),
        query: z
          .string()
          .describe("SQL query (SELECT only) or MongoDB find query"),
        collection: z
          .string()
          .optional()
          .describe("Collection name (MongoDB only)"),
        dbUser: z.string().optional().describe("Database user"),
        dbPassword: z.string().optional().describe("Database password"),
        dbHost: z
          .string()
          .optional()
          .describe("Database host (default: localhost)"),
        dbPort: z.number().optional().describe("Database port"),
      },
    },
  },
];
