# E2E Test Case: `sslmode=verify-full` server-certificate verification (Magda v7)

Verifies that under `global.postgresql.client.sslmode: verify-full` this plugin
**verifies the PostgreSQL server certificate** (chain + hostname) against the
delivered CA for its `session-db` connection — run against a real cluster (e.g.
minikube).

Companion to [session-db TLS connection](./session-db-tls.md) (which covers
`require`). It exercises the `magda.db-client-ca-env-v1` helper contract
(magda-io/magda#3772 / #3773) that delivers the CA to external charts.

## What it covers

`require` only encrypts; **`verify-ca`/`verify-full` also validate the server
cert**, so the client must be given the CA. This chart adopts the
`magda.db-client-ca-env-v1` contract, which mounts the CA and sets
`PGSSLROOTCERT`. This case proves the plugin receives the CA and its
`session-db` connection verifies the server certificate and connects
(`ssl = t`). **Requires `magda-core` `>= 7.0.0-alpha.1`.**

## Setup

As in [session-db TLS connection](./session-db-tls.md), but set `verify-full` +
a CA secret. For an **in-cluster** combined-db, use the DB's own generated CA
(its server cert's SANs already cover `session-db`):

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
kubectl exec -n magda "$DBPOD" -c postgresql -- cat /opt/bitnami/postgresql/certs/ca.crt > /tmp/pg-ca.crt
kubectl create secret generic pg-ca -n magda --from-file=ca.crt=/tmp/pg-ca.crt

# umbrella/values.yaml adds:
#   global:
#     postgresql:
#       client:
#         sslmode: verify-full
#         sslRootCertSecret: { name: pg-ca, key: ca.crt }
helm upgrade magda . -n magda --wait
```

> The render-time guard **refuses** `verify-*` without `sslRootCertSecret.name`
> — the secret is mandatory (there is no trust-store fallback).

## Assertions

### A. CA delivered to the plugin

```bash
kubectl get deploy magda-auth-google -n magda \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' | grep PGSSL
# PGSSLMODE=verify-full
# PGSSLROOTCERT=/etc/magda/postgresql-ca/root.crt

kubectl exec -n magda deploy/magda-auth-google -- \
  sh -c 'openssl x509 -in /etc/magda/postgresql-ca/root.crt -noout -subject'
# subject=CN = combined-db-postgresql-pg17-ca
```

### B. The `session-db` connection verifies + connects (in-pod, deterministic)

```bash
kubectl exec -n magda deploy/magda-auth-google -- node --input-type=module -e '
import pg from "pg"; import fs from "fs";
const ca = fs.readFileSync(process.env.PGSSLROOTCERT, "utf-8");
const ssl = { rejectUnauthorized: true, ca };   // verify-full: chain + hostname
const pool = new pg.Pool({ host:"session-db", port:5432, database:"session", ssl });
const r = await pool.query("SELECT s.ssl, s.version FROM pg_stat_ssl s WHERE pid=pg_backend_pid()");
console.log(`session-db: ssl=${r.rows[0].ssl} ${r.rows[0].version}`);
await pool.end();'
```

Expected: `session-db: ssl=true TLSv1.3`.

### C. The live app's own connection (via connect-pg-simple) is TLS

The app opens its `session-db` pool on the session store's startup prune; it
idles out after ~30s, so restart the pod and poll:

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
kubectl delete pod -n magda -l service=magda-auth-google --wait=false
for i in $(seq 1 45); do
  IP=$(kubectl get pod -n magda -l service=magda-auth-google \
        --field-selector=status.phase=Running -o jsonpath='{.items[0].status.podIP}' 2>/dev/null)
  [ -n "$IP" ] && OUT=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
    "PGPASSWORD=\$(cat \$POSTGRES_PASSWORD_FILE) psql -U postgres -tAc \"
       SELECT a.datname, a.usename, s.ssl, s.version FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
       WHERE host(a.client_addr) = '$IP';\"")
  [ -n "$OUT" ] && { echo "$OUT"; break; }
  sleep 1
done
```

Expected: `session|client|t|TLSv1.3`.

### D. Negative control (no CA ⇒ verification fails)

`verify-full` without the CA fails with
`unable to verify the first certificate` (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

## Result

Verified on minikube with Magda `7.0.0-alpha.1` and the plugin (SDK
`7.0.0-alpha.1`): under `verify-full`, `PGSSLROOTCERT` + the CA were delivered,
and the `session-db` connection verified the server certificate and connected
(`ssl = t`, `TLSv1.3`). Removing the CA reproduced `unable to verify the first
certificate`.

## Cleanup

As in [session-db TLS connection](./session-db-tls.md); also
`kubectl delete secret pg-ca -n magda`.
