import { deploy } from "./deploy.js";
import {
  formatEther,
  keccak256,
  stringToHex,
  toBytes,
} from "viem";
import { randomBytes } from "node:crypto";

const id = (text) => keccak256(toBytes(text));
const PASSPORT = id("PASSPORT");
const ROLE_AIRLINE = 2;
const HOUR = 3600;

const step = (n, text) => console.log(`\n[${n}] ${text}`);

async function main() {
  const { viem, identity, sharing, token } = await deploy();

  const [admin, alice, klm, passportOffice] =
    await viem.getWalletClients();

  const publicClient = await viem.getPublicClient();

  const latestTime = async () => {
    const block = await publicClient.getBlock();
    return Number(block.timestamp);
  };

  step(
    1,
    "Admin registers KLM as an airline and the passport office as an issuer"
  );

  await identity.write.RegisterOrganization([
    klm.account.address,
    ROLE_AIRLINE,
    id("KVK-KLM"),
    id("ops@klm.test"),
  ]);

  await identity.write.SetIssuer([
    passportOffice.account.address,
    true,
  ]);

  step(2, "Alice registers as a traveler");

  await identity.write.RegisterTraveler(
    [id("NL-ID-123"), id("alice@mail.com")],
    { account: alice.account }
  );

  step(
    3,
    "Alice hashes her passport file off-chain and stores ONLY the hash"
  );

  const salt = `0x${randomBytes(16).toString("hex")}`;
  const passportFile =
    "PASSPORT|NL|ALICE|1990-01-01|NX1234567";

  const passportHash = keccak256(
    stringToHex(passportFile + salt)
  );

  await identity.write.StoreDocument(
    [
      PASSPORT,
      passportHash,
      BigInt((await latestTime()) + 365 * 24 * HOUR),
    ],
    { account: alice.account }
  );

  console.log("    stored hash:", passportHash);

  step(4, "Passport office attests the hash");

  await identity.write.AttestDocument(
    [alice.account.address, PASSPORT, passportHash],
    { account: passportOffice.account }
  );

  step(5, "Alice grants KLM 48h access to her passport");

  await sharing.write.GrantConsent(
    [
      klm.account.address,
      PASSPORT,
      BigInt((await latestTime()) + 48 * HOUR),
    ],
    { account: alice.account }
  );

  console.log(
    "    Alice's balance:",
    formatEther(
      await token.read.balanceOf([alice.account.address])
    ),
    "TRVL"
  );

  step(6, "KLM accesses the passport hash");

  const [found, onChainHash, attested] =
    await sharing.read.AccessDocument(
      [alice.account.address, PASSPORT],
      { account: klm.account }
    );

  await sharing.write.AccessDocument(
    [alice.account.address, PASSPORT],
    { account: klm.account }
  );

  console.log(
    "    found:",
    found,
    "| attested by issuer:",
    attested
  );

  step(7, "KLM verifies the file Alice sent them (off-chain)");

  console.log(
    "    genuine file matches: ",
    keccak256(stringToHex(passportFile + salt)) ===
      onChainHash
  );

  const tampered = passportFile.replace("ALICE", "MALLORY");

  console.log(
    "    tampered file matches:",
    keccak256(stringToHex(tampered + salt)) ===
      onChainHash
  );

  step(8, "Alice revokes KLM's access");

  await sharing.write.RevokeConsent(
    [klm.account.address, PASSPORT],
    { account: alice.account }
  );

  step(9, "KLM tries again");

  await sharing.write.AccessDocument(
    [alice.account.address, PASSPORT],
    { account: klm.account }
  );

  const [foundAgain] = await sharing.read.AccessDocument(
    [alice.account.address, PASSPORT],
    { account: klm.account }
  );

  console.log("    found:", foundAgain, "-> ACCESS DENIED");

  step(10, "Audit trail read back from the chain");

  const granted = await publicClient.getContractEvents({
    address: sharing.address,
    abi: sharing.abi,
    eventName: "AccessGranted",
    fromBlock: 0n,
  });

  const denied = await publicClient.getContractEvents({
    address: sharing.address,
    abi: sharing.abi,
    eventName: "AccessDenied",
    fromBlock: 0n,
  });

  const aliceGranted = granted.filter(
    (log) =>
      log.args.traveler?.toLowerCase() ===
      alice.account.address.toLowerCase()
  );

  const aliceDenied = denied.filter(
    (log) =>
      log.args.traveler?.toLowerCase() ===
      alice.account.address.toLowerCase()
  );

  console.log(
    `    AccessGranted events: ${aliceGranted.length}, AccessDenied events: ${aliceDenied.length}`
  );

  console.log(
    "    Alice keeps her tokens:",
    formatEther(
      await token.read.balanceOf([alice.account.address])
    ),
    "TRVL"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
