// Unit tests for ConsentManager.
// To test it in isolation we link it to a plain test account ("fakeSharing") instead of the
// real DataSharing contract, so we can call SetConsent/RevokeConsent directly.
const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { id, DOC, ROLE, HOUR, DAY } = require("./helpers");

async function deployConsentOnly() {
  const [admin, traveler, airline, fakeSharing, stranger] = await ethers.getSigners();
  const identity = await (await ethers.getContractFactory("DigitalIdentity")).deploy();
  const consent = await (await ethers.getContractFactory("ConsentManager")).deploy(await identity.getAddress());
  await consent.SetDataSharing(fakeSharing.address);

  await identity.connect(traveler).RegisterTraveler(id("t"), id("t@mail"));
  await identity.RegisterOrganization(airline.address, ROLE.Airline, id("a"), id("a@mail"));
  const docExpiry = (await time.latest()) + 60 * DAY;
  await identity.connect(traveler).StoreDocument(DOC.VISA, id("visa-file"), docExpiry);

  // "cm" = consent manager as seen by the (fake) DataSharing caller
  const cm = consent.connect(fakeSharing);
  return { identity, consent, cm, admin, traveler, airline, fakeSharing, stranger, docExpiry };
}

describe("ConsentManager", function () {
  describe("Access control (the big security fix)", function () {
    it("random accounts cannot call SetConsent", async function () {
      const { consent, traveler, airline, stranger } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) + DAY;
      await expect(consent.connect(stranger).SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.be.revertedWithCustomError(consent, "NotAuthorized");
    });

    it("even the traveler cannot call SetConsent directly", async function () {
      const { consent, traveler, airline } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) + DAY;
      await expect(consent.connect(traveler).SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.be.revertedWithCustomError(consent, "NotAuthorized");
    });

    it("random accounts cannot call RevokeConsent", async function () {
      const { consent, cm, traveler, airline, stranger } = await loadFixture(deployConsentOnly);
      await cm.SetConsent(traveler.address, airline.address, DOC.VISA, (await time.latest()) + DAY);
      await expect(consent.connect(stranger).RevokeConsent(traveler.address, airline.address, DOC.VISA))
        .to.be.revertedWithCustomError(consent, "NotAuthorized");
    });

    it("SetDataSharing can only be called once", async function () {
      const { consent, stranger } = await loadFixture(deployConsentOnly);
      await expect(consent.SetDataSharing(stranger.address))
        .to.be.revertedWithCustomError(consent, "AlreadyInitialized");
    });

    it("only the deployer can call SetDataSharing", async function () {
      const [admin, other] = await ethers.getSigners();
      const identity = await (await ethers.getContractFactory("DigitalIdentity")).deploy();
      const consent = await (await ethers.getContractFactory("ConsentManager")).deploy(await identity.getAddress());
      await expect(consent.connect(other).SetDataSharing(other.address))
        .to.be.revertedWithCustomError(consent, "NotAuthorized");
    });
  });

  describe("Granting", function () {
    it("stores a consent and emits ConsentGranted", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) + DAY;
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.emit(cm, "ConsentGranted");
      expect(await cm.CheckConsent(traveler.address, airline.address, DOC.VISA)).to.equal(true);
      expect((await cm.GetConsent(traveler.address, airline.address, DOC.VISA)).expiry).to.equal(expiry);
    });

    it("rejects durations under 1 hour", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) + 30 * 60;
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.be.revertedWithCustomError(cm, "InvalidConsentDuration");
    });

    it("rejects durations over 30 days", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) + 31 * DAY;
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.be.revertedWithCustomError(cm, "InvalidConsentDuration");
    });

    it("rejects expiry in the past", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      const expiry = (await time.latest()) - 1;
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.VISA, expiry))
        .to.be.revertedWithCustomError(cm, "InvalidExpiryTimestamp");
    });

    it("consent cannot outlive the document", async function () {
      const { identity, cm, traveler, airline } = await loadFixture(deployConsentOnly);
      // replace the visa with one that expires in 2 days, then ask for 5 days of consent
      const docExpiry = (await time.latest()) + 2 * DAY;
      await identity.connect(traveler).StoreDocument(DOC.VISA, id("short-visa"), docExpiry);
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.VISA, docExpiry + 3 * DAY))
        .to.be.revertedWithCustomError(cm, "ConsentOutlivesDocument");
    });

    it("requester must be an organization", async function () {
      const { cm, traveler, stranger } = await loadFixture(deployConsentOnly);
      await expect(cm.SetConsent(traveler.address, stranger.address, DOC.VISA, (await time.latest()) + DAY))
        .to.be.revertedWithCustomError(cm, "RequesterNotOrganization");
    });

    it("owner must be a traveler", async function () {
      const { cm, airline, stranger } = await loadFixture(deployConsentOnly);
      await expect(cm.SetConsent(stranger.address, airline.address, DOC.VISA, (await time.latest()) + DAY))
        .to.be.revertedWithCustomError(cm, "TravelerNotRegistered");
    });

    it("document must exist", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      await expect(cm.SetConsent(traveler.address, airline.address, DOC.PASSPORT, (await time.latest()) + DAY))
        .to.be.revertedWithCustomError(cm, "DocumentNotFound");
    });
  });

  describe("Expiry and revocation", function () {
    it("consent becomes invalid after expiry", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      await cm.SetConsent(traveler.address, airline.address, DOC.VISA, (await time.latest()) + 2 * HOUR);
      await time.increase(2 * HOUR + 1); // fast-forward the local blockchain clock
      expect(await cm.CheckConsent(traveler.address, airline.address, DOC.VISA)).to.equal(false);
    });

    it("revoke deletes the consent", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      await cm.SetConsent(traveler.address, airline.address, DOC.VISA, (await time.latest()) + DAY);
      await expect(cm.RevokeConsent(traveler.address, airline.address, DOC.VISA)).to.emit(cm, "ConsentRevoked");
      expect(await cm.CheckConsent(traveler.address, airline.address, DOC.VISA)).to.equal(false);
      await expect(cm.GetConsent(traveler.address, airline.address, DOC.VISA))
        .to.be.revertedWithCustomError(cm, "ConsentNotFound");
    });

    it("revoking a non-existent consent reverts", async function () {
      const { cm, traveler, airline } = await loadFixture(deployConsentOnly);
      await expect(cm.RevokeConsent(traveler.address, airline.address, DOC.VISA))
        .to.be.revertedWithCustomError(cm, "ConsentNotFound");
    });
  });
});
