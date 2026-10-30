import { NextRequest, NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import {
  buildBuilderApprovalTypedData,
  fetchBuilderApprovals,
  getConfiguredBuilderID,
  getSodexTestnetApiRoot,
  recoverBuilderApprovalSigner,
  toSodexBuilderApiSign,
  validateBuilderFeeRate,
} from '@/lib/sodexBuilder';
import { SODEX_TESTNET_CHAIN_ID } from '@/lib/sodexOrderSigning';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json({ error: 'Builder Codes are available on Testnet only.' }, { status: 403 });
  }
  const address = request.nextUrl.searchParams.get('address') ?? '';
  if (!WALLET_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'Provide a valid wallet address.' }, { status: 400 });
  }

  try {
    const [account, approvals] = await Promise.all([
      sodexAPI.getAccountState(address),
      fetchBuilderApprovals(address),
    ]);
    return NextResponse.json({
      network: 'testnet',
      accountID: account.accountID,
      builderID: getConfiguredBuilderID(),
      approvals,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    console.error('SoDEX builder approval lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to verify builder approvals.' },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json({ error: 'Builder Codes are available on Testnet only.' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      action?: string;
      address?: string;
      maxFeeRate?: number;
      nonce?: number;
      signature?: string;
    };
    if (!WALLET_ADDRESS.test(body.address ?? '')) {
      return NextResponse.json({ error: 'Provide a valid wallet address.' }, { status: 400 });
    }

    const builderID = getConfiguredBuilderID();
    if (!builderID) {
      return NextResponse.json(
        { error: 'Set SODEX_BUILDER_ID to the TradeFirewall SoDEX Testnet account ID before enabling Builder Codes.' },
        { status: 503 }
      );
    }

    if (body.action !== 'prepare' && body.action !== 'submit') {
      return NextResponse.json({ error: 'Use action "prepare" or "submit".' }, { status: 400 });
    }

    const account = await sodexAPI.getAccountState(body.address!);
    const maxFeeRate = validateBuilderFeeRate(body.maxFeeRate);

    if (body.action === 'prepare') {
      const approvals = await fetchBuilderApprovals(body.address!);
      if (maxFeeRate > 0) {
        const activeBuilderIDs = new Set([
          ...approvals.spot.filter((item) => item.feeRate > 0).map((item) => item.builderID),
          ...approvals.perps.filter((item) => item.feeRate > 0).map((item) => item.builderID),
        ]);
        if (!activeBuilderIDs.has(builderID) && activeBuilderIDs.size >= 10) {
          return NextResponse.json(
            { error: 'SoDEX allows at most 10 active builder approvals. Revoke one before adding another.' },
            { status: 409 }
          );
        }
      }

      const nonce = Date.now();
      const typedData = buildBuilderApprovalTypedData({
        accountID: account.accountID,
        builderID,
        maxFeeRate,
        nonce,
      });
      return NextResponse.json({
        network: 'testnet',
        builderID,
        accountID: account.accountID,
        maxFeeRate,
        nonce,
        typedData,
        action: maxFeeRate === 0 ? 'revoke' : 'approve',
      });
    }

    if (!body.signature || !Number.isSafeInteger(body.nonce) || !body.nonce) {
      return NextResponse.json({ error: 'Missing signed builder approval fields.' }, { status: 400 });
    }
    const typedData = buildBuilderApprovalTypedData({
      accountID: account.accountID,
      builderID,
      maxFeeRate,
      nonce: body.nonce,
    });
    const recoveredAddress = await recoverBuilderApprovalSigner(typedData, body.signature as `0x${string}`);
    if (recoveredAddress.toLowerCase() !== body.address!.toLowerCase()) {
      return NextResponse.json({ error: 'Builder approval signature does not match the connected wallet.' }, { status: 400 });
    }

    const apiSign = toSodexBuilderApiSign(body.signature);
    const endpoint = `${getSodexTestnetApiRoot()}/user/${encodeURIComponent(body.address!)}/builders`;
    let submitResponse: Response | null = null;
    let submitError: unknown = null;
    try {
      submitResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Sign': apiSign,
          'X-API-Nonce': String(body.nonce),
          'X-API-Chain': String(SODEX_TESTNET_CHAIN_ID),
        },
        body: JSON.stringify({
          accountID: account.accountID,
          builderID,
          maxFeeRate,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      submitError = error;
    }

    let responsePayload: { code?: number; message?: string } | null = null;
    if (submitResponse) {
      responsePayload = await submitResponse.json().catch(() => null);
    }
    const acceptedByApi = !!submitResponse?.ok && responsePayload?.code === 0;

    // SoDEX can accept an action while its response times out; query both engines
    // before reporting failure or allowing the client to prepare a fresh signature.
    let verifiedApprovals;
    try {
      verifiedApprovals = await fetchBuilderApprovals(body.address!);
    } catch (verificationError) {
      console.error('Unable to verify SoDEX builder status after submission:', verificationError);
      return NextResponse.json(
        {
          error: 'SoDEX submission status is uncertain and builder approvals could not be re-checked. Do not retry until you manually verify the approval status.',
          errorType: 'BUILDER_STATUS_UNAVAILABLE_AFTER_SUBMISSION',
        },
        { status: 502 }
      );
    }
    const spotApproval = verifiedApprovals.spot.find((item) => item.builderID === builderID);
    const perpsApproval = verifiedApprovals.perps.find((item) => item.builderID === builderID);
    const expectedRate = maxFeeRate;
    const verified = maxFeeRate === 0
      ? !spotApproval?.feeRate && !perpsApproval?.feeRate
      : spotApproval?.feeRate === expectedRate && perpsApproval?.feeRate === expectedRate;

    if (!verified) {
      const details = acceptedByApi
        ? 'SoDEX accepted the request but both engine approval lists do not yet agree.'
        : responsePayload?.message || (submitError ? 'The response was incomplete or timed out.' : 'SoDEX rejected the builder action.');
      return NextResponse.json(
        {
          error: `${details} Approval status was re-checked. Do not retry until you confirm the status.`,
          errorType: 'BUILDER_STATUS_UNCONFIRMED',
          approvals: verifiedApprovals,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      action: maxFeeRate === 0 ? 'revoked' : 'approved',
      builderID,
      maxFeeRate,
      approvals: verifiedApprovals,
    });
  } catch (error) {
    console.error('SoDEX builder action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Builder action failed.' },
      { status: 502 }
    );
  }
}
