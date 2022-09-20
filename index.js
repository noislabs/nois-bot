import * as dotenv from "dotenv";
import Client, { HTTP } from "drand-client";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { CosmWasmClient, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, coins, GasPrice } from "@cosmjs/stargate";
import { toUtf8 } from "@cosmjs/encoding";
import { Decimal } from "@cosmjs/math";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { FaucetClient } from "@cosmjs/faucet-client";
import { assert } from "@cosmjs/utils";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import chalk from "chalk";

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
    let wallet = await DirectSecp256k1HdWallet.generate(12, { prefix });
    const newMnemonic = wallet.mnemonic;
    const [account] = await wallet.getAccounts();
    const address = account.address;
    console.log(`Generated new mnemonic: ${newMnemonic} and address ${address}`);
    const faucetEndpoint = process.env.FAUCET_ENDPOINT;
    if (faucetEndpoint) {
      const faucet = new FaucetClient(faucetEndpoint);
      await faucet.credit(address, denom);
    } else {
      console.warn(
        "MNEMONIC and FAUCET_ENDPOINT are unset. Bot account has probably has no funds.",
      );
    }
    return newMnemonic;
  }
})();

const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
const [firstAccount] = await wallet.getAccounts();
const client = await SigningCosmWasmClient.connectWithSigner(endpoint, wallet, { prefix });

/*
    DRAND
 */
const chainHash = process.env.CHAIN_HASH; // (hex encoded)
const urls = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
  // ...
];

const drandGenesis = 1595431050;
const drandRoundLength = 30;

// See TimeOfRound implementation: https://github.com/drand/drand/blob/eb36ba81e3f28c966f95bcd602f60e7ff8ef4c35/chain/time.go#L30-L33
function timeOfRound(round) {
  return drandGenesis + (round - 1) * drandRoundLength;
}

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

const fee = calculateFee(700_000, gasPrice);

async function main() {
  // See https://github.com/drand/drand-client#api
  const drand_options = { chainHash, disableBeaconVerification: true };
  const drandClient = await Client.wrap(HTTP.forURLs(urls, chainHash), drand_options);

  let broadcaster2 = endpoint2 ? await CosmWasmClient.connect(endpoint2) : null;
  let broadcaster3 = endpoint3 ? await CosmWasmClient.connect(endpoint3) : null;

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
      console.info(infoColor(`Submitting drand round ${res.round} ...`));
      const broadcastTime = Date.now() / 1000;
      const msg = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: MsgExecuteContract.fromPartial({
          sender: firstAccount.address,
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
      const signed = await client.sign(firstAccount.address, [msg], fee, memo);
      const tx = Uint8Array.from(TxRaw.encode(signed).finish());

      const p1 = client.broadcastTx(tx);
      const p2 = broadcaster2?.broadcastTx(tx);
      const p3 = broadcaster3?.broadcastTx(tx);

      p1.then(
        () => console.log(infoColor("Broadcast 1 succeeded")),
        (_err) => console.error("Broadcast 1 failed"),
      );
      p2?.then(
        () => console.log(infoColor("Broadcast 2 succeeded")),
        (_err) => console.error("Broadcast 2 failed"),
      );
      p3?.then(
        () => console.log(infoColor("Broadcast 3 succeeded")),
        (_err) => console.error("Broadcast 3 failed"),
      );

      const result = await Promise.any([p1, p2, p3].filter(isSet));
      assertIsDeliverTxSuccess(res);
      console.info(
        successColor(
          `✔ Round ${res.round} (Gas: ${result.gasUsed}/${result.gasWanted}; Transaction: ${result.transactionHash})`,
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
        client.getBalance(firstAccount.address, denom).then(
          (balance) => {
            console.log(infoColor(`Balance: ${printableCoin(balance)}`));
          },
          (error) => console.warn(warningColor(`Error getting bot balance: ${error}`)),
        );
      }, 5_000);
    } catch (e) {
      console.error(errorColor(e.toString()));
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
