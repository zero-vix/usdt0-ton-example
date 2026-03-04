/**
 * TON utility functions for the USDT0 OFT bridge.
 *
 * Inlined from @layerzerolabs/ui-ton (not yet published on npm)
 * to keep this example fully standalone with only public dependencies.
 */

import { toBigIntBE, toBufferBE } from "bigint-buffer";
import { Address } from "@ton/ton";
import { beginCell, Cell } from "@ton/core";
import {
    baseBuildClass,
    buildClass,
    emptyCell,
    emptyMap,
    emptyPOOO,
    nullObject,
    generateBuildClass,
    generateDecodeClass,
} from "@layerzerolabs/lz-ton-sdk-v2";
import UlnArtifact from "@layerzerolabs/lz-ton-sdk-v2/artifacts/Uln.compiled.json";
import EndpointArtifact from "@layerzerolabs/lz-ton-sdk-v2/artifacts/Endpoint.compiled.json";
import UlnConnectionArtifact from "@layerzerolabs/lz-ton-sdk-v2/artifacts/UlnConnection.compiled.json";
import ChannelArtifact from "@layerzerolabs/lz-ton-sdk-v2/artifacts/Channel.compiled.json";

// ─── Address Utilities ─────────────────────────────────────

function isHexString(value: string): boolean {
    return /^(0x)?[0-9A-Fa-f]*$/.test(value);
}

function to32ByteBuffer(value: bigint | number | string | Uint8Array): Buffer {
    if (typeof value === "string") {
        if (!isHexString(value)) {
            throw new Error("only hex string is supported");
        }
        let hex = value.replace(/^0x/, "");
        if (hex.length % 2 !== 0) {
            hex = "0" + hex;
        }
        value = toBigIntBE(Buffer.from(hex, "hex"));
    }
    if (value instanceof Uint8Array) {
        value = toBigIntBE(Buffer.from(value));
    }
    const bf = toBufferBE(BigInt(value), 66);
    return bf.subarray(-32);
}

function bigintToAddress(value: bigint): Address {
    const buf = to32ByteBuffer(value);
    return Address.parse(`0:${buf.toString("hex")}`);
}

type AddressTypeLike = Address | string | bigint;

export function parseTonAddress(address: AddressTypeLike): Address {
    if (address instanceof Address) return address;
    if (typeof address === "bigint" || typeof address === "number") {
        return bigintToAddress(BigInt(address));
    }
    if (address.startsWith("0x")) {
        return bigintToAddress(BigInt(address));
    }
    try {
        return Address.parse(address);
    } catch {
        return bigintToAddress(BigInt(`0x${address}`));
    }
}

export function addressToBigInt(address: AddressTypeLike): bigint {
    return BigInt(`0x${parseTonAddress(address).hash.toString("hex")}`);
}

export function bigIntToAddress(address: bigint): Address {
    return parseTonAddress("0x" + address.toString(16));
}

// ─── Cell Builders ─────────────────────────────────────────

export function objectBuild(tonObjects: Record<string, any>) {
    const generated = generateBuildClass(tonObjects);
    return Object.fromEntries(
        Object.keys(tonObjects).map((key) => [
            key,
            (fields: any) => generated(key, fields),
        ])
    ) as Record<string, (fields: any) => Cell>;
}

export function objectDecode(tonObjects: Record<string, any>) {
    const generated = generateDecodeClass(tonObjects);
    return Object.fromEntries(
        Object.keys(tonObjects).map((key) => [
            key,
            (cell: Cell) => generated(key, cell),
        ])
    ) as Record<string, (cell: Cell) => any>;
}

export function buildTonTransferCell(opts: {
    value: bigint;
    fromAddress?: Address;
    toAddress: Address;
    queryId?: number;
    fwdAmount: bigint;
    jettonAmount: bigint;
    forwardPayload?: Cell | null;
}): Cell {
    const builder = beginCell()
        .storeUint(0xf8a7ea5, 32) // Jetton Transfer opcode
        .storeUint(opts.queryId ?? 69, 64)
        .storeCoins(opts.jettonAmount)
        .storeAddress(opts.toAddress)
        .storeAddress(opts.fromAddress)
        .storeUint(0, 1)
        .storeCoins(opts.fwdAmount);

    if (opts.forwardPayload instanceof Cell) {
        builder.storeBit(1);
        builder.storeRef(opts.forwardPayload);
    } else {
        builder.storeBit(0);
    }

    return builder.endCell();
}

// ─── Contract Address Computation (USDT only) ──────────────

const TON_EID = 30343;

const contractCode = {
    uln: Cell.fromBoc(Buffer.from(UlnArtifact.hex, "hex"))[0],
    endpoint: Cell.fromBoc(Buffer.from(EndpointArtifact.hex, "hex"))[0],
    ulnConnection: Cell.fromBoc(
        Buffer.from(UlnConnectionArtifact.hex, "hex")
    )[0],
    channel: Cell.fromBoc(Buffer.from(ChannelArtifact.hex, "hex"))[0],
};

function computeContractAddress(code: Cell, storage: Cell): bigint {
    return toBigIntBE(
        beginCell()
            .storeUint(6, 5)
            .storeRef(code)
            .storeRef(storage)
            .endCell()
            .hash()
    );
}

function initBaseStorage(owner: bigint) {
    return baseBuildClass("BaseStorage", {
        owner,
        authenticated: false,
        initialized: false,
        initialStorage: emptyCell(),
    });
}

function getUlnReceiveConfigDefault() {
    return buildClass("UlnReceiveConfig", {
        minCommitPacketGasNull: true,
        minCommitPacketGas: 0,
        confirmationsNull: true,
        confirmations: 0,
        requiredDVNsNull: true,
        requiredDVNs: emptyCell(),
        optionalDVNsNull: true,
        optionalDVNs: emptyCell(),
        optionalDVNThreshold: 0,
    });
}

function getUlnSendConfigDefault() {
    return buildClass("UlnSendConfig", {
        workerQuoteGasLimit: 0,
        maxMessageBytes: 0,
        executorNull: true,
        executor: 0n,
        requiredDVNsNull: true,
        requiredDVNs: emptyCell(),
        optionalDVNsNull: true,
        optionalDVNs: emptyCell(),
        confirmationsNull: true,
        confirmations: 0,
    });
}

export function computeTonUlnAddress(
    _kind: "USDT",
    owner: bigint,
    dstEid: bigint
): bigint {
    return computeContractAddress(
        contractCode.uln,
        buildClass("Uln", {
            baseStorage: initBaseStorage(owner),
            eid: TON_EID,
            dstEid,
            defaultUlnReceiveConfig: getUlnReceiveConfigDefault(),
            defaultUlnSendConfig: getUlnSendConfigDefault(),
            connectionCode: emptyCell(),
            workerFeelibInfos: emptyMap(),
            treasuryFeeBps: 0,
            remainingWorkerSlots: 0,
            remainingAdminWorkerSlots: 0,
        })
    );
}

export function computeTonEndpointAddress(
    _kind: "USDT",
    owner: bigint,
    dstEid: bigint
): bigint {
    return computeContractAddress(
        contractCode.endpoint,
        buildClass("Endpoint", {
            baseStorage: initBaseStorage(owner),
            eid: TON_EID,
            dstEid,
            msglibs: emptyMap(),
            numMsglibs: 0,
            channelCode: emptyCell(),
            channelStorageInit: nullObject(),
            defaultSendLibInfo: nullObject(),
            defaultReceiveLibInfo: nullObject(),
            defaultTimeoutReceiveLibInfo: nullObject(),
            defaultSendMsglibManager: 0n,
            defaultExpiry: 0,
        })
    );
}

export function computeTonUlnConnectionAddress(
    _kind: "USDT",
    owner: bigint,
    dstEid: bigint,
    dstOApp: bigint,
    ulnManagerAddress: bigint,
    ulnAddress: bigint
): bigint {
    return computeContractAddress(
        contractCode.ulnConnection,
        buildUlnConnnection(owner, dstEid, dstOApp, ulnManagerAddress, ulnAddress)
    );
}

export function buildUlnConnnection(
    owner: bigint,
    dstEid: bigint,
    dstOApp: bigint,
    ulnManagerAddress: bigint,
    ulnAddress: bigint
) {
    return buildClass("UlnConnection", {
        baseStorage: initBaseStorage(ulnManagerAddress),
        path: {
            srcEid: TON_EID,
            dstEid,
            srcOApp: owner,
            dstOApp,
        },
        endpointAddress: 0n,
        channelAddress: 0n,
        ulnAddress,
        UlnSendConfigOApp: getUlnSendConfigDefault(),
        UlnReceiveConfigOApp: getUlnReceiveConfigDefault(),
        hashLookups: emptyMap(),
        firstUnexecutedNonce: 1,
        commitPOOO: emptyCell(),
    });
}

export function computeTonChannelAddress(
    _kind: "USDT",
    owner: bigint,
    dstEid: bigint,
    dstOApp: bigint,
    controllerAddress: bigint,
    endpointAddress: bigint
): bigint {
    return computeContractAddress(
        contractCode.channel,
        buildClass("Channel", {
            baseStorage: initBaseStorage(controllerAddress),
            path: {
                srcEid: TON_EID,
                dstEid,
                srcOApp: owner,
                dstOApp,
            },
            endpointAddress,
            epConfigOApp: {
                isNull: true,
                sendMsglib: 0n,
                sendMsglibConnection: 0n,
                sendMsglibManager: 0n,
                receiveMsglib: 0n,
                receiveMsglibConnection: 0n,
                timeoutReceiveMsglib: 0n,
                timeoutReceiveMsglibConnection: 0n,
                timeoutReceiveMsglibExpiry: 0,
            },
            outboundNonce: 0,
            sendRequestQueue: emptyCell(),
            lastSendRequestId: 0,
            commitPOOO: emptyPOOO(),
            executePOOO: emptyPOOO(),
            executionQueue: emptyCell(),
            zroBalance: 0,
        })
    );
}
