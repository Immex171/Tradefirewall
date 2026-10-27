# Builder Codes in Trading

## TradeFirewall implementation status

The app implements the SoDEX Testnet Spot builder approval/revocation flow, approval-status verification, and optional builder serialization for eligible sell orders. The dashboard displays the connected user's SoDEX Testnet account ID, which is also that user's Builder ID to share with other apps. Configure the server-only `SODEX_BUILDER_ID` environment variable with TradeFirewall's actual testnet account ID; the app does not guess or hardcode this identity. The wallet owner explicitly signs approval, revocation, and each eligible order. The order fee is disabled by default and is added only when the user has an active verified Spot approval and opts in for that sell.

Builder approvals are checked in both Spot and Perps after write operations. SoDEX's documented approval endpoint enforces the builder account and balance eligibility requirement on non-zero approvals. A write with uncertain response or inconsistent engine status is reported as unconfirmed and is not automatically retried. Mainnet builder approvals and execution are not enabled. Builder earnings/statistics UI and fill-level reconciliation are not yet implemented; no earnings are inferred from an approval or order acceptance.

## Overview

The term "builder" here does not refer to ValueChain block builders. Builder codes let application builders receive a fee on fills they send on behalf of a user.

Builder codes are set per order. The user must approve a maximum builder fee for each builder and can revoke that approval at any time.

To use builder codes, the user first approves a `maxFeeRate` for the builder account ID. Sign that action with the user's master wallet, not an API key.

Granting or updating an approval with a non-zero `maxFeeRate` requires the builder to hold at least **100 vUSDC in Spot and 100 vUSDC in Perps**.

Builder codes currently apply only to fees collected in the quote or collateral asset:

- They do not apply to the buying side of Spot trades.
- They apply to both sides of Perps trades.
- Builder fees can be at most **0.2% on Perps** and **2% on Spot**.

After approval, orders may include an optional `builder` parameter:

```json
{
  "id": 456,
  "fee": 50
}
```

- `id`: The builder account ID.
- `fee`: The requested builder fee rate, expressed in tenths of a basis point.

A value of `10` requests 1 basis point of the fill notional. The actual rate is subject to the user's approval and the engine cap.

Each user can have a maximum of **10 active builder approvals** at a time.

---

## 1. Become a Builder

Any activated trading account can act as a builder once it holds at least 100 vUSDC in each engine. There is no separate builder registration.

The builder ID is that account's numeric account ID.

Read it from:

- Query Subaccounts: `data.primaryAccountID`
- Spot or Perps account state: `data.aid`

The standalone approval endpoint checks that the builder account exists in both engines and meets the 100 vUSDC requirement in each when granting or updating a non-zero `maxFeeRate`.

Falling below this balance after approval does not stop builder fee credits.

Clearing an approval with `maxFeeRate: 0` skips the builder eligibility checks and frees an approval slot.

---

## 2. Fee Units and Limits

Both `fee` and `maxFeeRate` are integers measured in tenths of a basis point.

### 2.1 Fee conversion table

| API value | Basis points | Percentage of order notional |
|---:|---:|---:|
| `10` | 1 bp | 0.01% |
| `50` | 5 bp | 0.05% |
| `200` | 20 bp | 0.2% |
| `2000` | 200 bp | 2% |

### 2.2 Maximum fee by engine

| Engine | Maximum builder fee | API value |
|---|---:|---:|
| Spot | 2% | `2000` |
| Perps | 0.2% | `200` |

The approval endpoint accepts `maxFeeRate` from `0` through `2000`, inclusive.

Each order requests a rate in `builder.fee`. The actual rate charged is limited to the user's approved maximum and the engine cap.

Without approval for that builder, the actual builder fee is zero.

The actual builder fee rate for Perps cannot exceed `200` (0.2%), even when `maxFeeRate` is `2000`.

Missing approval or a requested rate above either limit does not, by itself, reject an otherwise valid order. Instead, it results in a zero or reduced builder fee.

---

## 3. Integration Flow

1. Resolve the builder account ID and confirm the required 100 vUSDC balance in each engine.
2. Query subaccounts and use `data.primaryAccountID` as the approval's `accountID`.
3. Set the builder's numeric account ID and requested fee rate.
4. Register a trading API key, then approve the builder with the user's master wallet. Sign these requests separately or use the combined registration action described below.
5. Query `GET /api/v1/user/{userAddress}/builders`.
6. Check `builderID` and `feeRate` in `data.spot` or `data.perps` for each engine the application uses.
7. Include the approved builder in the signed order and track execution.

An otherwise valid order carrying an unapproved builder can still execute, but no builder fee is charged.

Check the actual fee on the fill rather than assuming the requested fee was charged.

For orders without a builder, omit the `builder` field before signing.

Approval succeeds when both engines accept the request. Queries may lag behind submission. After a timeout, error, or incomplete query result, re-query both engines before retrying with a fresh nonce.

---

## 4. Approval Example

Approve a builder with the user's master wallet.

`Client.from_env()` uses Mainnet unless `SODEX_NETWORK=testnet`.

Set the following environment variables:

```bash
SODEX_PRIVATE_KEY=<master-wallet-private-key>
SODEX_BUILDER_ID=<builder-account-id>
SODEX_BUILDER_FEE_RATE=<maximum-fee-rate>
```

Python example:

```text
examples/approve_builder_fee.py
```

---

## 5. EIP-712 Signing

Sign account-level actions with the user's master wallet and the following domain.

### 5.1 EIP-712 domain

| Domain field | Value |
|---|---|
| `name` | `universal` |
| `version` | `1` |
| `chainId` | The exact `uint64` value sent in `X-API-Chain` |
| `verifyingContract` | `0x0000000000000000000000000000000000000000` |

For builder actions, the message field `chainID` differs from the domain `chainId`.

Use:

- **SoDEX Mainnet:** `286623`
- **SoDEX Testnet:** `138565`

These values apply regardless of the wallet's selected network. The SDK example uses the SoDEX network ID for both values.

Ordinary `AddAPIKey` registration has no message-level `chainID`; it uses the network ID in the domain.

### 5.2 Action types

These type strings are case-sensitive, and field order is part of the signature.

```solidity
AddAPIKey(
    uint64 accountID,
    string name,
    uint8 keyType,
    bytes publicKey,
    uint64 expiresAt,
    uint64 nonce
)

AddAPIKeyWithBuilder(
    uint64 chainID,
    uint64 nonce,
    uint64 accountID,
    string name,
    uint8 keyType,
    bytes publicKey,
    uint64 expiresAt,
    uint64 builderID,
    uint64 maxFeeRate
)

ApproveBuilderFeeAction(
    uint64 chainID,
    uint64 nonce,
    uint64 accountID,
    uint64 builderID,
    uint64 maxFeeRate
)
```

---

## 6. Combined API Key Registration and Approval

To register a key and approve a builder in one action, include `builder` in:

```http
POST /api/v1/user/{userAddress}/api-keys
```

Sign the `AddAPIKeyWithBuilder` structure.

### 6.1 HTTP request to EIP-712 message mapping

| HTTP request field | EIP-712 message field |
|---|---|
| `type` | `keyType` (`1` for EVM) |
| `builder.id` | `builderID` |
| `builder.fee` | `maxFeeRate` |

The remaining message fields follow the action type string above.

`builder` and `permissions` are mutually exclusive within a registration request.

See the SoDEX Authentication & Signing documentation for the complete typed-data objects, including the permissioned-key variant.

---

## 7. Signature Bytes and Headers

For the account-level actions above, `X-API-Sign` is the hex encoding of:

```text
0x02 || r[32] || s[32] || v[1]
```

Here, `v` is `0` or `1`.

Wallet libraries that return `27` or `28` must normalize the recovery byte before adding the prefix.

Send the same nonce in:

- The signed message's `nonce`
- `X-API-Nonce`

Set `X-API-Chain` to the domain chain ID.

Trading orders use the Spot or Futures domain and signature prefix `0x01`.

---

## 8. Order Payload and Execution

After approval, include this fragment in the order parameters before computing the payload hash:

```json
{
  "builder": {
    "id": 456,
    "fee": 50
  }
}
```

Replace `456` with your builder account ID.

- **Spot:** Batches specify `builder` after `orders` at the batch level.
- **Perps:** Supports a batch default and per-order overrides.

Use a rate within both the user's approval and the engine cap.

Python SDK examples are available in the SoDEX SDK documentation.

### 8.1 Canonical JSON

- Preserve the documented field order in `{type, params}`.
- `builder` is the last field in its containing order or batch structure, with `id` before `fee`.
- Omit absent optional fields marked `omitempty`.
- Retain required zero or false values.
- Encode `uint64` values as unquoted JSON integers with full precision.
- Use the SDK's canonical serializer for signed orders.

The signature hashes the `{type, params}` wrapper; the HTTP body contains only `params`.

See the payload hashing and order walkthrough documentation for signing, submission, and order-status tracking.

### 8.2 Order response handling

Check both:

1. The top-level response code.
2. Individual order results.

Retain `clOrdID` and the returned order ID for status queries and reconciliation.

---

## 9. Clear Approval

Submit `maxFeeRate: 0` and verify removal in both approval arrays.

Clearing approval:

- Skips builder account eligibility and minimum-balance checks.
- Still requires valid account and signature checks.
- Frees an active builder approval slot.

Omit the builder from subsequent orders.

Manage existing orders separately through the order-cancellation endpoints.

---

## 10. Builder Statistics

Use the builder account owner's address to query combined Spot and Perps statistics.

The optional `accountID` selects a builder account belonging to that owner. Omitting it uses the primary account.

### 10.1 Statistics

| Query | Result |
|---|---|
| Fee summary | Cumulative builder fees, fill count, traded notional, and builder user count |
| Daily chart | Latest daily records in ascending UTC date order; defaults to 90 records, maximum 300 |

See `BuilderFeeStats` and `BuilderFeeDailyStats` for response fields.

These statistics summarize activity. Account balances show the funds available in each engine.

---

## 11. Fee Credits and Withdrawals

Builder fees credit in real time to the builder account on the engine that produced the fill. There is no separate claim step.

Query that account's balances to see income.

### 11.1 Balance endpoints

| Engine | REST endpoint |
|---|---|
| Spot | `GET .../spot/accounts/{userAddress}/balances` |
| Perps | `GET .../perps/accounts/{userAddress}/balances` |

Pass the builder account ID as `accountID`.

- Spot total includes locked funds.
- Perps total is wallet balance.

To send credited funds off-chain, use ordinary withdrawals:

**Perps → Spot → ValueChain EVM → External**

Trading `transferAsset` only reaches EVM.

### 11.2 Example balance queries

```bash
export BASE_URL="https://mainnet-gw.sodex.dev"
export BUILDER_USER_ADDRESS="<builder-wallet-address>"
export BUILDER_ACCOUNT_ID="<builder-account-id>"

curl -sS \
  "$BASE_URL/api/v1/spot/accounts/$BUILDER_USER_ADDRESS/balances?accountID=$BUILDER_ACCOUNT_ID"

curl -sS \
  "$BASE_URL/api/v1/perps/accounts/$BUILDER_USER_ADDRESS/balances?accountID=$BUILDER_ACCOUNT_ID"
```

An approval sets a fee ceiling; it is not a payment record.

Subscribe to the receiving builder account's Account Updates Stream for live balance changes, not the user's builder-approval list.

---

## 12. Monitor Builder Balances

Use Node.js 22 or later.

Set `BUILDER_USER_ADDRESS`, `BUILDER_ACCOUNT_ID`, and `ENGINE` (`spot` or `perps`), save the following as `builder-balances.mjs`, and run:

```bash
node builder-balances.mjs
```

This read-only example prints balance updates without submitting trades and sends a ping every 40 seconds to keep idle connections alive.

See the SoDEX connection guide for heartbeat and reconnect requirements.

### 12.1 WebSocket streams

| Engine | Stream | Updated balance field |
|---|---|---|
| Spot | `wss://mainnet-gw.sodex.dev/ws/spot` | `data.B[].t` (includes locked funds); `l` is locked funds |
| Perps | `wss://mainnet-gw.sodex.dev/ws/perps` | `data.B[].wb` (wallet balance) |

Each balance includes coin ID `i` and name `a`.

Values are decimal strings representing the updated balance, not an amount to add. Only updated assets appear in `B`; an omitted asset has not necessarily become zero.

### 12.2 Node.js example

```javascript
const { BUILDER_USER_ADDRESS, BUILDER_ACCOUNT_ID, ENGINE } = process.env;

const accountID = Number(BUILDER_ACCOUNT_ID);

if (
  !BUILDER_USER_ADDRESS ||
  !BUILDER_ACCOUNT_ID ||
  !Number.isSafeInteger(accountID) ||
  accountID < 0 ||
  !["spot", "perps"].includes(ENGINE)
) {
  throw new Error(
    "Set builder address, numeric account ID, and ENGINE"
  );
}

const ws = new WebSocket(
  "wss://mainnet-gw.sodex.dev/ws/" + ENGINE
);

let heartbeat;

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    op: "subscribe",
    id: 1,
    params: {
      channel: "accountUpdate",
      user: BUILDER_USER_ADDRESS,
      accountID
    }
  }));

  heartbeat = setInterval(
    () => ws.send(JSON.stringify({ op: "ping" })),
    40_000
  );
});

ws.addEventListener("message", event => {
  const message = JSON.parse(event.data);

  if (message.op === "subscribe") {
    if (!message.success) {
      console.error("Subscription failed:", message.error);
      ws.close();
    }
    return;
  }

  if (
    message.channel !== "accountUpdate" ||
    message.type !== "update"
  ) {
    return;
  }

  for (const balance of message.data.B ?? []) {
    console.log({
      engine: ENGINE,
      accountID,
      block: message.data.h,
      coinID: balance.i,
      asset: balance.a,
      balance: ENGINE === "spot" ? balance.t : balance.wb
    });
  }
});

ws.addEventListener("close", () => {
  clearInterval(heartbeat);
  console.error(
    "Disconnected: refresh Spot or Perps account balances and resubscribe"
  );
});

ws.addEventListener("error", () => {
  console.error("WebSocket connection error");
});
```

---

## 13. Reconciliation

Query builder account balances for the current balance view.

The REST trade field `builderFee` and compact WebSocket field `bf` report the actual builder fee on a fill. Use them instead of recomputing fees from the approval ceiling or requested rate.

Important rules:

- The builder fee is already included in REST `fee` and WebSocket `f`. Do not add it again when calculating the total fee.
- An accepted order is not a fill. Use trade records to determine the final fee charged.
- Compare balance changes over the same interval with expected fee receipts.
- Account separately for transfers, trades, and other balance changes.
- On disconnection, refresh Spot or Perps account balances and resubscribe.
- A new snapshot restores the current balance, not missed transaction history.

The `accountUpdate` stream does not contain a builder-fee reason, per-credit identifier, or trade ID. It shows the balance effect of credits but cannot, by itself, prove a one-to-one match between a trade fee and a credit.

Keep unexplained differences pending. Do not classify every positive balance change as builder income.

---

## 14. Troubleshooting

| Symptom | What to check |
|---|---|
| Spot builder USDC balance is insufficient | When granting or updating a non-zero `maxFeeRate`, check the builder's Spot balance against the 100 vUSDC eligibility requirement. |
| Perps builder USDC balance is insufficient | When granting or updating a non-zero `maxFeeRate`, check the builder's Perps balance against the 100 vUSDC eligibility requirement. |
| Builder account not found | For a non-zero approval, confirm that the builder ID is an existing trading account ID on the network. |
| Approval visible in only one engine | Re-query both approval arrays before retrying. |
| More than 10 builders | Clear an approval with `maxFeeRate: 0` to free a slot. |
| Signature recovery or API key lookup error | Check the signing wallet, primary type, field order, chain IDs, signature encoding, and registered API key name. |
| Builder fee is zero or lower than requested | Check approval for the relevant engine, the approved maximum, and the engine cap. Missing approval produces no builder fee; rates above either limit are reduced. Inspect `builderFee` or `bf` on the fill. |

These fee and approval conditions do not, by themselves, reject an otherwise valid order.

---

## 15. Quick Reference

- **Builder eligibility:** At least 100 vUSDC in Spot and 100 vUSDC in Perps when granting or updating a non-zero approval.
- **Maximum active approvals:** 10 per user.
- **Spot fee cap:** 2% (`2000`).
- **Perps fee cap:** 0.2% (`200`).
- **Fee units:** Tenths of a basis point.
- **Approval signing:** User's master wallet.
- **Approval verification:** Check both relevant engine approval arrays.
- **Revocation:** Set `maxFeeRate: 0` and verify removal.
- **Actual fee verification:** Read `builderFee` or `bf` from fill records.
- **Balance monitoring:** Subscribe to the receiving builder account's Account Updates Stream.
- **Reconciliation:** Do not double-count builder fees or treat unexplained balance changes as confirmed builder income.
