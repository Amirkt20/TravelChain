import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { id, DOC, DAY, deployAll } from "./helpers.js";

const TOLERANCE = 2000n;

async function gasOf(publicClient, txHash) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  return receipt.gasUsed;
}

describe("Scalability", function () {
  it("registration gas stays constant for many travelers", async function () {
    const { viem, identity, others } = await deployAll();
    const publicClient = await viem.getPublicClient();

    const signers = others.slice(0, 10);
    const gas = [];

    for (let i = 0; i < signers.length; i++) {
      const txHash = await identity.write.RegisterTraveler(
        [id("id" + i), id("mail" + i)],
        { account: signers[i].account }
      );

      gas.push(await gasOf(publicClient, txHash));
    }

    console.log(
      "      RegisterTraveler gas (first, last):",
      gas[0].toString(),
      gas[gas.length - 1].toString()
    );

    assert.ok(gas[gas.length - 1] - gas[0] <= TOLERANCE);
  });

  it("grant gas doesn't grow with number of existing consents", async function () {
    const { viem, identity, sharing, traveler, others } =
      await deployAll();

    const publicClient = await viem.getPublicClient();
    const orgs = others.slice(0, 8);

    for (let i = 0; i < orgs.length; i++) {
      await identity.write.RegisterOrganization([
        orgs[i].account.address,
        2,
        id("org" + i),
        id("o" + i),
      ]);
    }

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), 0n],
      { account: traveler.account }
    );

    const block = await publicClient.getBlock();
    const expiry = BigInt(Number(block.timestamp) + 10 * DAY);

    const gas = [];

    for (const org of orgs) {
      const txHash = await sharing.write.GrantConsent(
        [org.account.address, DOC.PASSPORT, expiry],
        { account: traveler.account }
      );

      gas.push(await gasOf(publicClient, txHash));
    }

    console.log(
      "      GrantConsent gas (first, last):",
      gas[0].toString(),
      gas[gas.length - 1].toString()
    );

    assert.ok(gas[gas.length - 1] - gas[0] <= TOLERANCE);
  });

  it("access gas is constant no matter how many times the doc was accessed", async function () {
    const { viem, identity, sharing, traveler, airline } =
      await deployAll();

    const publicClient = await viem.getPublicClient();

    await identity.write.StoreDocument(
      [DOC.PASSPORT, id("p"), 0n],
      { account: traveler.account }
    );

    const block = await publicClient.getBlock();
    const expiry = BigInt(Number(block.timestamp) + 2 * DAY);

    await sharing.write.GrantConsent(
      [airline.account.address, DOC.PASSPORT, expiry],
      { account: traveler.account }
    );

    const gas = [];

    for (let i = 0; i < 10; i++) {
      const txHash = await sharing.write.AccessDocument(
        [traveler.account.address, DOC.PASSPORT],
        { account: airline.account }
      );

      gas.push(await gasOf(publicClient, txHash));
    }

    console.log(
      "      AccessDocument gas (first, last):",
      gas[0].toString(),
      gas[gas.length - 1].toString()
    );

    assert.equal(gas[gas.length - 1], gas[1]);
  });
});
