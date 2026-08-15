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

### B. The SDK actually reads + writes `session-db` under verify-full

This plugin has no local-password login (unlike `magda-auth-internal`) and no
real Google credentials are available, so instead of a browser login we drive
**the SDK's own session store** — `createMagdaSessionRouter`, which builds the
pool via the SDK's `createPool`/`getPgSslConfigFromEnv` (the exact code that
reads `PGSSLROOTCERT`) — to persist a session. A successful write proves the SDK
**connected, verified the server certificate, and ran a real `INSERT`** over
verify-full. Run it inside the pod so it uses the pod's real env + mounted CA:

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
before=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
  'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d session -tAc "SELECT count(*) FROM session;"')

kubectl exec -n magda deploy/magda-auth-google -- node --input-type=module -e '
import express from "express";
import http from "http";
import { createMagdaSessionRouter } from "@magda/authentication-plugin-sdk";
const app = express();
app.use(createMagdaSessionRouter({ sessionSecret:"e2e", sessionDBHost:"session-db", sessionDBPort:5432 }));
app.get("/w", (req,res) => { req.session.e2e = "verify-full-"+Date.now(); res.end("ok"); });
const server = app.listen(0, () => {
  const port = server.address().port;
  http.get("http://127.0.0.1:"+port+"/w", r => { r.on("data",()=>{}); r.on("end",
    () => setTimeout(() => { console.log("SDK session write issued (status "+r.statusCode+")"); server.close(); process.exit(0); }, 2000));
  }).on("error", e => { console.error("HTTP err", e.message); process.exit(1); });
});'

after=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
  'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d session -tAc "SELECT count(*) FROM session;"')
echo "session rows: $before -> $after"
```

Expected: `SDK session write issued (status 200)` and the session count
**increases by one** (e.g. `1 -> 2`) — the write went through the SDK's own
verify-full connection. If the CA were missing/invalid the SDK's pool would
reject the handshake (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and the write would not
happen.

> The full end-to-end SDK path (session read + write on a real login) is
> additionally covered by `magda-auth-internal`'s
> [verify-full-ca](https://github.com/magda-io/magda-auth-internal/blob/main/docs/e2e-test-cases/verify-full-ca.md)
> case, which shares the same `createMagdaSessionRouter` session-store code.

### C. (Optional) Confirm the negotiated TLS on the wire

To also see `ssl = t`/`TLSv1.3` for the SDK's connection from the server side,
restart the pod and poll `pg_stat_ssl` for the new pod IP (the connect-pg-simple
pool opens on the session store's startup prune and idles out after ~30s):

```bash
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
done   # expect: session|client|t|TLSv1.3
```

### D. Negative control (no CA ⇒ verification fails)

`verify-full` without the CA fails with
`unable to verify the first certificate` (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

## Result

Verified on minikube with Magda `7.0.0-alpha.1`: under `verify-full`,
`PGSSLROOTCERT` + the CA were delivered, and driving the SDK's own session store
persisted a session (rows `1 -> 2`) — i.e. the SDK's `createPool` verified the
server certificate and ran a real write over verify-full. The connection shows
`ssl = t`/`TLSv1.3` server-side, and removing the CA reproduces `unable to
verify the first certificate`.

## Cleanup

As in [session-db TLS connection](./session-db-tls.md); also
`kubectl delete secret pg-ca -n magda`.
