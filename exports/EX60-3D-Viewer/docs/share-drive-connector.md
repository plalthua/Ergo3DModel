# Share-drive log export

For manual MDF downloads, **NucLogger export** now opens
<https://log-analyzer.nuc.volvocars.net/> and offers automatic conversion on closure of
the local dialog. See [manual MDF workflow](../README.md#manual-nuc-mdf-download-and-automatic-replay-conversion).
An optional embedded view is provided with a new-tab fallback; its production
SSO/frame-policy compatibility has not been verified. Use the Analyzer's
**Export data... -> MDF4** download, not its server-side cache.
This needs no share configuration. The indexed share workflow below remains
available under **Optional indexed share-drive copy** in that dialog.

The local Python viewer server copies approved recordings from an accessible UNC
share, mapped drive, or local folder populated through NUC Drive downloads.
It uses Python's standard library and the Windows identity of the server process.
Azure Blob SDKs, Azure CLI and cloud credentials are no longer part of acquisition.

## NUC Drive website versus a mounted share

[NUC Drive](https://nuc.volvocars.net/tools/drive.html) is an internal web page.
It is **not** itself a filesystem path. It was inaccessible to the available web
tool, so neither its download API nor a corresponding UNC path has been verified.

- If IT provides an SMB/UNC or mapped share, confirm it opens in File Explorer
  under your normal Windows identity. Configure that actual path below.
- If access is only through the website, open it in your own browser, sign in
  normally and download a bounded, authorized recording selection into a local
  folder. Configure that folder below.
- Do not paste passwords, cookies or signed links into configuration or chat.
  The connector does not log into the website, extract browser credentials, map
  drives, change permissions or work around network/tool restrictions.

## Setup

No additional dependencies are needed. Under the ignored `data\logs\` directory,
create `share-drive.json` with the approved paths:

```json
{
  "root": "\\\\server\\approved-share\\recordings",
  "index": "C:\\Work\\Tools\\TryAI\\Ergo3DModel\\data\\logs\\recordings-index.json",
  "max_scan": 1000,
  "max_files": 100,
  "max_bytes": 21474836480
}
```

The server/share shown is a placeholder, not a discovered Volvo location.
For manually downloaded files, replace `root` with an absolute local folder path.
`index` may be a local file or an authorized share file. Both paths must be
absolute filesystem paths, not HTTP URLs. Keep the config and real index outside
shared exports and commits. The config must be under `data\logs\` when starting
the server.

Start:

```powershell
python -m ergo3d serve --nuc-config data\logs\share-drive.json --open
```

In **Test-log replay -> NucLogger export**, enter VIN and UTC start/end, choose
**Review request**, inspect the file list and local destination, then click
**Download approved files**. The server copies only those files. Preview does not
copy recording content. The share root must be accessible at startup; configuration
is reloaded only when restarting the server.

## Explicit recording index

VIN/time selection requires an index from trusted recording/session metadata:

```json
{
  "format": "ergo3d-share-index/1",
  "recordings": [
    {
      "path": "session-001\\record.asc",
      "vin": "ABC12345678901234",
      "start": "2026-10-30T10:00:00Z",
      "end": "2026-10-30T10:05:00Z"
    }
  ]
}
```

This is the connector's explicit interchange format, **not a verified NUC Drive
export format**. The VIN above is synthetic. Optional `sha256` is the trusted
source file hash (64 lowercase hexadecimal digits). Do not invent identity, time
coverage or hashes to populate this index. If NUC exports a different index, obtain
an authorized sample of its structure and implement a tested conversion.

- Paths are relative to the approved root. Absolute paths, traversal, NTFS stream
  syntax, symlinks and junctions in recording paths are rejected.
- VINs are exact uppercase 17-character identifiers. An index may contain multiple
  vehicles; only the requested VIN's files are inspected/copied.
- Start/end are timezone-aware recording bounds. The requested and indexed
  intervals are half-open `[start,end)`. Whole overlapping chunks are selected.
- Missing identity/time, bad index schema, duplicate case-insensitive paths or
  exceeded limits reject the preview. File modification time and filenames are
  **not** used to guess recording time or VIN.
- Index size is bounded to 8 MiB and `max_scan` rows (default 1000). Use a narrow
  session index; the connector never recursively scans the fleet share.
- All entries' identity/time/hash fields are validated. Requested-VIN source files
  must be accessible even if a chunk does not overlap the selected time interval.
  The preview's `scanned` count is the requested-VIN files inspected, not all rows.
- Auxiliary files and missing bus coverage are not inferred. Include necessary
  recordings in the authoritative index, and verify decoders/coverage separately.

## Integrity and local artifacts

The existing preview/approval API is retained, but all Azure operations are removed.
Previews expire after 15 minutes, are single-use, and are limited to 16 pending
requests. One copy runs at a time; byte/file limits and available disk are checked.

Files are opened read-only. Source file identity, size and nanosecond modification/
change timestamps are checked against the preview before and after each copy.
Growth stops copying. A trusted source SHA-256, if supplied, is compared before
marking the file complete. Stat checks alone are not a transactional SMB snapshot
or a guarantee against undetectable same-size modifications; prefer closed,
immutable recordings with trusted hashes.

Sessions are persisted under `data\logs\nuc-sessions\nuc-<random-id>\`:

```text
manifest.json
raw\
  0000.asc
  0001.pcap
```

Generated destination names never interpret source paths as local destinations.
The manifest retains original relative names, source root/index, requested VIN/time,
selection, source versions, sizes and local SHA-256. It explicitly marks clock
alignment as not performed and replay as not generated.

Failures retain a failed manifest and `.partial` files instead of reporting success.
Retry requires a new preview; cross-request resume and cancellation are not
implemented. Closing the popup does not stop a copy in progress. Transfers display
a busy state rather than per-file progress.

The loopback API requires same-origin browser requests. Private `data/logs` paths
are blocked from HTTP serving. Do not mount the source share inside the web-served
project or share downloaded logs by copying them into public folders. On a shared
PC, use OS account permissions; the viewer is not a multi-user authorization system.
Offline HTML and Teams-hosted pages cannot access the server process's share rights.

## Agent responsibilities

Master Agent remains the single user-facing coordinator. NUC Log Export now follows
**share-drive first**, asks whether access is mounted or website-only, and obtains
the approved root/index without requesting credentials. It must not revert to
Azure Blob without a new explicit request. Test Log Sync handles accepted local
series and timelines after evidence-backed clock alignment.

Acquisition is not decoding or synchronization. Downloaded Ethernet and CAN files
still need per-clock evidence and independent native-rate source series before
canonical ergonomic replay. Signal mapping remains deferred.

## Verification scope

Tests use temporary local directories as synthetic shares: VIN/window selection,
actual file copying, source changes, expected-hash failure, limits, path validation,
failed manifests and loopback HTTP boundaries. Chrome tests exercise the popup
against that real filesystem connector at desktop and mobile widths.

No real share, Windows network authentication, NUC website export or production
clock alignment has been verified. A real UNC/mapped root and trusted recording
index are still required for a live export.
