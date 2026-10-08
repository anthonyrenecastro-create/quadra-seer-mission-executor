# Backup & Restore Runbook — QuadraSeer Collaboration Store

All collaboration state lives in `COLLAB_DATA_DIR` (`/data/collab-data` in the
production container, backed by the `collab_data` Docker volume). The Python
backend's memory lives in Redis (`redis_data` volume, AOF enabled).

## Layers of protection

| Layer | What | Where | Retention |
|-------|------|-------|-----------|
| Scheduled snapshots | `npm run collab:snapshot` copies every collection file | `<dataDir>/snapshots/<stamp>-<label>/` | `--keep N` (default 14) |
| Pre-restore safety snapshot | automatic before every restore/import | `<dataDir>/snapshots/<stamp>-pre-restore/` | same retention |
| Corruption quarantine | corrupt files are renamed, never overwritten | `<dataDir>/<name>.json.corrupt.<stamp>` | manual cleanup |
| Whole-store export | `GET /api/collab/admin/export` | downloaded JSON | operator-managed |
| Volume | Docker named volume `collab_data` | host | until `docker volume rm` |

## Scheduling snapshots

On the Docker host, daily at 03:00 (snapshots run inside the node container
so they see the live data dir):

```cron
0 3 * * * docker compose -f /opt/quadra-seer/docker-compose.prod.yml exec -T node node collab/snapshot.js --label daily --keep 14 >> /var/log/quadra-seer-snapshot.log 2>&1
```

Or on a bare-metal deploy:

```cron
0 3 * * * cd /opt/quadra-seer && npm run collab:snapshot -- --label daily --keep 14 >> /var/log/quadra-seer-snapshot.log 2>&1
```

## Manual operations (API, authenticated)

```bash
# List snapshots
curl -H "Authorization: Bearer $TOKEN" https://HOST/api/collab/admin/snapshots

# Take one now
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"before-migration"}' https://HOST/api/collab/admin/snapshots

# Full export (download)
curl -H "Authorization: Bearer $TOKEN" https://HOST/api/collab/admin/export -o export.json

# Restore a snapshot (needs COLLAB_ALLOW_RESTORE=1 on the node service in token mode)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://HOST/api/collab/admin/snapshots/<name>/restore

# Import a full export (same gate as restore)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data @export.json https://HOST/api/collab/admin/import
```

Every restore/import takes a safety snapshot first and returns its name —
a bad restore is reversible by restoring the `pre-restore` / `pre-import`
snapshot.

## Restore drill (run quarterly)

1. `POST /api/collab/admin/snapshots` with `{"label":"drill"}` — note the name.
2. Create a canary mission via the API; confirm it appears.
3. `POST /api/collab/admin/snapshots/<drill-name>/restore`.
4. Confirm the canary mission is **gone** (state rolled back) and the API is healthy (`/ready` → 200).
5. Restore the `pre-restore` safety snapshot; confirm the canary is back.
6. Log the drill date and result. If any step fails, treat it as a P1.

## Disaster scenarios

**Corrupt collection file.** The server refuses to boot and logs
`ESTORECORRUPT` with the quarantine path. Do NOT delete the quarantined file.
Restore the latest snapshot, then diff the quarantined file against the
restored one to salvage anything written after the snapshot.

**Lost `collab_data` volume.** Recreate the volume, restore the latest
off-host export via `/api/collab/admin/import` (with `COLLAB_ALLOW_RESTORE=1`),
or replay from the most recent downloaded export.

**Bad deploy / bad migration.** `docker compose` keeps the previous images;
roll back with `docker compose -f docker-compose.prod.yml up -d` on the
previous image tags, then restore the `pre-migration` snapshot if data was
touched.

**Redis loss.** Redis is a cache/persistence layer for the Python backend with
AOF enabled; it rebuilds from `redis_data`. If the volume is lost, the Python
backend starts empty but the collaboration store (source of truth for missions)
is unaffected.
