const hre = require("hardhat");
const { main: deploy } = require("./deploy");

const { ethers } = hre;
const id = (t) => ethers.keccak256(ethers.toUtf8Bytes(t));
const PASSPORT = id("PASSPORT");
const ROLE_AIRLINE = 2;
const HOUR = 3600;

const step = (n, text) => console.log(`\n[${n}] ${text}`);

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function main() {
  const { identity, sharing, token } = await deploy();
  const [admin, alice, klm, passportOffice] = await ethers.getSigners();

  step(1, "Admin registers KLM as an airline and the passport office as an issuer");
  await identity.RegisterOrganization(klm.address, ROLE_AIRLINE, id("KVK-KLM"), id("ops@klm.test"));
  await identity.SetIssuer(passportOffice.address, true);

  step(2, "Alice registers as a traveler");
  await identity.connect(alice).RegisterTraveler(id("NL-ID-123"), id("alice@mail.com"));

  step(3, "Alice hashes her passport file off-chain and stores ONLY the hash");

  const salt = ethers.hexlify(ethers.randomBytes(16));
  const passportFile = "PASSPORT|NL|ALICE|1990-01-01|NX1234567";
  const passportHash = id(passportFile + salt);
  await identity.connect(alice).StoreDocument(PASSPORT, passportHash, (await now()) + 365 * 24 * HOUR);
  console.log("    stored hash:", passportHash);

  step(4, "Passport office attests the hash");
  await identity.connect(passportOffice).AttestDocument(alice.address, PASSPORT, passportHash);

  step(5, "Alice grants KLM 24h access to her passport");
  await sharing.connect(alice).GrantConsent(klm.address, PASSPORT, (await now()) + 24 * HOUR);
  console.log("    Alice's balance:", ethers.formatEther(await token.balanceOf(alice.address)), "TRVL");

  step(6, "KLM accesses the passport hash");
  const [found, onChainHash, attested] = await sharing.connect(klm).AccessDocument.staticCall(alice.address, PASSPORT);
  await sharing.connect(klm).AccessDocument(alice.address, PASSPORT);
  console.log("    found:", found, "| attested by issuer:", attested);

  step(7, "KLM verifies the file Alice sent them (off-chain)");
  console.log("    genuine file matches: ", id(passportFile + salt) === onChainHash);
  const tampered = passportFile.replace("ALICE", "MALLORY");
  console.log("    tampered file matches:", id(tampered + salt) === onChainHash);

  step(8, "Alice revokes KLM's access");
  await sharing.connect(alice).RevokeConsent(klm.address, PASSPORT);

  step(9, "KLM tries again");
  await sharing.connect(klm).AccessDocument(alice.address, PASSPORT);
  const [foundAgain] = await sharing.connect(klm).AccessDocument.staticCall(alice.address, PASSPORT);
  console.log("    found:", foundAgain, "-> ACCESS DENIED");

  step(10, "Audit trail read back from the chain");
  const granted = await sharing.queryFilter(sharing.filters.AccessGranted(alice.address));
  const denied = await sharing.queryFilter(sharing.filters.AccessDenied(alice.address));
  console.log(`    AccessGranted events: ${granted.length}, AccessDenied events: ${denied.length}`);
  console.log("    Alice keeps her tokens:", ethers.formatEther(await token.balanceOf(alice.address)), "TRVL");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
