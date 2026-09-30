// Tests for DataSharing: granting (+rewards), access, audit events, anti-farming.
const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { id, DOC, HOUR, DAY, deployWithPassport } = require("./helpers");

const REWARD = ethers.parseEther("10"); // 10 tokens with 18 decimals
const DENY = { NoValidConsent: 0, DocumentExpired: 1 }; // matches the DenyReason enum

describe("DataSharing", function () {
  describe("Granting consent", function () {
    it("grants consent and rewards 10 TRVL", async function () {
      const { sharing, token, traveler, airline } = await loadFixture(deployWithPassport);
      const expiry = (await time.latest()) + DAY;
      await expect(sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, expiry))
        .to.emit(sharing, "TokensRewarded").withArgs(traveler.address, REWARD, anyUint());
      expect(await token.balanceOf(traveler.address)).to.equal(REWARD);
      expect(await sharing.CanAccess(traveler.address, airline.address, DOC.PASSPORT)).to.equal(true);
    });

    it("ANTI-FARMING: grant -> revoke -> grant only rewards once", async function () {
      const { sharing, token, traveler, airline } = await loadFixture(deployWithPassport);
      const expiry = (await time.latest()) + DAY;
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, expiry);
      await sharing.connect(traveler).RevokeConsent(airline.address, DOC.PASSPORT);
      await expect(sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, expiry))
        .to.not.emit(sharing, "TokensRewarded");
      expect(await token.balanceOf(traveler.address)).to.equal(REWARD);
    });

    it("sharing the same doc with a different requester earns a new reward", async function () {
      const { sharing, token, traveler, airline, hotel } = await loadFixture(deployWithPassport);
      const expiry = (await time.latest()) + DAY;
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, expiry);
      await sharing.connect(traveler).GrantConsent(hotel.address, DOC.PASSPORT, expiry);
      expect(await token.balanceOf(traveler.address)).to.equal(REWARD * 2n);
    });

    it("batch grant rewards each new combo and skips already-rewarded ones", async function () {
      const { sharing, identity, token, traveler, airline, hotel } = await loadFixture(deployWithPassport);
      await identity.connect(traveler).StoreDocument(DOC.HOTEL_BOOKING, id("booking"), 0);
      const expiry = (await time.latest()) + DAY;
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, expiry); // 10
      await sharing.connect(traveler).GrantMultipleConsents(
        [airline.address, hotel.address, hotel.address],
        [DOC.PASSPORT, DOC.PASSPORT, DOC.HOTEL_BOOKING],
        [expiry, expiry, expiry]
      ); // airline/passport already rewarded -> only 2 new
      expect(await token.balanceOf(traveler.address)).to.equal(REWARD * 3n);
    });

    it("batch grant rejects arrays of different length", async function () {
      const { sharing, traveler, airline } = await loadFixture(deployWithPassport);
      await expect(sharing.connect(traveler).GrantMultipleConsents([airline.address], [], []))
        .to.be.revertedWithCustomError(sharing, "LengthMismatch");
    });

    it("tokens are kept after revoking", async function () {
      const { sharing, token, traveler, airline } = await loadFixture(deployWithPassport);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
      await sharing.connect(traveler).RevokeConsent(airline.address, DOC.PASSPORT);
      expect(await token.balanceOf(traveler.address)).to.equal(REWARD);
    });
  });

  describe("Accessing documents", function () {
    it("airline with consent gets the hash and attestation status", async function () {
      const { sharing, traveler, airline, passportHash } = await loadFixture(deployWithPassport);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);

      // staticCall = simulate the call and read the return values without sending a tx
      const [found, hash, attested] = await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.PASSPORT);
      expect(found).to.equal(true);
      expect(hash).to.equal(passportHash);
      expect(attested).to.equal(true);

      await expect(sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT))
        .to.emit(sharing, "AccessGranted")
        .withArgs(traveler.address, airline.address, DOC.PASSPORT, passportHash, true, anyUint());
    });

    it("reports attested = false for self-uploaded documents", async function () {
      const { sharing, identity, traveler, airline } = await loadFixture(deployWithPassport);
      await identity.connect(traveler).StoreDocument(DOC.FLIGHT_BOOKING, id("ticket"), 0);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.FLIGHT_BOOKING, (await time.latest()) + DAY);
      const [, , attested] = await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.FLIGHT_BOOKING);
      expect(attested).to.equal(false);
    });

    it("non-organizations cannot request documents", async function () {
      const { sharing, traveler, traveler2 } = await loadFixture(deployWithPassport);
      await expect(sharing.connect(traveler2).AccessDocument(traveler.address, DOC.PASSPORT))
        .to.be.revertedWithCustomError(sharing, "NotAnOrganization");
    });
  });

  describe("Audit trail (AccessDenied is now really logged)", function () {
    it("denied access does NOT revert and the event is stored on-chain", async function () {
      const { sharing, traveler, airline } = await loadFixture(deployWithPassport);
      const tx = await sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1); // transaction succeeded

      // Read the logs back from the chain, like an auditor would
      const logs = await sharing.queryFilter(sharing.filters.AccessDenied(traveler.address, airline.address));
      expect(logs.length).to.equal(1);
      expect(logs[0].args.reason).to.equal(DENY.NoValidConsent);
    });

    it("access after revoke is denied and logged", async function () {
      const { sharing, traveler, airline } = await loadFixture(deployWithPassport);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
      await sharing.connect(traveler).RevokeConsent(airline.address, DOC.PASSPORT);
      await expect(sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT))
        .to.emit(sharing, "AccessDenied")
        .withArgs(traveler.address, airline.address, DOC.PASSPORT, DENY.NoValidConsent, anyUint());
    });

    it("access after consent expiry is denied", async function () {
      const { sharing, traveler, airline } = await loadFixture(deployWithPassport);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + 2 * HOUR);
      await time.increase(3 * HOUR);
      const [found] = await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.PASSPORT);
      expect(found).to.equal(false);
    });

    it("access to an expired document is denied with DocumentExpired", async function () {
      const { sharing, identity, traveler, airline } = await loadFixture(deployWithPassport);
      // 1. consent for 5 days on the passport (passport is valid for a year)
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + 5 * DAY);
      // 2. traveler replaces the passport with one that expires in 2 days
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("old-passport"), (await time.latest()) + 2 * DAY);
      // 3. after 3 days: consent still valid, but the document is expired
      await time.increase(3 * DAY);
      await expect(sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT))
        .to.emit(sharing, "AccessDenied")
        .withArgs(traveler.address, airline.address, DOC.PASSPORT, DENY.DocumentExpired, anyUint());
    });

    it("every successful access is logged, not just the first", async function () {
      const { sharing, traveler, airline } = await loadFixture(deployWithPassport);
      await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
      for (let i = 0; i < 3; i++) await sharing.connect(airline).AccessDocument(traveler.address, DOC.PASSPORT);
      const logs = await sharing.queryFilter(sharing.filters.AccessGranted(traveler.address));
      expect(logs.length).to.equal(3);
    });
  });
});

// Matcher for "any number" (used for timestamps we don't want to predict exactly)
function anyUint() {
  return require("@nomicfoundation/hardhat-chai-matchers/withArgs").anyUint;
}
