# thebes-example-finance

An on-chain personal-finance manager built on
[Thebes Protocol](https://github.com/Mercatura-Forum/Thebes-Protocol-): a Motoko
backend that holds each caller's accounts, transactions, transfers and budgets,
and a React frontend served as certified assets.

The property this example proves: **books that always balance.** No posting can
overdraft an account past its floor; internal transfers are double-entry (both
legs written in one atomic step, always netting zero); and every stored balance
is re-provable against its transaction log — by the caller's oracle
(`invariantReportView`, four laws) and by a privacy-safe **global seal**
(`financeSealView`: the sum of every stored balance equals the sum of every
signed posting, contract-wide, with no personal data crossing the surface).

Live demo: <https://memphis.mercaturaforum.com/_/raw/179495140191996/index.html>

## Architecture

```
frontend (React + Vite + Tailwind)   →   finance backend (Motoko)
   @thebes/sdk  ── boundary client       mo:thebes-lib ── Admin / Pagination
   Memphis passkey gate                  accounts · transactions · budgets
```

- **frontend/** uses `@thebes/sdk` for the boundary client, typed query/update
  calls, React hooks, and the Memphis passkey gate. The SDK is **vendored** under
  `frontend/vendor/@thebes/sdk` and resolved as a local dependency
  (upstream source of truth: [`thebes-sdk`](https://github.com/Mercatura-Forum/thebes-sdk)).
- **motoko/** uses `thebes-lib` for `Admin` (controller-gated ownership + pause)
  and `Pagination`; the finance logic lives in `main.mo`. The library is
  **vendored** under `motoko/thebes-lib` and resolved as a local Mops dependency.

Both halves are self-contained: the repository builds with no external Git or Mops
toolkit pins. The frontend asset-canister wasm is the one artifact fetched at
deploy time (see [Deploy](#deploy)).

## Backend interface (selected)

| Method | Kind | Purpose |
| --- | --- | --- |
| `accountsView` / `listAccounts` / `getAccount` | query | Read the caller's accounts. |
| `transactionsView` / `getTransactions` | query | Paginated read of an account's transactions. |
| `budgetsView` / `getBudgetStatus` | query | Per-category budget windows and remaining spend. |
| `verifyBalanceView` / `verifyBalance` | query | Re-derive an account balance from its transactions and compare to the stored value. |
| `createAccount` | update | Open a checking / savings / cash / credit account. |
| `postTransactionOrTrap` | update | Post a transaction; traps on any guard failure (e.g. overdraft) so the client never silently ignores an error. |
| `setReceiptOrTrap` | update | Attach a receipt path to a transaction. |
| `setBudget` | update | Set a per-category monthly limit. |
| `seedDemo` | update | Populate demo accounts and transactions for the caller. |
| `claimOwner` / `transferOwner` / `setPaused` | update | Ownership and pause surface (from `thebes-lib`'s `Admin`). |

Bookkeeping is strictly **per-caller**: every principal manages only its own
accounts and transactions. The owner/pause surface exists for the deployer and an
emergency pause only — the owner cannot read or mutate another user's books.
Balances are stored in integer cents.

## Toolchain

- **Motoko compiler 1.4.1.** `mops install` fetches the pinned compiler to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Use that binary — the `moc` on a default `PATH` may be a different version, or
  Qt's unrelated Meta-Object Compiler.
- **Node 18+** and **[Mops](https://mops.one)** for the two builds.
- **[`thebes-deploy`](https://github.com/Mercatura-Forum/Thebes-Protocol-/releases)**
  to deploy. The prebuilt binary is Linux x86-64; on other platforms build it from
  the release source bundle (`cargo build --release -p thebes-deploy`).

## Run locally

```sh
# Frontend
cd frontend
npm install            # resolves the vendored @thebes/sdk
npm run dev            # sync-sdk copies the browser runtimes into public/, then Vite serves

# Backend (compile-check)
cd ../motoko
mops install           # resolves the vendored thebes-lib + the pinned compiler
"$(ls "$HOME/.cache/mops/moc/1.4.1/moc" "$HOME/Library/Caches/mops/moc/1.4.1/moc" 2>/dev/null | head -1)" --check $(mops sources) main.mo
```

## Deploy

`thebes.toml` describes the deploy. It ships with the current WAN cluster
validators pre-filled; run `thebes-deploy init` to print the live endpoints and
refresh the `validators` array if the cluster has moved.

> **Deploying your own copy?** The committed `cid` values pin the **live catalog
> deployment** (that's what the demo links serve — only its controller can
> upgrade it). Before your first deploy, set `cid = "auto"` on each canister:
> the deploy allocates fresh canisters you control and writes their ids back
> into the manifest.

### 1. Backend

```sh
thebes-deploy identity new me      # one-time local signing identity
thebes-deploy deploy finance       # build + install + verify → prints the backend cid
```

### 2. Frontend

The frontend installs an asset canister, then uploads your built bundle. Fetch the
asset-canister wasm once (it is referenced by `thebes.toml` as `asset_canister.wasm`):

```sh
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
```

Build the bundle and point it at your backend cid (the frontend reads
`window.FINANCE_CID` at runtime), then deploy:

```sh
cd frontend && npm run build && cd ..
# inject the backend cid from step 1 into the built page:
sed -i 's#<head>#<head><script>window.FINANCE_CID=YOUR_FINANCE_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web           # install asset canister + upload bundle + verify
```

The deploy prints the live URL:
`https://memphis.mercaturaforum.com/_/raw/<web-cid>/index.html`.

> Receipt images are served by a separate media canister via `window.MEDIA_CID`.
> It is optional — without one, transactions render without receipt thumbnails.

For a machine-readable deploy contract, see [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
