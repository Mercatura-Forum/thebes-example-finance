# AGENTS.md — deploying this example

A canonical, copy-pasteable contract for an automated agent deploying
`thebes-example-finance` to a Thebes cluster. Human-readable detail is in
[README.md](README.md).

## Layout

```
thebes.toml                 deploy manifest (network + canisters)
motoko/main.mo              backend (Motoko); imports mo:thebes-lib/{Admin,Pagination}
motoko/thebes-lib/          vendored backend library (local Mops dep — no external pin)
frontend/                   React + Vite app on @thebes/sdk
frontend/vendor/@thebes/sdk vendored SDK (local file: dep — no external pin)
```

## Toolchain (exact)

- Motoko compiler **1.4.1**, fetched by `mops install` to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Do **not** invoke a bare `moc` — a default `PATH` may resolve a different
  compiler version or Qt's Meta-Object Compiler.
- Node 18+, Mops, and the `thebes-deploy` CLI (Linux x86-64 prebuilt; build from
  the release source bundle on other platforms).
- `mops install` prints `core@2.5.0 requires moc >= 1.6.0` while 1.4.1 is pinned.
  This is expected — the cluster pins 1.4.1 and the build succeeds.

## Deploy

```sh
# 0. network: the manifest ships with the current WAN cluster validators.
#    To refresh them, run:
thebes-deploy init            # prints current WAN cluster validators

# 1. backend
thebes-deploy identity new me
thebes-deploy deploy finance  # → prints the backend cid (call it FINANCE_CID)

# 2. frontend
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
cd frontend && npm install && npm run build && cd ..
sed -i 's#<head>#<head><script>window.FINANCE_CID=FINANCE_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web      # → prints https://memphis.mercaturaforum.com/_/raw/<cid>/index.html
```

Verify: `curl -s -o /dev/null -w '%{http_code}' <printed-url>` returns `200`.

## Calling the backend

```sh
thebes-deploy query finance accountsView                  # queries need no identity
thebes-deploy call  finance seedDemo                       # updates need a local identity
```

Candid arguments use textual form passed positionally via `--arg`, e.g.
`--arg '("Checking", "checking", 0 : nat)'`. Bare positional arguments after the
method name are **rejected** — always wrap them in a single `--arg '(...)'` tuple.

Public methods on `main.mo` (selected):

| Method | Kind | Args |
| --- | --- | --- |
| `accountsView` | query | — |
| `transactionsView` | query | `(accountId : nat, offset : nat, limit : nat)` |
| `verifyBalanceView` | query | `(accountId : nat)` |
| `budgetsView` | query | `(startNs : int, endNs : int)` |
| `listAccounts` / `getAccount` / `getTransactions` | query | per-caller reads |
| `createAccount` | update | `(name : text, kindText : text, creditLimitCents : nat)` |
| `postTransactionOrTrap` | update | post a transaction; traps on a failed guard |
| `setReceiptOrTrap` | update | `(txId : nat, receiptPath : text)` |
| `setBudget` | update | `(category : text, limitCents : nat)` |
| `seedDemo` | update | populate demo accounts + transactions for the caller |
| `claimOwner` / `transferOwner` / `setPaused` | update | ownership + pause (from `thebes-lib`'s `Admin`) |
| `getOwner` / `isPaused` | query | ownership + pause state |

All bookkeeping is strictly per-caller: every principal manages only its own
accounts and transactions; the owner/pause surface cannot read or mutate another
user's books.

## Conventions that affect correctness

- **`window.FINANCE_CID`** (and optional `window.MEDIA_CID`) are injected into the
  built page at deploy time; the frontend reads them at runtime. If you skip the
  injection step, the page falls back to compiled-in defaults and talks to the
  wrong backend.
- **`*OrTrap` methods** (e.g. `postTransactionOrTrap`, `setReceiptOrTrap`) trap on a
  failed guard so the client sees a rejection instead of a silently-swallowed
  error. Frontends call the `OrTrap` form for any guarded write.
- **Boundary decoding** returns a `vec record` of scalar fields. A single record is
  a 0-or-1-element array; principal fields are 56-character hex. Decode with the
  SDK's `decodeVecRecord` / `decodeNat` / `decodeBool`.
