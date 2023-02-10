import { sha256 } from "@cosmjs/crypto";
import { toUtf8 } from "@cosmjs/encoding";

export function group(address) {
  const hash = sha256(toUtf8(address))[0];
  if (hash % 2 == 0) return "A";
  else return "B";
}

export function eligibleGroup(round) {
  if (round % 2 == 0) return "A";
  else return "B";
}

export function isMyGroup(address, round) {
  return eligibleGroup(round) == group(address);
}
