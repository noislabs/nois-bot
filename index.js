import Client, { HTTP } from 'drand-client'
import fetch from 'node-fetch'
import AbortController from 'abort-controller'
import { assertIsBroadcastTxSuccess, SigningStargateClient, StargateClient } from "@cosmjs/stargate";

global.fetch = fetch
global.AbortController = AbortController

/*
    CosmJS
 */
const mnemonic = process.env.MNEMONIC;
const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic);
const [firstAccount] = await wallet.getAccounts();

const rpcEndpoint = process.env.ENDPOINT;
const signer = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);

const recipient = process.env.RECIPIENT;
// const amount = {
//     denom: "",
//     amount: "",
// };

/*
    DRAND
 */
const chainHash = '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce' // (hex encoded)
const urls = [
    'https://api.drand.sh',
    'https://drand.cloudflare.com'
    // ...
]

async function start (){
    const options = { chainHash }
    const client = await Client.wrap(HTTP.forURLs(urls, chainHash), options)

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
            const result = await signer.signAndBroadcast(firstAccount.address, [], "auto", "Insert drand")
            assertIsBroadcastTxSuccess(result);
        }catch (e) {
            console.log(e)
        }

    }
}

start()
