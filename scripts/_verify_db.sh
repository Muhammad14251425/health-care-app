#!/usr/bin/env bash
# Verify MariaDB + Redis are correctly configured for Frappe v16.
set -uo pipefail

echo "=== MariaDB version ==="
mariadb -uroot -pdevroot123 -N -B -e "SELECT VERSION();"

echo "=== Charset / collation (must be utf8mb4 / utf8mb4_unicode_ci) ==="
mariadb -uroot -pdevroot123 -e "SHOW VARIABLES WHERE Variable_name IN ('character_set_server','collation_server','innodb_file_per_table');"

echo "=== Existing databases (confirm nothing of ours is clobbered) ==="
mariadb -uroot -pdevroot123 -N -B -e "SHOW DATABASES;"

echo "=== Redis ==="
redis-cli ping
redis-cli info server | grep -E 'redis_version|tcp_port'
