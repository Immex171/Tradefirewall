# TradeFirewall — SoDEX Builder Codes Integration

## Role

Act as a senior full-stack engineer, Web3 integration engineer, and security-focused trading systems architect. You are working on an existing project called **TradeFirewall**, a pre-trade crypto risk-control application.

Your task is to integrate the official SoDEX Builder Codes functionality into the existing application, following the supplied SoDEX Builder Codes documentation and preserving all existing risk controls.

**Do not rebuild the application. Inspect the repository first, understand the current implementation, then make targeted, production-quality changes.**

## 1. Understand the existing project

TradeFirewall currently includes:

- Next.js App Router and TypeScript.
- A live market-data integration using SoSoValue and SoDEX.
- A risk engine that produces a score from 0–100 and a decision.
- Risk decisions: `APPROVE`, `CAUTION`, `REDUCE_OR_WAIT`, and `BLOCK`.
- Rule-based risk explanations and execution previews.
- An existing SoDEX order-signing implementation in `src/lib/sodexOrderSigning.ts`.
- A SoDEX order placement route in `src/app/api/sodex/place-order/route.ts`.
- A confirmation gate and browser-wallet signing flow.
- A testnet-first execution architecture.
- Existing report, dashboard, watchlist, and risk-calibration features.

Read the project documentation, inspect the actual source code, identify existing conventions, and map the current order lifecycle before implementing anything.

Do not assume the documentation and code are perfectly synchronized. Report discrepancies and verify them against the implementation.

## 2. Primary objective

Integrate SoDEX Builder Codes so that users can explicitly authorize TradeFirewall's builder account to receive fees on eligible trades submitted through the application.

Implement:

1. Builder configuration and eligibility validation.
2. User-controlled builder fee approval and revocation.
3. Builder-aware order construction and EIP-712 signing.
4. Execution-preview fee transparency.
5. Server-side validation and risk-gate enforcement.
6. Builder earnings and actual-fill fee reconciliation.
7. Automated tests and updated documentation.

Builder fees must remain optional. The existing risk engine must work when builder functionality is disabled.

## 3. Follow the supplied SoDEX specification exactly

Use the supplied Builder Codes documentation as the implementation reference. If the repository contains an official SoDEX SDK, prefer the SDK's canonical signing and serialization functions over custom implementations.

### Builder identity and eligibility

- Resolve the builder's numeric account ID using the documented SoDEX account/subaccount APIs.
- Use the correct account ID for the relevant network.
- Before granting or updating a non-zero builder approval, verify that the builder satisfies the documented eligibility requirement: at least 100 vUSDC in Spot and 100 vUSDC in Perps.
- Use the user's primary account ID as the approval's `accountID` where required.
- Do not hardcode a guessed builder account ID or assume an account is eligible.
- Make the builder ID configurable through validated environment configuration or an appropriate administrative setup flow.
- Keep testnet and mainnet configuration explicitly separated.

### Fee units and limits

The documented fee units are integer tenths of a basis point.

| API value | Fee |
|---|---|
| 10 | 1 basis point = 0.01% |
| 50 | 5 basis points = 0.05% |
| 200 | 20 basis points = 0.2% |
| 2000 | 200 basis points = 2% |

Enforce these maximums:

- Spot: `2000`, equivalent to 2%.
- Perps: `200`, equivalent to 0.2%.
- Maximum active builder approvals per user: 10.

Validate requested fees against both the user's approved maximum and the applicable engine limit.

Never silently reinterpret a fee as a percentage, basis-point value, or decimal fraction.

Do not assume the same fee applies identically to Spot and Perps. Reflect the documented engine-specific rules and eligible fill types.

### User approval and revocation

- Builder approval must be explicitly authorized by the user.
- Account-level builder actions must be signed using the user's master wallet, not an API key.
- Use the documented EIP-712 domain, action type strings, message field order, network IDs, nonce, and signature encoding.
- Normalize the signature recovery byte as required by the SoDEX specification.
- Verify approval status using the documented builder-approval endpoint.
- Account for the possibility that approval queries lag behind a successful submission.
- After timeouts, errors, or incomplete responses, re-query both engines before attempting a retry with a fresh nonce.
- Revocation must set `maxFeeRate: 0` and verify that the approval has been cleared from both approval arrays.
- Do not include the builder field on subsequent orders after revocation.
- Handle the documented combined API-key-registration and builder-approval action only if it can be implemented safely and correctly.

Never collect or transmit the user's master-wallet private key to the server. Wallet signing must occur through the established browser-wallet flow.

## 4. Implement builder-aware order signing

Inspect `src/lib/sodexOrderSigning.ts` and the current order payload construction.

Add support for the optional builder fragment:

`builder: { id: number, fee: number }`

Requirements:

- Include the builder field before calculating the order's payload hash.
- Preserve the exact documented field order and canonical JSON representation.
- Place the builder field at the documented location in the containing order or batch structure.
- Preserve required zero and false values.
- Omit absent optional fields where the specification requires omission.
- Encode integer fields correctly and preserve the precision of `uint64` values.
- Use the correct Spot or Perps signing domain and signature prefix.
- Ensure the HTTP request body matches the documented payload format.
- Do not mutate the signed payload after hashing or signing.
- Keep orders without a builder fully compatible with the existing signing implementation.

If the official SDK offers canonical serialization, payload hashing, or typed-data construction, use it instead of duplicating fragile cryptographic logic.

Add tests that compare generated typed data, serialized payloads, hashes, and signatures against official SDK examples or known-good fixtures.

Never invent undocumented endpoints, action types, signing fields, or response formats.

## 5. Add a builder approval service

Create a dedicated, well-structured builder integration module following the repository's current conventions.

Separate the following responsibilities:

- Builder identity and network configuration.
- Builder eligibility checks.
- Approval-status queries.
- Approval request construction.
- Wallet-signature preparation.
- Revocation.
- Fee-rate validation.
- Builder statistics.
- Actual-fill fee reconciliation.

Reuse existing SoDEX HTTP clients, validation utilities, error-handling patterns, and types wherever appropriate.

Expose authenticated, validated application routes for the required operations. Possible route responsibilities include:

- Fetch builder configuration and approval status.
- Prepare a builder approval for browser-wallet signing.
- Submit or relay an approved signed action using the existing signing architecture.
- Prepare a revocation.
- Retrieve builder statistics and fee history.

Determine the exact endpoints and request schemas from the supplied documentation and existing SDK. Do not blindly implement speculative routes.

For every write operation:

- Validate request data.
- Enforce network restrictions.
- Verify signatures and nonces using the documented protocol.
- Handle timeouts and retries safely.
- Return structured, actionable errors.
- Avoid logging signatures, secrets, or sensitive wallet payloads.

Do not trust client-submitted approval status, builder eligibility, fee limits, risk decisions, or execution permissions.

## 6. Enforce the existing risk engine

This requirement is non-negotiable.

All builder-enabled orders must pass through the existing TradeFirewall risk-control lifecycle.

- `APPROVE`: continue through the existing permitted execution flow.
- `CAUTION`: preserve the existing caution and confirmation requirements.
- `REDUCE_OR_WAIT`: block order submission until the user reduces the position size and reruns the analysis.
- `BLOCK`: never allow an execution override.

The server must independently enforce the same restrictions immediately before order submission.

Do not create an alternative builder-enabled order endpoint that bypasses the current risk gate.

The builder feature must not:

- Lower risk scores.
- Modify risk-factor weights.
- Change risk thresholds.
- Bypass confirmation requirements.
- Enable automatic trading.
- Reuse stale analysis for a changed order.
- Trust a client-provided decision without validating the relevant report and trade parameters.

Ensure the symbol, side, amount, account, network, and other material order parameters remain consistent between risk analysis, execution preview, signature, and submission.

Revalidate critical market and execution conditions according to the existing architecture before submitting an order.

If builder approval status cannot be verified, do not claim that the fee is approved or active. Follow a clearly documented fail-safe policy. Never silently change a fee-enabled request into a materially different order without informing the user.

## 7. Improve the execution preview UI

Extend the existing execution-preview experience rather than creating a disconnected trading interface.

Display:

- Network and execution engine.
- Builder-enabled or builder-disabled status.
- Builder account ID.
- Requested fee rate in percentage and basis points.
- Applicable engine maximum.
- Verified approval maximum.
- Estimated builder fee amount where a reliable estimate can be calculated.
- The estimated fee's asset and calculation assumptions.
- Whether the builder fee applies to the proposed trade side.
- Existing risk score and decision.
- Order type, price protection, quantity, and other relevant execution details.
- Wallet-signing requirements.
- A clear explanation that estimated fees may differ from actual fees.

Do not display a fee as guaranteed income or as a confirmed charge before an eligible fill has occurred.

Require explicit user consent before activating builder fees. Provide a clear way to disable them and revoke approval.

Follow the existing design system, mobile responsiveness, accessibility patterns, loading states, empty states, and toast/error conventions.

Every visible button must perform a real action or be clearly disabled with an explanation.

## 8. Add builder earnings and reconciliation

Extend the existing dashboard only after the approval and signing lifecycle works correctly.

Use documented SoDEX builder-statistics and balance endpoints.

Where supported, display:

- Cumulative builder fees.
- Number of fills.
- Traded notional.
- Daily builder-fee history.
- Builder account balances.
- Spot and Perps breakdowns.
- Approval status for each engine.
- Recent execution records and reconciliation status.

Use actual fill records to determine fees charged.

Specifically:

- Read `builderFee` from REST trade records or `bf` from compact WebSocket updates where documented.
- Do not calculate actual fees from the requested fee or approval maximum.
- Do not add builder fees twice when they are already included in the total trading fee.
- An accepted order is not a fill.
- Do not classify every positive balance change as builder income.
- Reconcile balance changes with trades, transfers, and other balance movements.
- On WebSocket disconnection, refresh balances and resubscribe.
- Do not treat a refreshed balance snapshot as a substitute for missing transaction history.
- Label incomplete reconciliation explicitly.

Keep analytics honest. If an endpoint or data field is unavailable, show an appropriate unavailable state rather than fabricated values.

## 9. Security and network restrictions

Maintain strict network separation.

- Keep testnet execution as the default.
- Preserve the existing `SODEX_USE_TESTNET` guard.
- Do not enable mainnet execution as a side effect of implementing builder codes.
- Never expose API secrets, private keys, or signing credentials to the browser.
- Validate all client input server-side.
- Apply authentication, authorization, rate limiting, and CSRF/origin protections as appropriate to the existing architecture.
- Prevent replay through correct nonce handling.
- Avoid blind signing and misleading signature prompts.
- Do not weaken wallet confirmation or execution protections.
- Ensure errors and logs do not leak secrets or unnecessarily expose signed payloads.

If the existing project lacks a required security control, document the gap and implement it where feasible without introducing a second authentication system.

## 10. Testing requirements

Add unit, integration, and UI tests using the project's existing test framework.

Cover at least the following cases:

### Fee validation
- Valid Spot and Perps fee values.
- Zero-fee and disabled-builder scenarios.
- Fee above the engine cap.
- Fee above the approved maximum.
- Incorrect fee units.
- Invalid or unresolved builder account ID.
- Builder eligibility failure.
- Ten active approvals versus an attempted eleventh approval.

### Approval lifecycle
- Successful approval.
- Rejected wallet signature.
- Expired or invalid nonce.
- Approval visible in only one engine.
- Temporarily stale approval query.
- Timeout after submission.
- Safe retry with a fresh nonce.
- Successful revocation.
- Revocation followed by an order that omits the builder.

### Signing
- Correct EIP-712 domain.
- Correct action type strings and field order.
- Correct message and domain chain IDs.
- Correct signature prefix and recovery byte.
- Correct canonical payload hash.
- Correct optional-field omission.
- Builder field ordering.
- No regression for ordinary orders without a builder.

### Execution safety
- APPROVE order follows the permitted flow.
- CAUTION retains its confirmation requirements.
- REDUCE_OR_WAIT cannot submit without reduced-size reanalysis.
- BLOCK cannot submit.
- Client/server risk-decision mismatch is rejected.
- Changed order parameters invalidate stale analysis.
- Missing or unverifiable approval follows the defined safe policy.
- Testnet/mainnet configuration mismatch is rejected.

### Reconciliation
- Accepted order without a fill.
- Fill with a non-zero builder fee.
- Fill with zero builder fee.
- Actual fee differs from the requested fee.
- Builder fee is not double-counted.
- WebSocket disconnection and recovery.
- Unexplained balance changes remain pending reconciliation.

Use mocked provider responses for deterministic automated tests, but never present mocks as live integration evidence. Run available tests, linting, type checks, and production build checks.

## 11. Documentation updates

Update the project documentation to cover:

- Architecture and module responsibilities.
- Required environment variables.
- Builder account setup and eligibility.
- Fee units and engine limits.
- User approval and revocation.
- EIP-712 signing and network IDs.
- Execution-preview behavior.
- Security assumptions.
- Error handling and retry behavior.
- Builder statistics and reconciliation limitations.
- Test commands and results.
- Known limitations and unverified functionality.

Keep the documentation consistent with the actual code. Do not mark an end-to-end flow complete until it has been exercised successfully.

## 12. Implementation workflow

Follow these stages:

### Stage A — Audit
Inspect the repository and report:
- Existing SoDEX integration and signing architecture.
- Current API routes and risk gates.
- Relevant files and dependencies.
- Gaps between existing code and the supplied Builder Codes documentation.
- Security risks and compatibility concerns.

### Stage B — Plan
Write a concise implementation plan with:
- Files to create or modify.
- API and service responsibilities.
- UI changes.
- Security decisions.
- Test coverage.
- Any blocking questions that cannot be answered from the repository or supplied specification.

Do not stop for approval on routine implementation details. Make reasonable decisions consistent with existing conventions. Stop and explain only when an essential undocumented protocol detail or unsafe assumption blocks progress.

### Stage C — Implement
Implement the complete feature in small, coherent changes. Reuse existing abstractions and dependencies. Do not replace working modules unnecessarily or introduce unrelated refactors.

### Stage D — Verify
Run the available test suite, lint, type checks, and production build. Fix regressions. Report which tests passed, failed, or could not run.

If live SoDEX credentials or a funded testnet account are unavailable, complete offline tests and any safely available read-only checks. Explicitly state that live approval, signing, submission, or fill verification remains untested.

### Stage E — Report
Provide a final engineering report containing:
1. Features implemented.
2. Files created or modified.
3. API routes added or changed.
4. Security and risk-gate protections.
5. Test results.
6. Build status.
7. Environment variables required.
8. Manual test instructions.
9. Remaining limitations.
10. Exact steps needed to complete a funded SoDEX testnet round trip.

## Definition of done

The feature is complete only when:

- Builder approvals can be safely created, verified, and revoked.
- Builder-aware orders use correct SoDEX signing and serialization.
- Fee limits are validated server-side.
- Existing risk decisions remain fully enforced.
- The user sees and consents to the builder fee.
- Actual builder fees are read from confirmed fills.
- Earnings and balances are not fabricated or double-counted.
- Automated tests pass, or any failures are explicitly documented.
- The production build succeeds.
- Documentation accurately reflects the implementation.
- Any unverified live integration step is clearly disclosed.

**Begin with Stage A: audit the existing repository and supplied documentation. Then proceed through the remaining stages, implementing the feature rather than returning only a plan.**