import * as dotenv from "dotenv";
import Client, { HTTP } from "drand-client";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { CosmWasmClient, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, logs, GasPrice } from "@cosmjs/stargate";
import { toUtf8 } from "@cosmjs/encoding";
import { Decimal } from "@cosmjs/math";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { assert, sleep } from "@cosmjs/utils";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import chalk from "chalk";
import { drandChainHash, publishedSince, drandUrls, timeOfRound } from "./drand.js";
import { shuffle } from "./shuffle.js";
import { group, isMyGroup } from "./group.js";

dotenv.config();

global.fetch = fetch;
global.AbortController = AbortController;

const errorColor = chalk.red;
const warningColor = chalk.hex("#FFA500"); // Orange
const successColor = chalk.green;
const infoColor = chalk.gray;

// Required env vars
assert(process.env.PREFIX, "PREFIX must be set");
const prefix = process.env.PREFIX;
assert(process.env.DENOM, "DENOM must be set");
/** The fee denom */
const denom = process.env.DENOM;
assert(process.env.ENDPOINT, "ENDPOINT must be set");
const endpoint = process.env.ENDPOINT;
assert(process.env.NOIS_CONTRACT, "NOIS_CONTRACT must be set");
const noisContract = process.env.NOIS_CONTRACT;
assert(process.env.GAS_PRICE, "GAS_PRICE must be set. E.g. '0.025unois'");
const gasPrice = GasPrice.fromString(process.env.GAS_PRICE);
// Optional env vars
const endpoint2 = process.env.ENDPOINT2 || null;
const endpoint3 = process.env.ENDPOINT3 || null;

/*
CosmJS
*/
const mnemonic = await (async () => {
  if (process.env.MNEMONIC) {
    return process.env.MNEMONIC;
  } else {
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix });
    const newMnemonic = wallet.mnemonic;
    const [account] = await wallet.getAccounts();
    const address = account.address;
    console.log(`Generated new mnemonic: ${newMnemonic} and address ${address}`);
    return newMnemonic;
  }
})();

const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
const [firstAccount] = await wallet.getAccounts();
const client = await SigningCosmWasmClient.connectWithSigner(endpoint, wallet, {
  prefix,
  gasPrice,
});
const botAddress = firstAccount.address;

console.log(infoColor(`Bot address: ${botAddress}`));
console.log(infoColor(`Group: ${group(botAddress)}`));

let nextSignData = {
  chainId: "",
  accountNumber: NaN,
  sequence: NaN,
};

function getNextSignData() {
  let out = { ...nextSignData }; // copy values
  nextSignData.sequence += 1;
  return out;
}

// Needed in case an error happened to ensure sequence is in sync
// with chain
async function resetSignData() {
  nextSignData = {
    chainId: await client.getChainId(),
    ...(await client.getSequence(botAddress)),
  };
  console.log(infoColor(`Sign data set to: ${JSON.stringify(nextSignData)}`));
}

// Shuffle enpoints to reduce likelyhood of two bots ending up with the same endpoint
shuffle(drandUrls);

function printableCoin(coin) {
  if (coin.denom?.startsWith("u")) {
    const ticker = coin.denom.slice(1).toUpperCase();
    return Decimal.fromAtomics(coin.amount ?? "0", 6).toString() + " " + ticker;
  } else {
    return coin.amount + coin.denom;
  }
}

function isSet(a) {
  return a !== null && a !== undefined;
}

const fee = calculateFee(750_000, gasPrice);

export function ibcPacketsSent(resultLogs) {
  const allEvents = resultLogs.flatMap((log) => log.events);
  const packetsEvents = allEvents.filter((e) => e.type === "send_packet");
  const attributes = packetsEvents.flatMap((e) => e.attributes);
  const packetsSentCount = attributes.filter((a) => a.key === "packet_sequence").length;
  return packetsSentCount;
}

async function main() {
  console.info(infoColor(`Connected to ENDPOINT ${endpoint}.`));
  console.info(infoColor(`Chain ID: ${await client.getChainId()}`));
  console.info(infoColor(`Height: ${await client.getHeight()}`));

  // See https://github.com/drand/drand-client#api
  const drandOptions = { chainHash: drandChainHash, disableBeaconVerification: true };
  const drandClient = await Client.wrap(HTTP.forURLs(drandUrls, drandChainHash), drandOptions);

  const broadcaster2 = endpoint2 ? await CosmWasmClient.connect(endpoint2) : null;
  const broadcaster3 = endpoint3 ? await CosmWasmClient.connect(endpoint3) : null;

  const moniker = process.env.MONIKER;
  if (moniker) {
    console.info(infoColor("Registering this bot ..."));
    await client.execute(
      botAddress,
      noisContract,
      {
        register_bot: { moniker: moniker },
      },
      "auto",
    );
  }

  // We need a bit of a delay between the bot registration tx and the
  // sign data query to ensure the sequence is updated.
  await Promise.all([
    sleep(500), // the min waiting time
    (async function () {
      const { listed } = await client.queryContractSmart(noisContract, {
        is_allow_listed: { bot: botAddress },
      });
      console.info(infoColor(`Bot allow listed for rewards: ${listed}`));
    })(),
  ]);

  // Initialize local sign data
  await resetSignData();

  for await (const res of drandClient.watch()) {
    /*
            /// Example of response
            {
              round: 2219943,
              randomness: 'f53a54f5...',
              signature: '8072acccd...',
              previous_signature: '98670f6c6...'
            }

            Use res.randomness to insert randomness
         */
    try {
      const sincePublish = publishedSince(res.round);
      console.info(infoColor(`Received drand round ${res.round} after ${sincePublish.toFixed(3)}s. Submitting ...`));

      if (!isMyGroup(botAddress, res.round)) {
        console.info(infoColor(`Not my turn, skipping.`));
        continue;
      }

      const broadcastTime = Date.now() / 1000;
      const msg = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: MsgExecuteContract.fromPartial({
          sender: botAddress,
          contract: noisContract,
          msg: toUtf8(
            JSON.stringify({
              add_round: {
                round: res.round,
                signature: res.signature,
                previous_signature: res.previous_signature,
              },
            }),
          ),
          funds: [],
        }),
      };
      const memo = `Insert randomness round: ${res.round}`;
      const signData = getNextSignData(); // Do this the manual way to save one query
      const signed = await client.sign(botAddress, [msg], fee, memo, signData);
      const tx = Uint8Array.from(TxRaw.encode(signed).finish());

      const p1 = client.broadcastTx(tx);
      const p2 = broadcaster2?.broadcastTx(tx);
      const p3 = broadcaster3?.broadcastTx(tx);

      p1.then(
        () => console.log(infoColor("Broadcast 1 succeeded")),
        (err) => console.warn(warningColor(`Broadcast 1 failed: ${err}`)),
      );
      p2?.then(
        () => console.log(infoColor("Broadcast 2 succeeded")),
        (err) => console.warn(warningColor(`Broadcast 2 failed: ${err}`)),
      );
      p3?.then(
        () => console.log(infoColor("Broadcast 3 succeeded")),
        (err) => console.warn(warningColor(`Broadcast 3 failed: ${err}`)),
      );

      const result = await Promise.any([p1, p2, p3].filter(isSet));
      assertIsDeliverTxSuccess(result);
      const parsedLogs = logs.parseRawLog(result.rawLog);
      const jobs = ibcPacketsSent(parsedLogs);
      console.info(
        successColor(
          `✔ Round ${res.round} (Gas: ${result.gasUsed}/${result.gasWanted}; Jobs processed: ${jobs}; Transaction: ${result.transactionHash})`,
        ),
      );
      const publishTime = timeOfRound(res.round);
      const { block } = await client.forceGetTmClient().block(result.height);
      const commitTime = block.header.time.getTime() / 1000; // seconds with fractional part
      const diff = commitTime - publishTime;
      console.info(
        infoColor(
          `Broadcast time (local): ${broadcastTime}; Drand publish time: ${publishTime}; Commit time: ${commitTime}; Diff: ${diff.toFixed(
            3,
          )}`,
        ),
      );

      // Some seconds after the submission when things are idle, check and log
      // the balance of the bot.
      setTimeout(() => {
        client.getBalance(botAddress, denom).then(
          (balance) => {
            console.log(infoColor(`Balance: ${printableCoin(balance)}`));
          },
          (error) => console.warn(warningColor(`Error getting bot balance: ${error}`)),
        );
      }, 5_000);
    } catch (e) {
      console.error(errorColor(e.toString()));

      // In case of an error, reset the chain ID and sequence to the on-chain values.
      // If this also fails, the process is killed since the error here is not caught anymore.
      console.info(infoColor("Resetting sign data ..."));
      await resetSignData();
    }
  }
}

main().then(
  () => {
    console.info("Done");
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
