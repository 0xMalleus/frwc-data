import dotenv from "dotenv";
import { Contract } from "ethers";
import { getProvider } from "../lib/web3";
import { SOULS_ABI } from "../abis/Souls";
import axios from "axios";
import axiosRetry from "axios-retry";
import { ERC721_LITE_ABI } from "../abis/erc721";
import zipWith from "lodash/zipWith";
import {
  Contract as MultiCallContract,
  Provider as MultiCallProvider,
} from "ethcall";
import { PONIES_ABI } from "../abis/Ponies";

dotenv.config();

axiosRetry(axios, { retries: 3 });

export type SoulEntry = {
  tokenId: number;
  transmutedFromTokenContract: string;
  transmutedFromTokenId: number;
  burnIndex: number;
  metadata: any;
};

export async function fetchApiMetadata(
  tokenId: number,
  baseUrl: string
): Promise<any> {
  const url = `${baseUrl}/${tokenId}`;

  console.log(`Fetching metadata for ${tokenId} via ${url}`);
  let res;
  try {
    res = await axios.get(url);
  } catch (e: any) {
    console.error("Fetch from network error (after retries)...");
    console.error("Bad IPFS request: " + e?.message);

    if (e.response.status === 400) {
      // This could happen if say we did have a SoulBurned event but then the owner properly burnt their Soul nft (so no owner)
      console.warn(`Couldn't get metadata for ${tokenId}`);
      return null;
    }
    throw Error("API fetch issue");
  }

  if (res.status >= 200 && res.status < 300) {
    return res.data;
  } else {
    console.error("Bad API request: " + res.statusText);
    throw Error("API issue");
  }
}

export async function fetchNewSouls(
  sinceBlock: number,
  upToBlockNumber: number
): Promise<SoulEntry[]> {
  const provider = getProvider();

  const contract = new Contract(
    process.env.SOULS_CONTRACT as string,
    SOULS_ABI,
    provider
  );

  console.log(`Previous block number: ${sinceBlock}`);
  console.log(`Looking up to block number: ${upToBlockNumber}`);
  console.log(`Fetching new souls from ze chain....`);

  const soulEvents = await contract.queryFilter(
    contract.filters.SoulBurned(),
    sinceBlock,
    upToBlockNumber
  );

  console.log(`Got ${soulEvents.length} new soul events`);

  const entries: SoulEntry[] = [];

  for (let i = 0; i < soulEvents.length; i++) {
    const soulEvent: any = soulEvents[i];

    const soulId = soulEvent.args.soulId.toNumber();

    const metadata = await fetchApiMetadata(
      soulId,
      process.env.SOULS_BASE_URL as string
    );

    if (!metadata) continue;

    const soulEntry: SoulEntry = {
      transmutedFromTokenContract: soulEvent.args.tokenContract,
      transmutedFromTokenId: soulEvent.args.tokenId.toNumber(),
      tokenId: soulId,
      burnIndex: soulEvent.args.burnIdx.toNumber(),
      metadata: metadata,
    };

    entries.push(soulEntry);
  }

  console.log("Souls fetched successfully....");

  return entries;
}

export type PonyEntry = {
  tokenId: number;
  genes: string;
  metadata?: any;
};

export async function fetchNewPonies(
  sinceBlock: number,
  upToBlockNumber: number
): Promise<PonyEntry[]> {
  const provider = getProvider();

  const multiCallProvider = new MultiCallProvider();
  await multiCallProvider.init(provider);

  const multiCallContract = new MultiCallContract(
    process.env.PONIES_CONTRACT as string,
    PONIES_ABI
  );

  const contract = new Contract(
    process.env.PONIES_CONTRACT as string,
    PONIES_ABI,
    provider
  );

  console.log(`Previous block number: ${sinceBlock}`);
  console.log(`Looking up to block number: ${upToBlockNumber}`);
  console.log(`Fetching new ponies from ze chain....`);

  const events = await contract.queryFilter(
    contract.filters.Transfer("0x0000000000000000000000000000000000000000"),
    sinceBlock,
    upToBlockNumber
  );

  console.log(`Got ${events.length} new mints`);

  const tokenIds: number[] = events.map((transfer: any) =>
    transfer.args.tokenId.toNumber()
  );

  const chainData = await multiCallProvider.all(
    tokenIds.map((tokenId: number) => {
      return multiCallContract.genes(tokenId);
    })
  );

  const entries: PonyEntry[] = zipWith(
    tokenIds,
    chainData,
    (tokenId, chainData: any) => ({
      tokenId: tokenId,
      genes: chainData.toString(),
    })
  );

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    const metadata = await fetchApiMetadata(
      entry.tokenId,
      process.env.PONIES_BASE_URL as string
    );

    if (!metadata) continue;

    entry.metadata = metadata;
  }

  console.log("Ponies fetched successfully....");

  return entries;
}

type NewOwnerships = {
  [tokenId: number]: string;
};

export async function fetchNewOwnerships(
  sinceBlock: number,
  upToBlockNumber: number,
  contractAddress: string
): Promise<NewOwnerships> {
  const provider = getProvider();

  const contract = new Contract(contractAddress, ERC721_LITE_ABI, provider);

  console.log(`Previous block number: ${sinceBlock}`);
  console.log(`Looking up to block number: ${upToBlockNumber}`);

  console.log(`Fetching transfers from ze chain....`);

  const transfers = await contract.queryFilter(
    contract.filters.Transfer(),
    sinceBlock,
    upToBlockNumber
  );

  const results: NewOwnerships = {};

  for (let i = 0; i < transfers.length; i++) {
    const transferEvent = transfers[i];
    results[transferEvent.args?.tokenId.toNumber()] = transferEvent.args?.to;
  }

  return results;
}
