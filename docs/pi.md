# Pi Auto

Requires Pi with `registerVirtualModel` (interface checked against installed Pi 1.5.0). The extension is loaded explicitly and does not modify Pi files.

1. In Fairway **Settings**, add Pi profiles with exact `provider/model` IDs and supported efforts. Enable **I verified this pair in Pi** only after checking it yourself; this is operator attestation, not automatic discovery.
2. In **Pi Auto**, enable **Local Pi decision service**. It listens on `127.0.0.1` at an ephemeral port. The JEV key stays in Orca secret storage.
3. Load the extension from your cloned repository:

```sh
pi --extension /absolute/path/to/orca-fairway/adapters/pi.ts --model fairway/auto
```

4. Set a separately authorized brief:

```text
/fairway-brief A small Python utility with direct acceptance checks and no third-party dependencies.
```

5. Send the full task in Pi. Only the explicit brief goes to JEV. Expanded files and conversation history remain with Pi and its execution provider.

With `live: false`, the service returns an eligible fallback without JEV. A new decision consumes its explicit brief before routing, including when routing fails. Set a new brief to retry. Disabling the bridge cancels in-flight routing and removes its connection file. A provider request already received may still be billable. Once selected, the model and effort are pinned to the session branch; continuations, retries, and resumes do not reroute. Start a new session for a fresh choice. Pi may clamp effort to its supported values; inspect its response records for actual behavior.

The service has no agent-dispatch endpoint and is not a generation proxy. It limits request size/rate, rejects browser Origin headers, and requires a random local capability. Its own `~/.config/fairway-for-orca/connection.json` is created with mode 0600 and contains no OpenRouter key. The extension reads only that file, or an explicit `FAIRWAY_CONNECTION_FILE` path.

Disabling the service closes connections and removes its own file. A crash may leave a stale file, which blocks overwrite. Confirm the previous service has stopped before removing that file. The capability expires after 24 hours; restart the service to renew it. On Windows, control file ACLs through the OS; Unix mode checks do not apply.

`execution` controls the Orca dispatch button, not an already running Pi. Selecting `fairway/auto` explicitly authorizes that client to use the routing result; Pi retains its own tools and approvals. Do not use briefs that cannot be shared with OpenRouter.

Availability of this virtual model in native Orca chat is not verified. The extension is not automatically injected into all Pi launches.
