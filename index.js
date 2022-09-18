require("dotenv").config();
import Client, { HTTP } from "drand-client";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, coins, GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromHex, toBase64, toUtf8 } from "@cosmjs/encoding";
import { FaucetClient } from "@cosmjs/faucet-client";
import { assert } from "@cosmjs/utils";
import chalk from "chalk";

global.fetch = fetch;
global.AbortController = AbortController;

const errorColor = chalk.red;
const warningColor = chalk.hex("#FFA500"); // Orange
const successColor = chalk.green;
const infoColor = chalk.gray;

/*
CosmJS
*/
const prefix = process.env.PREFIX;
const denom = process.env.DENOM;
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
const rpcEndpoint = process.env.ENDPOINT;
const signer = await SigningCosmWasmClient.connectWithSigner(rpcEndpoint, wallet, { prefix });
const nois_contract = process.env.NOIS_CONTRACT;

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

assert(process.env.GAS_PRICE, "GAS_PRICE must be set. E.g. '0.025unois'");
const gasPrice = GasPrice.fromString(process.env.GAS_PRICE);
const fee = calculateFee(700_000, gasPrice);

async function start() {
  // See https://github.com/drand/drand-client#api
  const drand_options = { chainHash, disableBeaconVerification: true };
  const client = await Client.wrap(HTTP.forURLs(urls, chainHash), drand_options);

  for await (const res of client.watch()) {
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
        add_round: {
          round: res.round,
          signature: res.signature,
          previous_signature: res.previous_signature,
        },
      };
      const result = await signer.execute(
        firstAccount.address,
        nois_contract,
        msg,
        fee,
        `Insert randomness round: ${res.round}`,
      );
      console.info(
        successColor(
          `✔ Round ${res.round} (Gas: ${result.gasUsed}/${result.gasWanted}; Transaction: ${result.transactionHash})`,
        ),
      );
      const publishTime = timeOfRound(res.round);
      const { block } = await signer.forceGetTmClient().block(result.height);
      const commitTime = block.header.time.getTime() / 1000; // seconds with fractional part
      const diff = commitTime - publishTime;
      console.info(
        infoColor(
          `Broadcast time (local): ${broadcastTime}; Drand publish time: ${publishTime}; Commit time: ${commitTime}; Diff: ${diff.toFixed(
            3,
          )}`,
        ),
      );
    } catch (e) {
      console.error(errorColor(e.toString()));
    }
  }
}

start();
