#!/bin/sh
set -eu
umask 077

backup_dir=/home/pierce/bastet-console-data/postgres-backups
container=bounty-data-postgres-1
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%S.%NZ)
database_partial="$backup_dir/bounty-$stamp.dump.partial"
roles_partial="$backup_dir/roles-$stamp.sql.partial"
diagnostic_path="$backup_dir/diagnostic-$stamp.log"
trap 'backup_status=$?; if [ "$backup_status" -ne 0 ]; then printf '\''%s\n'\'' '\''{"event":"console_postgres_backup_failed","privateDiagnosticsRetained":true}'\''; fi' 0

# Provider output contains database records and role password hashes. It goes
# directly to owner-only files, never the journal or a shell argument.
{
docker exec "$container" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$database_partial"
docker exec "$container" sh -c 'pg_dumpall --globals-only -U "$POSTGRES_USER"' > "$roles_partial"
test -s "$database_partial"
test -s "$roles_partial"
docker exec -i "$container" pg_restore --list < "$database_partial" > /dev/null
chmod 600 "$database_partial" "$roles_partial"
mv "$database_partial" "$backup_dir/bounty-$stamp.dump"
mv "$roles_partial" "$backup_dir/roles-$stamp.sql"
sha256sum "$backup_dir/bounty-$stamp.dump" "$backup_dir/roles-$stamp.sql" > "$backup_dir/manifest-$stamp.sha256"
chmod 600 "$backup_dir/manifest-$stamp.sha256"
} 2> "$diagnostic_path"
# Retain completed and partial snapshots; never automatically delete evidence.
printf '%s\n' '{"event":"console_postgres_backup_verified","archiveListValidated":true,"fullRestorePerformed":false}'
