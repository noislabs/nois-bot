require("dotenv").config();
import Client, { HTTP } from "drand-client";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, coins, GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromHex, toBase64, toUtf8 } from "@cosmjs/encoding";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import { FaucetClient } from "@cosmjs/faucet-client";

global.fetch = fetch;
global.AbortController = AbortController;

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
    const faucet = new FaucetClient(
      "http://5rh6rhqad1cgvei7qc96ia3n74.ingress.bigtractorplotting.com/",
    );
    await faucet.credit(address, denom);
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

async function start() {
  const drand_options = { chainHash };
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
      const msg = {
        add_round: {
          round: res.round,
          signature: res.signature,
          previous_signature: res.previous_signature,
        },
      };

      const sendMsg = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: MsgExecuteContract.fromPartial({
          sender: firstAccount.address,
          contract: nois_contract,
          msg: toUtf8(JSON.stringify(msg)),
        }),
      };
      const gasPrice = GasPrice.fromString(`0.025${denom}`);
      const fee = calculateFee(700_000, gasPrice);
      console.info(`Submitting drand round ${res.round} ...`);
      const result = await signer.signAndBroadcast(
        firstAccount.address,
        [sendMsg],
        fee,
        `Insert randomness round: ${res.round}`,
      );
      assertIsDeliverTxSuccess(result);
      console.info(
        `Successfully submitted round ${res.round}. Gas: ${result.gasUsed}/${result.gasWanted}; Transaction: ${result.transactionHash}`,
      );
    } catch (e) {
      console.error(e.toString());
    }
  }
}

start();
