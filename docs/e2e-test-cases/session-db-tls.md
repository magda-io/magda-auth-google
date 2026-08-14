# E2E Test Case: session-db TLS connection (Magda v7)

A concrete, repeatable end-to-end case verifying that this plugin's **v4**
line (SDK v7 + the `magda.db-client-sslmode-env-v1` helper contract) connects
to `session-db` **over TLS** when deployed alongside **Magda v7**, and that
session-db access still works — run against a real cluster (e.g. minikube).

This is the plugin-side counterpart to Magda's own
[DB TLS + non-default privileged user](https://github.com/magda-io/magda/blob/next/docs/docs/e2e-test-cases/db-tls-and-privileged-user.md)
case: that one covers `magda-core`'s own services; auth plugins are separate
charts and are not exercised by it.

## What it covers

Under Magda v7, the in-cluster PostgreSQL serves TLS with a self-signed
certificate and every `client`-role connection is expected to be encrypted
(`global.postgresql.client.sslmode` resolves to `require` by default). This
case asserts the google auth plugin participates in that:

1. The `magda.db-client-sslmode-env-v1` helper resolves against the installed
   `magda-core` v7 and injects `PGSSLMODE=require` into the plugin pod.
2. The plugin starts cleanly — the v7 `@magda/authentication-plugin-sdk`
   derives the `node-postgres` `ssl` option from `PGSSLMODE` explicitly, so it
   does **not** fail on the self-signed certificate with
   `SELF_SIGNED_CERT_IN_CHAIN`.
3. The plugin's actual `session-db` connection is TLS (`ssl = t`), as the
   restricted `client` role on the `session` database.

## No OAuth credentials required

The v7 change under test is the **database transport**, not the OAuth flow, so
this case needs **no real Google client id / secret** — a fake `googleClientId`
and a fake `oauth-secrets` secret are enough. The plugin opens its `session-db`
pool from the session store (`connect-pg-simple`), independently of whether any
real Google login ever completes. The assertion queries `pg_stat_ssl` directly,
so the `secure: true` session-cookie / HTTPS requirement that gates a *browser*
login is irrelevant here.

## Prerequisite: the plugin and Magda must be in ONE Helm release

The `magda.db-client-sslmode-env-v1` shim performs a compatibility handshake by
calling `magda.compatibility-check`, a template that lives in `magda-core`.
Helm's template namespace is **per release**, so the plugin only sees that
template when it is installed **in the same release as `magda-core`** — i.e. as
a chart **dependency**, not as a separate `helm install`. Installed as its own
release with the check enabled, the render fails with
`no template "magda.compatibility-check" associated` (this is the contract
failing closed, by design — see
[Magda Helm Helper Contracts](https://github.com/magda-io/magda/blob/next/docs/docs/helm-helper-contracts.md)).

This case therefore deploys via a small **umbrella chart** that depends on both
`magda` and this plugin.

## Setup

Build the plugin's PR / release artifacts first (the deploy uses the published
chart + image, not a local checkout) — see
[How to Release a New Version](https://github.com/magda-io/magda/blob/next/docs/docs/ci-version-release.md).
Substitute the version you built for `<PLUGIN_VERSION>` (e.g. `4.0.0-pr.9.0`)
and the Magda v7 release for `<MAGDA_VERSION>` (e.g. `7.0.0-alpha.0`) below.

```bash
# umbrella/Chart.yaml
cat > Chart.yaml <<'EOF'
apiVersion: v2
name: magda-e2e
version: 0.1.0
dependencies:
  - name: magda
    version: "<MAGDA_VERSION>"
    repository: "oci://ghcr.io/magda-io/charts"
  - name: magda-auth-google
    version: "<PLUGIN_VERSION>"
    repository: "oci://ghcr.io/magda-io/charts"
EOF

# umbrella/values.yaml
cat > values.yaml <<'EOF'
global:
  magdaCompatibilityCheck: true          # the check we are exercising; keep it on
magda-auth-google:
  googleClientId: "fake-client-id.apps.googleusercontent.com"   # fake is fine
magda:
  magda-core:
    gateway:
      authPlugins:
        - key: google
          baseUrl: http://magda-auth-google
EOF

kubectl create namespace magda
helm dependency update .
helm install magda . -n magda            # release name "magda"
# wait until settled
kubectl get pods -n magda --no-headers | grep -vE "Running|Completed"   # expect empty

# the plugin references an oauth-secrets Secret for GOOGLE_CLIENT_SECRET; create a fake one
kubectl create secret generic oauth-secrets -n magda \
  --from-literal=google-client-secret=fake-google-client-secret-for-e2e
kubectl rollout status deploy/magda-auth-google -n magda
```

## Assertions

### A. The helper injected `PGSSLMODE` into the plugin pod

```bash
kubectl get deploy magda-auth-google -n magda \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -E 'PGSSLMODE|PGUSER'
```

Expected:

```
PGUSER=client
PGSSLMODE=require
```

`PGSSLMODE=require` present is proof the compatibility check **passed** against
`magda-core` v7 and the helper delegated correctly. (Installed standalone or
against Magda v6-, this env var would be absent or the render would fail.)

### B. The plugin started cleanly (no self-signed-cert failure)

```bash
kubectl logs -n magda deploy/magda-auth-google | tail -5
```

Expected: `Listening on port 80`, and **no** `SELF_SIGNED_CERT_IN_CHAIN` /
connection error.

### C. The plugin is registered with the gateway

```bash
kubectl get configmap -n magda gateway-config -o jsonpath='{.data.authPlugins\.json}'
```

Expected to contain the `google` entry, e.g.
`[{"baseUrl":"http://magda-auth-google","key":"google"}]`.

### D. The plugin's `session-db` connection is TLS

The objective assertion, run against the DB pod as the built-in `postgres`
superuser (this deployment mounts the password as a file, hence
`$POSTGRES_PASSWORD_FILE`):

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
PLUGIN_IP=$(kubectl get pod -n magda -l service=magda-auth-google \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].status.podIP}')

# Catch the app's own connect-pg-simple connection. It opens on the session
# store's startup prune and idles out after ~30s, so restart the pod and poll:
kubectl delete pod -n magda -l service=magda-auth-google --wait=false
for i in $(seq 1 45); do
  IP=$(kubectl get pod -n magda -l service=magda-auth-google \
        --field-selector=status.phase=Running -o jsonpath='{.items[0].status.podIP}' 2>/dev/null)
  [ -n "$IP" ] && OUT=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
    "PGPASSWORD=\$(cat \$POSTGRES_PASSWORD_FILE) psql -U postgres -tAc \"
       SELECT a.datname, a.usename, host(a.client_addr), s.ssl, s.version, a.state
       FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
       WHERE host(a.client_addr) = '$IP';\"")
  [ -n "$OUT" ] && { echo "$OUT"; break; }
  sleep 1
done
```

Expected (a `session`/`client` row, `ssl = t`, with a TLS version):

```
session|client|10.244.3.71|t|TLSv1.3|idle
```

**Deterministic variant** — reproduce the SDK's `require`-mode connection from
inside the plugin pod using the pod's real env, and read TLS state off your own
backend:

```bash
kubectl exec -n magda deploy/magda-auth-google -- node --input-type=module -e '
import pg from "pg";
const m=(process.env.PGSSLMODE||"").trim().toLowerCase();
const ssl = m==="require" ? {rejectUnauthorized:false} : (m===""||m==="disable"?false:{rejectUnauthorized:false});
const pool=new pg.Pool({host:"session-db",port:5432,database:"session",ssl});
const r=await pool.query("SELECT s.ssl, s.version, a.usename, a.datname FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid) WHERE s.pid = pg_backend_pid()");
console.log("PGSSLMODE="+process.env.PGSSLMODE+" -> "+JSON.stringify(r.rows[0]));
await pool.end();'
```

Expected:

```
PGSSLMODE=require -> {"ssl":true,"version":"TLSv1.3","usename":"client","datname":"session"}
```

## Result

Verified against minikube with Magda `7.0.0-alpha.0` and plugin
`4.0.0-pr.9.0`: all four assertions passed — `PGSSLMODE=require` injected, clean
startup, plugin registered, and the `session-db` connection encrypted
(`ssl = t`, `TLSv1.3`) as `client` on the `session` database.

## Cleanup

```bash
helm uninstall magda -n magda 2>/dev/null || true
kubectl delete namespace magda --wait=true --timeout=180s 2>/dev/null || true
minikube ssh -- 'sudo rm -rf /tmp/hostpath-provisioner/magda'
```
