/**
 * USDT0 Bridge: TON → EVM
 *
 * Bridges USDT0 from TON to an EVM chain (Arbitrum) using LayerZero.
 *
 * Setup:
 *   1. pnpm install
 *   2. Configure USER_CONFIG below
 *   3. Set TON_MNEMONIC in .env
 *   4. pnpm start
 *
 * Requirements:
 *   - USDT0 tokens in your TON wallet
 *   - ~0.7 TON for LayerZero fees + transaction costs
 */

import "dotenv/config";
import { TonClient, WalletContractV5R1 } from "@ton/ton";
import { Address, beginCell, Cell, toNano, internal, SendMode, TupleBuilder } from "@ton/core";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import nacl from "tweetnacl";
import {
    buildClass,
    decodeClass,
} from "@layerzerolabs/lz-ton-sdk-v2";
import { tonObjectsUsdt0 } from "./schema.js";
import {
    parseTonAddress,
    objectBuild,
    objectDecode,
    addressToBigInt,
    bigIntToAddress,
    buildTonTransferCell,
    buildUlnConnnection,
    computeTonUlnAddress,
    computeTonEndpointAddress,
    computeTonChannelAddress,
    computeTonUlnConnectionAddress,
} from "./ton-utils.js";

// ─── User Settings ───────────────────────────────────────────

const USER_CONFIG = {
    mnemonic: process.env.TON_MNEMONIC || "",
    recipient: "0xB62bf6cAE06A9c3Ff551a4C36Ec3c058EBFF47CF",
    amount: 0.005, // USDT amount
    dstEid: 30110, // Arbitrum. Full list: https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts
};

// ─── Configuration ──────────────────────────────────────────

const TON_RPC_URL =
    process.env.TON_RPC_URL || "https://toncenter.com/api/v2/jsonRPC";

// TON contract addresses (mainnet)
const TON_OFT_PROXY =
    "0:1ddf580052174ed1dd0d66c35bfdc1a5fcc69af4f4ae36154b13dcfc6c14a35f";
const TON_USDT_MINTER =
    "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
const TON_ULN_MANAGER =
    "0x06b52b11abaf65bf1ff47c57e890ba4ad6a75a68859bbe5a51c1fc451954c54c";
const TON_CONTROLLER =
    "0x1eb2bbea3d8c0d42ff7fd60f0264c866c934bbff727526ca759e7374cae0c166";

// Destination config
const DST_OFT_PROXY = "0x14e4a1b13bf7f943c8ff7c51fb60fa964a298d92"; // Arbitrum OFT proxy

// Gas constants
const JETTON_TRANSFER_GAS = 0.07; // TON for the Jetton transfer hop
const GAS_ASSERT_MULTIPLIER = 440n; // Based on contract gas asserts × safety margin

// Cell builders/decoders for the USDT0 OFT protocol
const oftBuild = objectBuild(tonObjectsUsdt0);
const oftDecode = objectDecode(tonObjectsUsdt0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RPC_DELAY = 2000; // ms between RPC calls to avoid 429s

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            if (err?.message?.includes("429") && i < retries - 1) {
                console.log("  Rate limited, retrying...");
                await sleep(3000);
                continue;
            }
            throw err;
        }
    }
    throw new Error("unreachable");
}

// ─── Helpers ────────────────────────────────────────────────

async function getGasAsserts(client: TonClient): Promise<bigint> {
    const proxyAddress = parseTonAddress(TON_OFT_PROXY);
    const storage = await client
        .provider(proxyAddress)
        .get("getContractStorage", []);
    const cell = storage.stack.readCell();
    const oftCell = oftDecode.UsdtOFT(cell);
    const gasAsserts = oftDecode.GasAsserts(oftCell.gasAsserts);
    return gasAsserts.sendOFTGas * GAS_ASSERT_MULTIPLIER;
}

async function getJettonWalletAddress(
    client: TonClient,
    ownerAddress: Address
): Promise<Address> {
    const minterAddress = parseTonAddress(TON_USDT_MINTER);
    const tb = new TupleBuilder();
    tb.writeAddress(ownerAddress);
    const { stack } = await client
        .provider(minterAddress)
        .get("get_wallet_address", tb.build());
    return stack.readAddress();
}

function buildForwardPayload(
    dstAddress: string,
    nativeFee: bigint,
    minAmountOut: bigint
): Cell {
    const extraOptions = buildClass("md::OptionsV2", {
        lzReceiveGas: 0n,
        lzReceiveValue: 0n,
        nativeDropAddress: BigInt(dstAddress),
        nativeDropAmount: 0n,
        lzComposeGas: 0n,
        lzComposeValue: 0n,
    });

    return oftBuild.OFTSend({
        dstEid: BigInt(USER_CONFIG.dstEid),
        to: BigInt(dstAddress),
        minAmount: minAmountOut,
        nativeFee,
        zroFee: 0n, // ZRO token doesn't exist on TON
        extraOptions,
        composeMessage: beginCell().endCell(),
    });
}

async function getMessageFee(
    client: TonClient,
    dstAddress: string,
    minAmountOut: bigint
): Promise<{ nativeFee: bigint; zroFee: bigint }> {
    const proxyAddress = parseTonAddress(TON_OFT_PROXY);
    const oftProxyBigInt = addressToBigInt(proxyAddress);

    // Build a preliminary forward payload with 0 fee (fee is determined by the quote)
    const forwardPayload = buildForwardPayload(dstAddress, 0n, minAmountOut);
    const { composeMessage } = oftDecode.OFTSend(forwardPayload);

    // Get the LzSend metadata from the OFT contract
    const lzSendResult = await client
        .provider(proxyAddress)
        .get("getLzSendMd", [
            { type: "cell", cell: forwardPayload },
            { type: "int", value: 2n }, // Msg type: SEND_OFT
            { type: "cell", cell: composeMessage },
        ]);
    const lzSend = decodeClass("md::LzSend", lzSendResult.stack.readCell());

    await sleep(RPC_DELAY);

    // Compute derived contract addresses for the ULN quote
    const ulnAddress = bigIntToAddress(
        computeTonUlnAddress("USDT", BigInt(TON_ULN_MANAGER), BigInt(USER_CONFIG.dstEid))
    );

    const endpointAddress = bigIntToAddress(
        computeTonEndpointAddress(
            "USDT",
            BigInt(TON_CONTROLLER),
            BigInt(USER_CONFIG.dstEid)
        )
    );

    const channelAddress = bigIntToAddress(
        computeTonChannelAddress(
            "USDT",
            oftProxyBigInt,
            BigInt(USER_CONFIG.dstEid),
            BigInt(DST_OFT_PROXY),
            BigInt(TON_CONTROLLER),
            addressToBigInt(endpointAddress)
        )
    );

    // Build the ULN connection initial storage (needed for the quote)
    const connectionInitialStorage = buildUlnConnnection(
        oftProxyBigInt,
        BigInt(USER_CONFIG.dstEid),
        BigInt(DST_OFT_PROXY),
        BigInt(TON_ULN_MANAGER),
        addressToBigInt(ulnAddress)
    );

    // Fetch the ULN connection config for the send path
    const ulnConnectionAddress = bigIntToAddress(
        computeTonUlnConnectionAddress(
            "USDT",
            oftProxyBigInt,
            BigInt(USER_CONFIG.dstEid),
            BigInt(DST_OFT_PROXY),
            BigInt(TON_ULN_MANAGER),
            addressToBigInt(ulnAddress)
        )
    );

    let customUlnSendConfig;
    try {
        const ulnConnectionResult = await client
            .provider(ulnConnectionAddress)
            .get("getContractStorage", []);
        const ulnConnectionStorage = decodeClass(
            "UlnConnection",
            ulnConnectionResult.stack.readCell()
        );
        customUlnSendConfig = ulnConnectionStorage.UlnSendConfigOApp;
    } catch {
        // ULN connection not yet deployed — fetch default send config from ULN itself
        await sleep(RPC_DELAY);
        const ulnStorageResult = await client
            .provider(ulnAddress)
            .get("getContractStorage", []);
        const ulnStorage = decodeClass("Uln", ulnStorageResult.stack.readCell());
        customUlnSendConfig = ulnStorage.defaultUlnSendConfig;
    }

    await sleep(RPC_DELAY);

    // Build the full ULN send metadata
    const mdUlnSend = buildClass("md::UlnSend", {
        lzSend,
        customUlnSendConfig,
        connectionInitialStorage,
        forwardingAddress: channelAddress,
    });

    // Query the ULN for the actual fee quote
    const quoteStack = (
        await client.provider(ulnAddress).get("ulnQuote", [
            {
                type: "cell",
                cell: mdUlnSend,
            },
        ])
    ).stack;

    const parsedArray = quoteStack.readTuple().skip(1).pop() as unknown as Cell[];
    const parsedQuote = decodeClass("md::MsglibSendCallback", parsedArray[3]);

    // Add 30% buffer — unused fee is refunded to the sender
    const FEE_BUFFER = 13n;
    const FEE_DIVISOR = 10n;

    return {
        nativeFee: (parsedQuote.nativeFee * FEE_BUFFER) / FEE_DIVISOR,
        zroFee: 0n,
    };
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
    const { mnemonic, recipient, amount, dstEid } = USER_CONFIG;
    const amountLD = BigInt(Math.round(amount * 1e6)); // USDT has 6 decimals

    console.log(`\nUSDT0 Bridge: TON -> EVM (EID: ${dstEid})`);
    console.log(`  To: ${recipient}`);
    console.log(`  Amount: ${amount} USDT\n`);

    // Setup
    const client = new TonClient({ endpoint: TON_RPC_URL });
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = derivePath("m/44'/607'/0'", seed.toString("hex"));
    const keyPair = nacl.sign.keyPair.fromSeed(key);
    const wallet = WalletContractV5R1.create({
        publicKey: Buffer.from(keyPair.publicKey) as unknown as Buffer,
    });
    const walletContract = client.open(wallet);
    const walletAddress = wallet.address;

    // Quote
    console.log("Getting fee quote...");
    const jettonWalletAddress = await getJettonWalletAddress(client, walletAddress);
    await sleep(RPC_DELAY);
    const estimatedGas = await getGasAsserts(client);
    await sleep(RPC_DELAY);
    const minAmountOut = (amountLD * 99n) / 100n; // 1% slippage tolerance
    const fee = await getMessageFee(client, recipient, minAmountOut);
    console.log(`Fee: ${Number(fee.nativeFee) / 1e9} TON (includes 30% buffer)`);
    console.log(`Amount received: ${Number(minAmountOut) / 1e6} USDT (min)\n`);

    if (!mnemonic) {
        console.log("Set TON_MNEMONIC in .env to send");
        return;
    }

    // Send
    const account = walletAddress.toString();
    console.log(`From: ${account}\n`);

    console.log("Sending...");
    const forwardPayload = buildForwardPayload(
        recipient,
        fee.nativeFee,
        minAmountOut
    );
    const fwdAmount = fee.nativeFee + estimatedGas;
    const totalValue = fwdAmount + toNano(JETTON_TRANSFER_GAS);
    const transferCell = buildTonTransferCell({
        toAddress: parseTonAddress(TON_OFT_PROXY),
        fromAddress: walletAddress,
        value: totalValue,
        fwdAmount,
        jettonAmount: amountLD,
        forwardPayload,
    });

    await sleep(RPC_DELAY);
    const seqno = await withRetry(() => walletContract.getSeqno());
    await sleep(RPC_DELAY);
    await withRetry(() => walletContract.sendTransfer({
        secretKey: Buffer.from(keyPair.secretKey),
        seqno,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: jettonWalletAddress,
                value: totalValue,
                body: transferCell,
            }),
        ],
    }));

    // Wait for confirmation and get tx hash
    let txHash: string | null = null;
    for (let i = 0; i < 30; i++) {
        await sleep(3000);
        const newSeqno = await withRetry(() => walletContract.getSeqno());
        if (newSeqno > seqno) {
            await sleep(RPC_DELAY);
            const txs = await withRetry(() => client.getTransactions(walletAddress, { limit: 1 }));
            if (txs.length > 0) {
                txHash = txs[0].hash().toString("hex");
            }
            break;
        }
    }

    if (txHash) {
        console.log(`\nTransaction: https://tonviewer.com/transaction/${txHash}`);
        console.log(`LayerZero Scan: https://layerzeroscan.com/tx/0x${txHash}`);
    } else {
        console.log("\nCould not confirm transaction. Check your wallet on TonViewer.");
    }
}

main().catch(console.error);
