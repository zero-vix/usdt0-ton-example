/**
 * USDT0 OFT object schema definitions for TON.
 *
 * Subset of the full schema — only the entries used by this bridge script.
 * Generated originally by sdk/sdk-generator.ts in the LayerZero monorepo.
 */

export const tonObjectsUsdt0 = {
  OFTSend: {
    name: 'OFTSend',
    0: {
      fieldName: 'OFTSend::dstEid',
      fieldType: 'cl::t::uint32',
    },
    1: {
      fieldName: 'OFTSend::to',
      fieldType: 'cl::t::address',
    },
    2: {
      fieldName: 'OFTSend::minAmount',
      fieldType: 'cl::t::coins',
    },
    3: {
      fieldName: 'OFTSend::nativeFee',
      fieldType: 'cl::t::coins',
    },
    4: {
      fieldName: 'OFTSend::zroFee',
      fieldType: 'cl::t::coins',
    },
    5: {
      fieldName: 'OFTSend::extraOptions',
      fieldType: 'cl::t::objRef',
    },
    6: {
      fieldName: 'OFTSend::composeMessage',
      fieldType: 'cl::t::cellRef',
    },
  },
  UsdtOFT: {
    name: 'usdtOFT',
    0: {
      fieldName: 'UsdtOFT::oAppStorage',
      fieldType: 'cl::t::objRef',
    },
    1: {
      fieldName: 'UsdtOFT::credits',
      fieldType: 'cl::t::objRef',
    },
    2: {
      fieldName: 'UsdtOFT::contractBalance',
      fieldType: 'cl::t::coins',
    },
    3: {
      fieldName: 'UsdtOFT::feeBalance',
      fieldType: 'cl::t::coins',
    },
    4: {
      fieldName: 'UsdtOFT::feeBps',
      fieldType: 'cl::t::uint16',
    },
    5: {
      fieldName: 'UsdtOFT::contractWalletAddress',
      fieldType: 'cl::t::address',
    },
    6: {
      fieldName: 'UsdtOFT::plannerAddress',
      fieldType: 'cl::t::address',
    },
    7: {
      fieldName: 'UsdtOFT::gasAsserts',
      fieldType: 'cl::t::objRef',
    },
    8: {
      fieldName: 'UsdtOFT::costAsserts',
      fieldType: 'cl::t::objRef',
    },
    9: {
      fieldName: 'UsdtOFT::recoverRequest',
      fieldType: 'cl::t::objRef',
    },
    10: {
      fieldName: 'UsdtOFT::lpAdminAddress',
      fieldType: 'cl::t::address',
    },
    11: {
      fieldName: 'UsdtOFT::maxComposeMessageBytes',
      fieldType: 'cl::t::uint32',
    },
  },
  GasAsserts: {
    name: 'GasAssert',
    0: {
      fieldName: 'GasAsserts::sendOFTGas',
      fieldType: 'cl::t::uint32',
    },
    1: {
      fieldName: 'GasAsserts::sendOFTGasReceiveGas',
      fieldType: 'cl::t::uint32',
    },
    2: {
      fieldName: 'GasAsserts::sendCreditsGas',
      fieldType: 'cl::t::uint32',
    },
    3: {
      fieldName: 'GasAsserts::sendCreditsGasReceiveGas',
      fieldType: 'cl::t::uint32',
    },
    4: {
      fieldName: 'GasAsserts::lzReceiveExecuteCallbackGas',
      fieldType: 'cl::t::uint32',
    },
    5: {
      fieldName: 'GasAsserts::sendOFTComposeGas',
      fieldType: 'cl::t::uint32',
    },
  },
} as const;
