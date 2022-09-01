require('dotenv').config()
import Client, { HTTP } from 'drand-client'
import fetch from 'node-fetch'
import AbortController from 'abort-controller'
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import {DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromHex, toBase64, toUtf8 } from "@cosmjs/encoding";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";

global.fetch = fetch
global.AbortController = AbortController

/*
    CosmJS
 */
const mnemonic = process.env.MNEMONIC;
console.log(process.env.MNEMONIC)
const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic);
const [firstAccount] = await wallet.getAccounts();

const rpcEndpoint = process.env.ENDPOINT;
const signer = await SigningCosmWasmClient.connectWithSigner(rpcEndpoint, wallet);
const nois_contract = process.env.NOIS_CONTRACT;

/*
    DRAND
 */
const chainHash = process.env.CHAIN_HASH // (hex encoded)
const urls = [
    'https://api.drand.sh',
    'https://api2.drand.sh',
    'https://api3.drand.sh',
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

            const msg = {
                add_round: {
                    round: res.round,
                    signature: res.signature,
                    previous_signature: res.previous_signature
                }
            }

            const sendMsg =  {
                typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
                value: MsgExecuteContract.fromPartial({
                    sender: firstAccount.address,
                    contract: nois_contract,
                    msg: toUtf8(JSON.stringify(msg)),
                })
            }

            const result = await signer.signAndBroadcast(firstAccount.address, [sendMsg], 1_000_000, `Insert randomness round: ${res.round}`)
            assertIsDeliverTxSuccess(result)
        }catch (e) {
            console.log(e)
        }

    }
}

start()
