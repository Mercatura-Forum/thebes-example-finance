import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Array "mo:core/Array";
import List "mo:core/List";
import Runtime "mo:core/Runtime";
import Result "mo:core/Result";
import Admin "mo:thebes-lib/Admin";
import Pagination "mo:thebes-lib/Pagination";

// Personal finance manager. Unlike the multi-user token `Ledger` (transfers
// between principals) or the freelancer `InvoiceSystem` (client invoices), this
// is STRICTLY PER-CALLER bookkeeping: every principal manages only its OWN
// accounts and transactions. There is no cross-user authority — the Admin
// surface here exists solely for the deployer-owner + an emergency pause; the
// owner cannot read or mutate another user's books.
//
// Correctness guards (the real ones, mirroring store/booking):
//   1. NO OVERDRAFT. An #expense that would drive a #checking/#savings/#cash
//      account below zero is rejected. Only #credit accounts may go negative,
//      and only down to their `creditLimitCents` floor.
//   2. BALANCE INTEGRITY (verifyBalance). The stored, incrementally-maintained
//      `balanceCents` must always equal the sum recomputed from the account's
//      transactions (income +, expense -). The verifyBalance query recomputes
//      and reports consistency — the on-chain oracle for this invariant.
//
// Media: each transaction may point at a receipt image on the media contract
// (`receiptPath`, e.g. "/photo/{hash}"); the bytes live there, never here.
persistent actor Finance {

  // Deployer-owner + emergency pause only (see header — no cross-user authority).
  var admin = Admin.init();

  public shared(msg) func claimOwner() : async Bool {
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    Admin.claimOwner(admin, msg.caller)
  };
  public shared(msg) func transferOwner(n : Principal) : async Bool { Admin.transferOwner(admin, msg.caller, n) };
  public shared(msg) func setPaused(v : Bool) : async Bool { Admin.setPaused(admin, msg.caller, v) };
  public query func getOwner() : async ?Principal { Admin.getOwner(admin) };
  public query func isPaused() : async Bool { Admin.isPaused(admin) };

  public type AccountKind = { #checking; #savings; #cash; #credit };

  public type Account = {
    id : Nat;
    owner : Principal;
    name : Text;
    kind : AccountKind;
    // Stored balance in cents, maintained incrementally on every posting. Int
    // because #credit accounts are legitimately negative.
    balanceCents : Int;
    // Overdraft floor. #credit accounts may go down to -creditLimitCents;
    // every other kind is pinned to 0 (no overdraft), enforced at posting time.
    creditLimitCents : Nat;
    createdAt : Int;
  };

  public type TxKind = { #income; #expense };

  public type Transaction = {
    id : Nat;
    accountId : Nat;
    owner : Principal;
    kind : TxKind;
    // Always positive; the sign of its effect comes from `kind`.
    amountCents : Nat;
    category : Text;
    note : Text;
    // Pointer to a receipt image on the media contract, or null. Bytes never
    // live here (the storage law).
    receiptPath : ?Text;
    timestamp : Int;
    // Set on both legs of an internal transfer (1-based); null = standalone.
    transferId : ?Nat;
  };

  public type Budget = { category : Text; limitCents : Nat };

  var nextAccountId : Nat = 0;
  var nextTxId : Nat = 0;
  var nextTransferId : Nat = 1;

  // accounts: id -> account; ownerAccounts: principal -> [accountId] (index so a
  // caller's accounts are listed without scanning every account).
  let accounts = Map.empty<Nat, Account>();
  let ownerAccounts = Map.empty<Principal, [Nat]>();
  // transactions: id -> tx; accountTxs: accountId -> [txId] (newest appended last).
  let transactions = Map.empty<Nat, Transaction>();
  let accountTxs = Map.empty<Nat, [Nat]>();
  // budgets: owner -> (category -> limitCents). Nested map keyed on the caller
  // so budgets are per-user without flattening principals into text keys.
  let budgets = Map.empty<Principal, Map.Map<Text, Nat>>();

  // The signed effect of a posting on a balance: income adds, expense subtracts.
  private func signedDelta(kind : TxKind, amountCents : Nat) : Int {
    switch kind { case (#income) { amountCents }; case (#expense) { -amountCents } };
  };

  // Load an account the caller owns, or trap. Identity is ALWAYS msg.caller —
  // never a passed-in principal — so no caller can touch another's books.
  private func ownedAccount(caller : Principal, accountId : Nat) : Account {
    switch (Map.get(accounts, Nat.compare, accountId)) {
      case null { Runtime.trap("account not found") };
      case (?a) {
        if (not Principal.equal(a.owner, caller)) Runtime.trap("not your account");
        a;
      };
    };
  };

  // Open a new account for the caller. Non-credit accounts ignore the supplied
  // credit limit (pinned to 0 → no overdraft); only #credit honours it.
  // `kind` is passed as text ("checking"|"savings"|"cash"|"credit") — the SPA's
  // Candid encoder doesn't emit variants, so the public surface takes text and
  // parses to the internal AccountKind (acctKindOf).
  // Core account creation (caller + already-parsed kind). Shared by the public
  // text-arg entrypoint and by seedDemo.
  private func createAccountCore(caller : Principal, name : Text, kind : AccountKind, creditLimitCents : Nat) : Nat {
    let id = nextAccountId;
    nextAccountId += 1;
    let limit : Nat = switch kind { case (#credit) { creditLimitCents }; case _ { 0 } };
    let account : Account = {
      id; owner = caller; name; kind;
      balanceCents = 0; creditLimitCents = limit; createdAt = Time.now();
    };
    Map.add(accounts, Nat.compare, id, account);
    let existing = switch (Map.get(ownerAccounts, Principal.compare, caller)) {
      case (?ids) { ids }; case null { [] };
    };
    Map.add(ownerAccounts, Principal.compare, caller, Array.concat(existing, [id]));
    id;
  };

  public shared(msg) func createAccount(name : Text, kindText : Text, creditLimitCents : Nat) : async Nat {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    createAccountCore(msg.caller, name, acctKindOf(kindText), creditLimitCents);
  };

  // Post a transaction. GUARD 1 (no overdraft): the new balance may not fall
  // below the account's floor (0 for non-credit, -creditLimitCents for credit).
  // The balance is updated in the SAME synchronous call as the transaction write
  // (no await between), so the stored balance and the transaction log can never
  // diverge — the basis of verifyBalance.
  // `kind` is text ("income"|"expense") — see createAccount note on variants.
  // Core posting logic, returning Result. GUARD 1 (no overdraft) lives here.
  // ownedAccount traps if the account isn't the caller's (preserved behaviour).
  private func postTxCore(
    caller : Principal, accountId : Nat, kind : TxKind, amountCents : Nat,
    category : Text, note : Text, receiptPath : ?Text,
  ) : Result.Result<Nat, Text> {
    postTxCoreLinked(caller, accountId, kind, amountCents, category, note, receiptPath, null);
  };
  private func postTxCoreLinked(
    caller : Principal, accountId : Nat, kind : TxKind, amountCents : Nat,
    category : Text, note : Text, receiptPath : ?Text, transferId : ?Nat,
  ) : Result.Result<Nat, Text> {
    if (amountCents == 0) return #err("amount must be > 0");
    let account = ownedAccount(caller, accountId);
    let newBalance : Int = account.balanceCents + signedDelta(kind, amountCents);
    let floor : Int = -account.creditLimitCents;
    if (newBalance < floor) {
      return #err("insufficient funds (would overdraft)");
    };
    let id = nextTxId;
    nextTxId += 1;
    let tx : Transaction = {
      id; accountId; owner = caller; kind; amountCents; category; note; receiptPath;
      timestamp = Time.now(); transferId;
    };
    Map.add(transactions, Nat.compare, id, tx);
    // Update the stored balance + the per-account index atomically.
    Map.add(accounts, Nat.compare, accountId, { account with balanceCents = newBalance });
    let txIds = switch (Map.get(accountTxs, Nat.compare, accountId)) {
      case (?ids) { ids }; case null { [] };
    };
    Map.add(accountTxs, Nat.compare, accountId, Array.concat(txIds, [id]));
    #ok(id);
  };

  public shared(msg) func postTransaction(
    accountId : Nat, kindText : Text, amountCents : Nat, category : Text, note : Text, receiptPath : ?Text,
  ) : async Result.Result<Nat, Text> {
    Admin.requireNotPaused(admin);
    postTxCore(msg.caller, accountId, txKindOf(kindText), amountCents, category, note, receiptPath);
  };

  // Trap-on-error variant for the frontend: returns the tx id on success and
  // traps the overdraft / zero-amount guard message, so the guard reaches the
  // user as a failed call. (Same pattern as store's checkoutOrTrap.)
  public shared(msg) func postTransactionOrTrap(
    accountId : Nat, kindText : Text, amountCents : Nat, category : Text, note : Text, receiptPath : ?Text,
  ) : async Nat {
    Admin.requireNotPaused(admin);
    switch (postTxCore(msg.caller, accountId, txKindOf(kindText), amountCents, category, note, receiptPath)) {
      case (#ok id) { id }; case (#err e) { Runtime.trap(e) };
    };
  };

  // Attach/replace a receipt image pointer on one of the caller's transactions
  // (the client uploads the image to the media contract first, then passes the
  // returned path here).
  private func setReceiptCore(caller : Principal, txId : Nat, receiptPath : Text) : Result.Result<(), Text> {
    switch (Map.get(transactions, Nat.compare, txId)) {
      case null { #err("transaction not found") };
      case (?tx) {
        if (not Principal.equal(tx.owner, caller)) return #err("not your transaction");
        Map.add(transactions, Nat.compare, txId, { tx with receiptPath = ?receiptPath });
        #ok(());
      };
    };
  };

  public shared(msg) func setReceipt(txId : Nat, receiptPath : Text) : async Result.Result<(), Text> {
    Admin.requireNotPaused(admin);
    setReceiptCore(msg.caller, txId, receiptPath);
  };

  // Trap-on-error variant for the SPA (see postTransactionOrTrap note).
  public shared(msg) func setReceiptOrTrap(txId : Nat, receiptPath : Text) : async () {
    Admin.requireNotPaused(admin);
    switch (setReceiptCore(msg.caller, txId, receiptPath)) { case (#ok _) {}; case (#err e) { Runtime.trap(e) } };
  };

  // The caller's own accounts, in id order.
  public shared query(msg) func listAccounts() : async [Account] {
    let ids = switch (Map.get(ownerAccounts, Principal.compare, msg.caller)) {
      case (?ids) { ids }; case null { return [] };
    };
    Array.map<Nat, Account>(ids, func(id) {
      switch (Map.get(accounts, Nat.compare, id)) {
        case (?a) { a }; case null { Runtime.trap("dangling account index") };
      };
    });
  };

  // One of the caller's accounts (or null if it isn't theirs / doesn't exist —
  // never reveals another principal's account).
  public shared query(msg) func getAccount(accountId : Nat) : async ?Account {
    switch (Map.get(accounts, Nat.compare, accountId)) {
      case (?a) { if (Principal.equal(a.owner, msg.caller)) ?a else null };
      case null { null };
    };
  };

  // Paginated transactions for one of the caller's accounts, newest-first.
  public shared query(msg) func getTransactions(accountId : Nat, offset : Nat, limit : Nat) : async Pagination.Page<Transaction> {
    ignore ownedAccount(msg.caller, accountId); // traps if not the caller's account
    let ids = switch (Map.get(accountTxs, Nat.compare, accountId)) {
      case (?ids) { ids }; case null { [] };
    };
    // Materialize newest-first by reversing the append-order index.
    let n = ids.size();
    let newestFirst = Array.tabulate<Transaction>(n, func(i) {
      let txId = ids[n - 1 - i];
      switch (Map.get(transactions, Nat.compare, txId)) {
        case (?t) { t }; case null { Runtime.trap("dangling tx index") };
      };
    });
    Pagination.page<Transaction>(newestFirst, offset, limit);
  };

  // GUARD 2 (balance integrity oracle): recompute the account balance from its
  // transactions and compare to the stored value. `consistent` must always be
  // true; a false here would mean the incremental maintenance diverged from the
  // log. Owner-scoped (traps if not the caller's account).
  public shared query(msg) func verifyBalance(accountId : Nat) : async { stored : Int; recomputed : Int; consistent : Bool } {
    let account = ownedAccount(msg.caller, accountId);
    let ids = switch (Map.get(accountTxs, Nat.compare, accountId)) {
      case (?ids) { ids }; case null { [] };
    };
    var sum : Int = 0;
    for (txId in ids.values()) {
      switch (Map.get(transactions, Nat.compare, txId)) {
        case (?t) { sum += signedDelta(t.kind, t.amountCents) };
        case null { Runtime.trap("dangling tx index") };
      };
    };
    { stored = account.balanceCents; recomputed = sum; consistent = (sum == account.balanceCents) };
  };

  private func setBudgetCore(caller : Principal, category : Text, limitCents : Nat) {
    let cats = switch (Map.get(budgets, Principal.compare, caller)) {
      case (?m) { m };
      case null {
        let m = Map.empty<Text, Nat>();
        Map.add(budgets, Principal.compare, caller, m);
        m;
      };
    };
    Map.add(cats, Text.compare, category, limitCents);
  };

  // ── Internal transfers: double-entry, atomic, conservation-checked ──
  // Moves money between two of the CALLER's accounts by writing both legs in
  // one synchronous step: an #expense on the source and an #income on the
  // destination, linked by one transferId. The source's overdraft floor is
  // enforced exactly like any expense; the pair nets zero by construction and
  // the oracle re-proves it (R4) on every read.
  private func transferCore(caller : Principal, fromId : Nat, toId : Nat, amountCents : Nat, note : Text) : Result.Result<Nat, Text> {
    if (fromId == toId) return #err("pick two different accounts");
    if (amountCents == 0) return #err("amount must be > 0");
    // Both must be the caller's (ownedAccount traps otherwise — same guard as posting).
    ignore ownedAccount(caller, fromId);
    ignore ownedAccount(caller, toId);
    let tid = nextTransferId;
    switch (postTxCoreLinked(caller, fromId, #expense, amountCents, "transfer", note, null, ?tid)) {
      case (#err e) return #err(e);
      case (#ok _) {};
    };
    switch (postTxCoreLinked(caller, toId, #income, amountCents, "transfer", note, null, ?tid)) {
      case (#err e) {
        // Unreachable by construction (income has no floor), but never leave a
        // half-written pair: trap rolls the whole message back atomically.
        Runtime.trap("transfer could not complete: " # e);
      };
      case (#ok _) {};
    };
    nextTransferId += 1;
    #ok(tid);
  };
  public shared(msg) func transfer(fromId : Nat, toId : Nat, amountCents : Nat, note : Text) : async Result.Result<Nat, Text> {
    Admin.requireNotPaused(admin);
    transferCore(msg.caller, fromId, toId, amountCents, note);
  };
  public shared(msg) func transferOrTrap(fromId : Nat, toId : Nat, amountCents : Nat, note : Text) : async Nat {
    Admin.requireNotPaused(admin);
    switch (transferCore(msg.caller, fromId, toId, amountCents, note)) { case (#ok t) t; case (#err e) Runtime.trap(e) };
  };

  // Set/replace a soft monthly budget for a category (caller-scoped).
  public shared(msg) func setBudget(category : Text, limitCents : Nat) : async () {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    setBudgetCore(msg.caller, category, limitCents);
  };

  // Populate the CALLER's own books with a realistic demo set, so a fresh
  // sign-in shows a live dashboard instead of an empty one. Per-caller (finance
  // has no shared content) and idempotent: a no-op (returns false) once the
  // caller has any account.
  public shared(msg) func seedDemo() : async Bool {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    switch (Map.get(ownerAccounts, Principal.compare, msg.caller)) {
      case (?ids) { if (ids.size() > 0) return false };
      case null {};
    };
    let checking = createAccountCore(msg.caller, "Everyday Checking", #checking, 0);
    let savings = createAccountCore(msg.caller, "Rainy-Day Savings", #savings, 0);
    let card = createAccountCore(msg.caller, "Travel Card", #credit, 200_000);
    ignore postTxCore(msg.caller, checking, #income, 480_000, "salary", "Monthly paycheck", null);
    ignore postTxCore(msg.caller, checking, #expense, 125_050, "groceries", "Weekly shop", null);
    ignore postTxCore(msg.caller, checking, #expense, 89_900, "rent", "", null);
    ignore postTxCore(msg.caller, checking, #expense, 4_250, "coffee", "Morning flat white", null);
    ignore postTxCore(msg.caller, card, #expense, 32_000, "dining", "Team dinner", null);
    ignore postTxCore(msg.caller, card, #expense, 14_500, "transport", "Airport taxi", null);
    ignore transferCore(msg.caller, checking, savings, 100_000, "Monthly saving");
    setBudgetCore(msg.caller, "groceries", 60_000);
    setBudgetCore(msg.caller, "dining", 40_000);
    true;
  };

  // Budget status for a category over a [startNs, endNs) window. Spent sums the
  // caller's #expense transactions in that category whose timestamp falls in the
  // window (the window is supplied by the client, the same pattern as the
  // restaurant's day-stats, so no on-chain calendar math is needed). `remaining`
  // is Int: negative means over budget.
  public shared query(msg) func getBudgetStatus(category : Text, startNs : Int, endNs : Int) : async { limitCents : Nat; spentCents : Nat; remaining : Int } {
    let limit : Nat = switch (Map.get(budgets, Principal.compare, msg.caller)) {
      case (?m) { switch (Map.get(m, Text.compare, category)) { case (?l) { l }; case null { 0 } } };
      case null { 0 };
    };
    var spent : Nat = 0;
    for (tx in Map.values(transactions)) {
      if (
        Principal.equal(tx.owner, msg.caller) and tx.kind == #expense
        and tx.category == category and tx.timestamp >= startNs and tx.timestamp < endNs
      ) {
        spent += tx.amountCents;
      };
    };
    { limitCents = limit; spentCents = spent; remaining = limit - spent };
  };

  // ── Frontend view-models (flat records — easy to decode in the SPA) ──
  // The SPA's flat decoder reads flat record vecs only, so these flatten the
  // account/tx kind variants → text, the receipt opt → "", and return the
  // balance-integrity check + budgets as flat vecs (0-or-1 for the single check).

  public type AccountView = { id : Nat; name : Text; kind : Text; balanceCents : Int; creditLimitCents : Nat; createdAt : Int };
  public type TxView = { id : Nat; accountId : Nat; kind : Text; amountCents : Nat; category : Text; note : Text; receiptPath : Text; timestamp : Int; transferId : Nat };
  public type BudgetView = { category : Text; limitCents : Nat; spentCents : Nat };
  public type BalanceCheck = { stored : Int; recomputed : Int; consistent : Bool };

  func acctKindText(k : AccountKind) : Text {
    switch k { case (#checking) "checking"; case (#savings) "savings"; case (#cash) "cash"; case (#credit) "credit" };
  };
  func txKindText(k : TxKind) : Text { switch k { case (#income) "income"; case (#expense) "expense" } };
  func acctKindOf(s : Text) : AccountKind { switch s { case ("savings") #savings; case ("cash") #cash; case ("credit") #credit; case _ #checking } };
  func txKindOf(s : Text) : TxKind { switch s { case ("income") #income; case _ #expense } };

  public shared query(msg) func accountsView() : async [AccountView] {
    let ids = switch (Map.get(ownerAccounts, Principal.compare, msg.caller)) { case (?ids) ids; case null { return [] } };
    Array.map<Nat, AccountView>(ids, func(id) {
      switch (Map.get(accounts, Nat.compare, id)) {
        case (?a) { { id = a.id; name = a.name; kind = acctKindText(a.kind); balanceCents = a.balanceCents; creditLimitCents = a.creditLimitCents; createdAt = a.createdAt } };
        case null { Runtime.trap("dangling account index") };
      }
    })
  };

  public shared query(msg) func transactionsView(accountId : Nat, offset : Nat, limit : Nat) : async [TxView] {
    ignore ownedAccount(msg.caller, accountId);
    let ids = switch (Map.get(accountTxs, Nat.compare, accountId)) { case (?ids) ids; case null [] };
    let n = ids.size();
    let newestFirst = Array.tabulate<TxView>(n, func(i) {
      let txId = ids[n - 1 - i];
      switch (Map.get(transactions, Nat.compare, txId)) {
        case (?t) { { id = t.id; accountId = t.accountId; kind = txKindText(t.kind); amountCents = t.amountCents; category = t.category; note = t.note; receiptPath = (switch (t.receiptPath) { case (?s) s; case null "" }); timestamp = t.timestamp; transferId = (switch (t.transferId) { case (?x) x; case null 0 }) } };
        case null { Runtime.trap("dangling tx index") };
      }
    });
    let start = Nat.min(offset, n);
    let end = Nat.min(start + (if (limit == 0) 50 else limit), n);
    Array.tabulate<TxView>(end - start, func(i) { newestFirst[start + i] })
  };

  public shared query(msg) func verifyBalanceView(accountId : Nat) : async [BalanceCheck] {
    let account = ownedAccount(msg.caller, accountId);
    let ids = switch (Map.get(accountTxs, Nat.compare, accountId)) { case (?ids) ids; case null [] };
    var sum : Int = 0;
    for (txId in ids.values()) {
      switch (Map.get(transactions, Nat.compare, txId)) { case (?t) { sum += signedDelta(t.kind, t.amountCents) }; case null {} };
    };
    [{ stored = account.balanceCents; recomputed = sum; consistent = (sum == account.balanceCents) }]
  };

  public shared query(msg) func budgetsView(startNs : Int, endNs : Int) : async [BudgetView] {
    let cats = switch (Map.get(budgets, Principal.compare, msg.caller)) { case (?m) m; case null { return [] } };
    Array.map<(Text, Nat), BudgetView>(Map.toArray(cats), func((cat, limit)) {
      var spent : Nat = 0;
      for (tx in Map.values(transactions)) {
        if (Principal.equal(tx.owner, msg.caller) and tx.kind == #expense and tx.category == cat and tx.timestamp >= startNs and tx.timestamp < endNs) { spent += tx.amountCents };
      };
      { category = cat; limitCents = limit; spentCents = spent }
    })
  };

  // ── The oracle: four laws over the CALLER's books, and a global seal ─────
  public shared query(msg) func invariantReportView() : async [{ rule : Text; detail : Text }] {
    let bad = List.empty<{ rule : Text; detail : Text }>();
    let ids = switch (Map.get(ownerAccounts, Principal.compare, msg.caller)) { case (?x) x; case null [] };
    // Collect my transfer legs as we walk the accounts.
    let transferLegs = Map.empty<Nat, List.List<Transaction>>();
    for (accId in ids.values()) {
      switch (Map.get(accounts, Nat.compare, accId)) {
        case null List.add(bad, { rule = "R3 index"; detail = "account index points at missing account #" # Nat.toText(accId) });
        case (?a) {
          if (not Principal.equal(a.owner, msg.caller)) {
            List.add(bad, { rule = "R3 index"; detail = "account #" # Nat.toText(accId) # " is indexed under the wrong owner" });
          };
          var sum : Int = 0;
          let txIds = switch (Map.get(accountTxs, Nat.compare, accId)) { case (?x) x; case null [] };
          for (txId in txIds.values()) {
            switch (Map.get(transactions, Nat.compare, txId)) {
              case null List.add(bad, { rule = "R3 index"; detail = "tx index points at missing tx #" # Nat.toText(txId) });
              case (?t) {
                if (t.accountId != accId) List.add(bad, { rule = "R3 index"; detail = "tx #" # Nat.toText(txId) # " indexed under the wrong account" });
                sum += signedDelta(t.kind, t.amountCents);
                switch (t.transferId) {
                  case (?tid) {
                    let l = switch (Map.get(transferLegs, Nat.compare, tid)) {
                      case (?l) l;
                      case null { let l = List.empty<Transaction>(); Map.add(transferLegs, Nat.compare, tid, l); l };
                    };
                    List.add(l, t);
                  };
                  case null {};
                };
              };
            };
          };
          // R1 balance integrity: the stored balance equals the log.
          if (sum != a.balanceCents) {
            List.add(bad, { rule = "R1 balance"; detail = "account #" # Nat.toText(accId) # " stores " # Int.toText(a.balanceCents) # "c but the log sums to " # Int.toText(sum) # "c" });
          };
          // R2 overdraft floor holds right now.
          let floor : Int = -a.creditLimitCents;
          if (a.balanceCents < floor) {
            List.add(bad, { rule = "R2 floor"; detail = "account #" # Nat.toText(accId) # " sits below its floor" });
          };
        };
      };
    };
    // R4 transfers: every pair nets zero across two distinct accounts.
    for ((tid, l) in Map.entries(transferLegs)) {
      let legs = List.toArray(l);
      if (legs.size() != 2) {
        List.add(bad, { rule = "R4 transfer"; detail = "transfer #" # Nat.toText(tid) # " has " # Nat.toText(legs.size()) # " leg(s), expected 2" });
      } else {
        let net = signedDelta(legs[0].kind, legs[0].amountCents) + signedDelta(legs[1].kind, legs[1].amountCents);
        if (net != 0) List.add(bad, { rule = "R4 transfer"; detail = "transfer #" # Nat.toText(tid) # " nets " # Int.toText(net) # "c, expected 0" });
        if (legs[0].accountId == legs[1].accountId) List.add(bad, { rule = "R4 transfer"; detail = "transfer #" # Nat.toText(tid) # " has both legs on one account" });
      };
    };
    List.toArray(bad);
  };

  // PUBLIC global seal — no per-user data, just the conservation law over the
  // whole contract: the sum of every stored balance equals the sum of every
  // signed transaction delta, and no account's log disagrees with its balance.
  public query func financeSealView() : async [{
    accounts : Nat; transactions : Nat; storedSumCents : Int; ledgerSumCents : Int;
    inconsistentAccounts : Nat; checkedAt : Int;
  }] {
    var storedSum : Int = 0;
    var inconsistent : Nat = 0;
    for ((accId, a) in Map.entries(accounts)) {
      storedSum += a.balanceCents;
      var sum : Int = 0;
      let txIds = switch (Map.get(accountTxs, Nat.compare, accId)) { case (?x) x; case null [] };
      for (txId in txIds.values()) {
        switch (Map.get(transactions, Nat.compare, txId)) { case (?t) sum += signedDelta(t.kind, t.amountCents); case null {} };
      };
      if (sum != a.balanceCents) inconsistent += 1;
    };
    var ledgerSum : Int = 0;
    for (t in Map.values(transactions)) { ledgerSum += signedDelta(t.kind, t.amountCents) };
    [{ accounts = Map.size(accounts); transactions = Map.size(transactions); storedSumCents = storedSum; ledgerSumCents = ledgerSum; inconsistentAccounts = inconsistent; checkedAt = Time.now() }];
  };

  // Net worth across the caller's accounts (assets = non-credit, debt = credit).
  public shared query(msg) func netWorthView() : async [{
    assetsCents : Int; creditCents : Int; netCents : Int; accounts : Nat; nowNs : Int;
  }] {
    let ids = switch (Map.get(ownerAccounts, Principal.compare, msg.caller)) { case (?x) x; case null [] };
    var assets : Int = 0; var credit : Int = 0;
    for (accId in ids.values()) {
      switch (Map.get(accounts, Nat.compare, accId)) {
        case (?a) { switch (a.kind) { case (#credit) credit += a.balanceCents; case _ assets += a.balanceCents } };
        case null {};
      };
    };
    [{ assetsCents = assets; creditCents = credit; netCents = assets + credit; accounts = ids.size(); nowNs = Time.now() }];
  };

  // Time-bucketed cashflow for the caller over [startNs, endNs), `buckets`
  // equal windows (capped at 60) — the strata hero draws from this.
  public shared query(msg) func cashflowView(startNs : Int, endNs : Int, buckets : Nat) : async [{
    bucketStartNs : Int; incomeCents : Nat; expenseCents : Nat;
  }] {
    if (endNs <= startNs) return [];
    let n = if (buckets == 0) 1 else if (buckets > 60) 60 else buckets;
    let span = endNs - startNs;
    Array.tabulate<{ bucketStartNs : Int; incomeCents : Nat; expenseCents : Nat }>(n, func(i) {
      let b0 = startNs + span * i / n;
      let b1 = startNs + span * (i + 1) / n;
      var inc : Nat = 0; var exp : Nat = 0;
      for (t in Map.values(transactions)) {
        if (Principal.equal(t.owner, msg.caller) and t.timestamp >= b0 and t.timestamp < b1) {
          switch (t.kind) { case (#income) inc += t.amountCents; case (#expense) exp += t.amountCents };
        };
      };
      { bucketStartNs = b0; incomeCents = inc; expenseCents = exp };
    });
  };
}
