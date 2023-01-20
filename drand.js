export const drandChainHash = "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"; // (hex encoded)
export const drandUrls = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
  // ...
];

const drandGenesis = 1595431050;
const drandRoundLength = 30;

// See TimeOfRound implementation: https://github.com/drand/drand/blob/eb36ba81e3f28c966f95bcd602f60e7ff8ef4c35/chain/time.go#L30-L33
export function timeOfRound(round) {
  return drandGenesis + (round - 1) * drandRoundLength;
}

// Returns the time in seconds how long this beacon has been published
export function publishedSince(round) {
  return Date.now()/1000 - timeOfRound(round);
}
