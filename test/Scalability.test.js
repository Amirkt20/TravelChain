const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { id, DOC, DAY, deployAll } = require("./helpers");

const TOLERANCE = 2000n;

async function gasOf(txPromise) {
  const receipt = await (await txPromise).wait();
  return receipt.gasUsed;
}

describe("Scalability", function () {
  it("registration gas stays constant for many travelers", async function () {
    const { identity } = await loadFixture(deployAll);
    const signers = (await ethers.getSigners()).slice(8, 18);
    const gas = [];
    for (let i = 0; i < signers.length; i++) {
      gas.push(await gasOf(identity.connect(signers[i]).RegisterTraveler(id("id" + i), id("mail" + i))));
    }
    console.log("      RegisterTraveler gas (first, last):", gas[0].toString(), gas[gas.length - 1].toString());
    expect(gas[gas.length - 1] - gas[0]).to.be.lessThanOrEqual(TOLERANCE);
  });

  it("grant gas doesn't grow with number of existing consents", async function () {
    const { identity, sharing, traveler, airline, hotel, others } = await loadFixture(deployAll);

    const orgs = others.slice(0, 8);
    for (let i = 0; i < orgs.length; i++) {
      await identity.RegisterOrganization(orgs[i].address, 2, id("org" + i), id("o" + i));
    }
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), 0);
    const expiry = (await time.latest()) + 10 * DAY;

    const gas = [];
    for (const org of orgs) {
      gas.push(await gasOf(sharing.connect(traveler).GrantConsent(org.address, DOC.PASSPORT, expiry)));
    }
    console.log("      GrantConsent gas (first, last):", gas[0].toString(), gas[gas.length - 1].toString());
    expect(gas[gas.length - 1] - gas[0]).to.be.lessThanOrEqual(TOLERANCE);
  });

  it("access gas is constant no matter how many times the doc was accessed", async function () {
    const { identity, sharing, traveler, airline } = await loadFixture(deployAll);
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), 0);
    await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);

    const gas = [];
    for (let i = 0; i < 10; i++) {
      gas.push(await gasOf(sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT)));
    }
    console.log("      AccessDocument gas (first, last):", gas[0].toString(), gas[gas.length - 1].toString());
    expect(gas[gas.length - 1]).to.equal(gas[1]);
  });
});
