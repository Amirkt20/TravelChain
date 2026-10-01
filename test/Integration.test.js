import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther, keccak256, toBytes } from "viem";
import { id, DOC, HOUR, DAY, deployAll } from "./helpers.js";

async function latestTime(viem) {
  const publicClient = await viem.getPublicClient();
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

describe("Integration: full travel journeys", function () {
  it("Traveler -> Passport -> Airline: grant, access, verify, revoke, denied", async function () {
    const { viem, identity, sharing, token, traveler, airline, issuer } =
      await deployAll();

    const passportFile = "PASSPORT|NL|ALICE|1990-01-01|NX1234567";
    const passportHash = keccak256(toBytes(passportFile));
    const now = await latestTime(viem);

    await identity.write.StoreDocument(
      [DOC.PASSPORT, passportHash, BigInt(now + 365 * DAY)],
      { account: traveler.account }
    );

    await identity.write.AttestDocument(
      [traveler.account.address, DOC.PASSPORT, passportHash],
      { account: issuer.account }
    );

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    const balance = await token.read.balanceOf([traveler.account.address]);
    assert.equal(balance, parseEther("10"));

    const [found, onChainHash, attested] =
      await sharing.read.AccessDocument(
        [traveler.account.address, DOC.PASSPORT],
        { account: airline.account }
      );

    assert.equal(found, true);
    assert.equal(attested, true);
    assert.equal(keccak256(toBytes(passportFile)), onChainHash);

    const tampered = passportFile.replace("ALICE", "MALLORY");
    assert.notEqual(keccak256(toBytes(tampered)), onChainHash);

    await sharing.write.RevokeConsent(
      [airline.account.address, DOC.PASSPORT],
      { account: traveler.account }
    );

    const [foundAfter] = await sharing.read.AccessDocument(
      [traveler.account.address, DOC.PASSPORT],
      { account: airline.account }
    );

    assert.equal(foundAfter, false);
  });

  it("consent is per requester: hotel can't use the airline's consent", async function () {
    const { viem, identity, sharing, traveler, airline, hotel } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), 0n],
      { account: traveler.account }
    );

    const now = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    const [found] = await sharing.read.AccessDocument(
      [traveler.account.address, DOC.PASSPORT],
      { account: hotel.account }
    );

    assert.equal(found, false);
  });

  it("consent is per document: passport consent doesn't expose the visa", async function () {
    const { viem, identity, sharing, traveler, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), 0n],
      { account: traveler.account }
    );

    await identity.write.StoreDocument(
      [DOC.VISA, id("v"), 0n],
      { account: traveler.account }
    );

    const now = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    const [found] = await sharing.read.AccessDocument(
      [traveler.account.address, DOC.VISA],
      { account: airline.account }
    );

    assert.equal(found, false);
  });

  it("consent is per traveler: Alice's consent doesn't expose Bob", async function () {
    const { viem, identity, sharing, traveler, traveler2, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("alice"), 0n],
      { account: traveler.account }
    );

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("bob"), 0n],
      { account: traveler2.account }
    );

    const now = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    const [found] = await sharing.read.AccessDocument(
      [traveler2.account.address, DOC.PASSPORT],
      { account: airline.account }
    );

    assert.equal(found, false);
  });

  it("an attacker cannot grant themselves access to someone else's passport", async function () {
    const { viem, identity, consent, sharing, traveler, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), 0n],
      { account: traveler.account }
    );

    const now = await latestTime(viem);
    const expiry = BigInt(now + 2 * DAY);

    await assert.rejects(
      consent.write.SetConsent(
        [
          traveler.account.address,
          airline.account.address,
          DOC.PASSPORT,
          expiry,
        ],
        { account: airline.account }
      )
    );

    await assert.rejects(
      sharing.write.GrantConsent(
        [airline.account.address, DOC.PASSPORT, expiry],
        { account: airline.account }
      )
    );
  });

  it("full trip: passport + visa to airline, booking to hotel, in one batch", async function () {
    const { viem, identity, sharing, token, traveler, airline, hotel } =
      await deployAll();

    const now = await latestTime(viem);
    const yearFromNow = BigInt(now + 365 * DAY);

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), yearFromNow],
      { account: traveler.account }
    );

    await identity.write.StoreDocument(
      [DOC.VISA, id("v"), yearFromNow],
      { account: traveler.account }
    );

    await identity.write.StoreDocument(
      [DOC.HOTEL_BOOKING, id("h"), 0n],
      { account: traveler.account }
    );

    const expiry = BigInt(now + 7 * DAY);

    await sharing.write.GrantMultipleConsents(
      [
        [
          airline.account.address,
          airline.account.address,
          hotel.account.address,
        ],
        [DOC.PASSPORT, DOC.VISA, DOC.HOTEL_BOOKING],
        [expiry, expiry, expiry],
      ],
      { account: traveler.account }
    );

    const balance = await token.read.balanceOf([traveler.account.address]);
    assert.equal(balance, parseEther("30"));

    assert.equal(
      await sharing.read.CanAccess([
        traveler.account.address,
        airline.account.address,
        DOC.VISA,
      ]),
      true
    );

    assert.equal(
      await sharing.read.CanAccess([
        traveler.account.address,
        hotel.account.address,
        DOC.HOTEL_BOOKING,
      ]),
      true
    );

    assert.equal(
      await sharing.read.CanAccess([
        traveler.account.address,
        hotel.account.address,
        DOC.PASSPORT,
      ]),
      false
    );
  });

  it("denied access is logged on-chain", async function () {
    const { viem, identity, sharing, traveler, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("audit-passport"), 0n],
      { account: traveler.account }
    );

    const publicClient = await viem.getPublicClient();

    const txHash = await sharing.write.AccessDocument(
      [traveler.account.address, DOC.PASSPORT],
      { account: airline.account }
    );

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    assert.equal(receipt.status, "success");

    const logs = await publicClient.getContractEvents({
      address: sharing.address,
      abi: sharing.abi,
      eventName: "AccessDenied",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    const matchingLogs = logs.filter(
      (log) =>
        log.args.traveler?.toLowerCase() ===
          traveler.account.address.toLowerCase() &&
        log.args.requester?.toLowerCase() ===
          airline.account.address.toLowerCase()
    );

    assert.equal(matchingLogs.length, 1);
    assert.equal(matchingLogs[0].args.docType, DOC.PASSPORT);
    assert.equal(matchingLogs[0].args.reason, 0);
  });


  it("every successful access is logged on-chain", async function () {
    const { viem, identity, sharing, traveler, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("logged-passport"), 0n],
      { account: traveler.account }
    );

    const now = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    const publicClient = await viem.getPublicClient();
    const startBlock = await publicClient.getBlockNumber();

    for (let i = 0; i < 3; i++) {
      await sharing.write.AccessDocument(
        [traveler.account.address, DOC.PASSPORT],
        { account: airline.account }
      );
    }

    const logs = await publicClient.getContractEvents({
      address: sharing.address,
      abi: sharing.abi,
      eventName: "AccessGranted",
      fromBlock: startBlock,
    });

    const matchingLogs = logs.filter(
      (log) =>
        log.args.traveler?.toLowerCase() ===
          traveler.account.address.toLowerCase() &&
        log.args.requester?.toLowerCase() ===
          airline.account.address.toLowerCase() &&
        log.args.docType === DOC.PASSPORT
    );

    assert.equal(matchingLogs.length, 3);
  });


  it("grant -> revoke -> grant only rewards the traveler once", async function () {
    const { viem, identity, sharing, token, traveler, airline } =
      await deployAll();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("reward-passport"), 0n],
      { account: traveler.account }
    );

    const now = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(now + 2 * DAY)],
      { account: traveler.account }
    );

    assert.equal(
      await token.read.balanceOf([traveler.account.address]),
      parseEther("10")
    );

    await sharing.write.RevokeConsent(
      [airline.account.address, DOC.PASSPORT],
      { account: traveler.account }
    );

    const newNow = await latestTime(viem);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, BigInt(newNow + 2 * DAY)],
      { account: traveler.account }
    );

    assert.equal(
      await token.read.balanceOf([traveler.account.address]),
      parseEther("10")
    );
  });

});
