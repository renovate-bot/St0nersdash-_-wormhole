import {
  Commitment,
  Connection,
  PublicKey,
  PublicKeyInitData,
} from "@solana/web3.js";
import { LCDClient } from "@terra-money/terra.js";
import { BigNumber, ethers } from "ethers";
import { arrayify, zeroPad } from "ethers/lib/utils";
import { WormholeWrappedInfo } from "..";
import { canonicalAddress } from "../cosmos";
import { TokenImplementation__factory } from "../ethers-contracts";
import { getWrappedMeta } from "../solana/nftBridge";
import {
  ChainId,
  ChainName,
  CHAIN_ID_SOLANA,
  CHAIN_ID_TERRA,
  coalesceChainId,
} from "../utils";
import { getIsWrappedAssetEth } from "./getIsWrappedAsset";

// TODO: remove `as ChainId` and return number in next minor version as we can't ensure it will match our type definition
export interface WormholeWrappedNFTInfo {
  isWrapped: boolean;
  chainId: ChainId;
  assetAddress: Uint8Array;
  tokenId?: string;
}

/**
 * Returns a origin chain and asset address on {originChain} for a provided Wormhole wrapped address
 * @param nftBridgeAddress
 * @param provider
 * @param wrappedAddress
 * @returns
 */
export async function getOriginalAssetEth(
  nftBridgeAddress: string,
  provider: ethers.Signer | ethers.providers.Provider,
  wrappedAddress: string,
  tokenId: string,
  lookupChain: ChainId | ChainName
): Promise<WormholeWrappedNFTInfo> {
  const isWrapped = await getIsWrappedAssetEth(
    nftBridgeAddress,
    provider,
    wrappedAddress
  );
  if (isWrapped) {
    const token = TokenImplementation__factory.connect(
      wrappedAddress,
      provider
    );
    const chainId = (await token.chainId()) as ChainId; // origin chain
    const assetAddress = await token.nativeContract(); // origin address
    return {
      isWrapped: true,
      chainId,
      assetAddress:
        chainId === CHAIN_ID_SOLANA
          ? arrayify(BigNumber.from(tokenId))
          : arrayify(assetAddress),
      tokenId, // tokenIds are maintained across EVM chains
    };
  }
  return {
    isWrapped: false,
    chainId: coalesceChainId(lookupChain),
    assetAddress: zeroPad(arrayify(wrappedAddress), 32),
    tokenId,
  };
}

/**
 * Returns a origin chain and asset address on {originChain} for a provided Wormhole wrapped address
 * @param connection
 * @param nftBridgeAddress
 * @param mintAddress
 * @param [commitment]
 * @returns
 */
export async function getOriginalAssetSolana(
  connection: Connection,
  nftBridgeAddress: PublicKeyInitData,
  mintAddress: PublicKeyInitData,
  commitment?: Commitment
): Promise<WormholeWrappedNFTInfo> {
  try {
    const mint = new PublicKey(mintAddress);

    return getWrappedMeta(connection, nftBridgeAddress, mintAddress, commitment)
      .catch((_) => null)
      .then((meta) => {
        if (meta === null) {
          return {
            isWrapped: false,
            chainId: CHAIN_ID_SOLANA,
            assetAddress: mint.toBytes(),
          };
        } else {
          return {
            isWrapped: true,
            chainId: meta.chain as ChainId,
            assetAddress: Uint8Array.from(meta.tokenAddress),
            tokenId: meta.tokenId.toString(),
          };
        }
      });
  } catch (_) {
    return {
      isWrapped: false,
      chainId: CHAIN_ID_SOLANA,
      assetAddress: new Uint8Array(32),
    };
  }
}

export const getOriginalAssetSol = getOriginalAssetSolana;

// Derived from https://www.jackieli.dev/posts/bigint-to-uint8array/
const big0 = BigInt(0);
const big1 = BigInt(1);
const big8 = BigInt(8);

function bigToUint8Array(big: bigint) {
  if (big < big0) {
    const bits: bigint = (BigInt(big.toString(2).length) / big8 + big1) * big8;
    const prefix1: bigint = big1 << bits;
    big += prefix1;
  }
  let hex = big.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  } else if (hex[0] === "8") {
    // maximum positive need to prepend 0 otherwise resuts in negative number
    hex = "00" + hex;
  }
  const len = hex.length / 2;
  const u8 = new Uint8Array(len);
  var i = 0;
  var j = 0;
  while (i < len) {
    u8[i] = parseInt(hex.slice(j, j + 2), 16);
    i += 1;
    j += 2;
  }
  return u8;
}

export async function getOriginalAssetTerra(
  client: LCDClient,
  wrappedAddress: string,
  lookupChain: ChainId | ChainName
): Promise<WormholeWrappedInfo> {
  try {
    const result: {
      asset_address: string;
      asset_chain: ChainId;
      bridge: string;
    } = await client.wasm.contractQuery(wrappedAddress, {
      wrapped_asset_info: {},
    });
    if (result) {
      return {
        isWrapped: true,
        chainId: result.asset_chain,
        assetAddress: new Uint8Array(
          Buffer.from(result.asset_address, "base64")
        ),
      };
    }
  } catch (e) {}
  return {
    isWrapped: false,
    chainId: coalesceChainId(lookupChain),
    assetAddress: zeroPad(canonicalAddress(wrappedAddress), 32),
  };
}
