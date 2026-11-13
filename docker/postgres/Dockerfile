# PostgreSQL with pgBackRest (WP11): the same postgres:16-alpine the stack
# runs, plus the backup tool, so WAL archiving happens where the data is.
# pgBackRest is configured entirely through PGBACKREST_* environment
# variables (docker-compose.backup.yml); no secret is baked into the image.
FROM postgres:16-alpine

RUN apk add --no-cache pgbackrest \
    && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest \
    && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest

COPY restore-test-inner.sh /usr/local/bin/medichain-restore-test
RUN chmod 0755 /usr/local/bin/medichain-restore-test
