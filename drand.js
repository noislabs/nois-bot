const chainHash = "dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493";
const publicKey =
  "a0b862a7527fee3a731bcb59280ab6abd62d5c0b6ea03dc4ddf6612fdfc9d01f01c31542541771903475eb1ec6615f8d0df0b8b6dce385811d6dcf8cbefb8759e5e616a3dfd054c928940766d9a5b9db91e3b697e5d70a975181e007f87fca5e";

export const drandUrls = [
  // `https://api.drand.sh/${chainHash}`,
  `https://api2.drand.sh/${chainHash}`,
  `https://api3.drand.sh/${chainHash}`,
  `https://drand.cloudflare.com/${chainHash}`,
  // ...
];

export const drandOptions = {
  disableBeaconVerification: true,
  noCache: false,
  chainVerificationParams: { chainHash, publicKey },
};

const drandGenesis = 1677685200;
const drandRoundLength = 3;

// See TimeOfRound implementation: https://github.com/drand/drand/blob/eb36ba81e3f28c966f95bcd602f60e7ff8ef4c35/chain/time.go#L30-L33
export function timeOfRound(round) {
  return drandGenesis + (round - 1) * drandRoundLength;
}

/**
 * Returns the time in milliseconds how long this beacon has been published
 */
export function publishedSince(round) {
  return Date.now() - timeOfRound(round) * 1000;
}
