const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { id, DOC, ROLE, DAY, deployAll } = require("./helpers");

describe("DigitalIdentity", function () {
  describe("Traveler registration", function () {
    it("registers a traveler with the Traveler role", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      expect(await identity.IsRegistered(traveler.address)).to.equal(true);
      expect(await identity.IsTraveler(traveler.address)).to.equal(true);
      expect(await identity.GetRole(traveler.address)).to.equal(ROLE.Traveler);
    });

    it("emits TravelerRegistered", async function () {
      const { identity, stranger } = await loadFixture(deployAll);
      await expect(identity.connect(stranger).RegisterTraveler(id("x"), id("y")))
        .to.emit(identity, "TravelerRegistered");
    });

    it("rejects double registration", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await expect(identity.connect(traveler).RegisterTraveler(id("a"), id("b")))
        .to.be.revertedWithCustomError(identity, "AlreadyRegistered");
    });

    it("rejects empty hashes", async function () {
      const { identity, stranger } = await loadFixture(deployAll);
      await expect(identity.connect(stranger).RegisterTraveler(ethers.ZeroHash, id("b")))
        .to.be.revertedWithCustomError(identity, "InvalidParameter");
    });

    it("unregistered address has role None", async function () {
      const { identity, stranger } = await loadFixture(deployAll);
      expect(await identity.GetRole(stranger.address)).to.equal(ROLE.None);
      await expect(identity.GetUser(stranger.address)).to.be.revertedWithCustomError(identity, "NotRegistered");
    });
  });

  describe("Organization registration", function () {
    it("admin registers an airline", async function () {
      const { identity, airline } = await loadFixture(deployAll);
      expect(await identity.GetRole(airline.address)).to.equal(ROLE.Airline);
      expect(await identity.IsOrganization(airline.address)).to.equal(true);
      expect(await identity.IsTraveler(airline.address)).to.equal(false);
    });

    it("non-admin cannot register an organization", async function () {
      const { identity, stranger } = await loadFixture(deployAll);
      await expect(
        identity.connect(stranger).RegisterOrganization(stranger.address, ROLE.Airline, id("a"), id("b"))
      ).to.be.revertedWithCustomError(identity, "OwnableUnauthorizedAccount");
    });

    it("rejects None / Traveler as organization role", async function () {
      const { identity, stranger } = await loadFixture(deployAll);
      await expect(identity.RegisterOrganization(stranger.address, ROLE.Traveler, id("a"), id("b")))
        .to.be.revertedWithCustomError(identity, "InvalidRole");
      await expect(identity.RegisterOrganization(stranger.address, ROLE.None, id("a"), id("b")))
        .to.be.revertedWithCustomError(identity, "InvalidRole");
    });

    it("cannot register an address that is already a traveler", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await expect(identity.RegisterOrganization(traveler.address, ROLE.Hotel, id("a"), id("b")))
        .to.be.revertedWithCustomError(identity, "AlreadyRegistered");
    });
  });

  describe("Documents", function () {
    it("traveler stores a passport hash", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      const validUntil = (await time.latest()) + 365 * DAY;
      await expect(identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), validUntil))
        .to.emit(identity, "DocumentStored");

      const doc = await identity.GetDocument(traveler.address, DOC.PASSPORT);
      expect(doc.docHash).to.equal(id("file"));
      expect(doc.validUntil).to.equal(validUntil);
      expect(doc.attestedBy).to.equal(ethers.ZeroAddress);
    });

    it("allows documents without expiry (validUntil = 0)", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await identity.connect(traveler).StoreDocument(DOC.FLIGHT_BOOKING, id("booking"), 0);
      expect(await identity.DocumentExists(traveler.address, DOC.FLIGHT_BOOKING)).to.equal(true);
    });

    it("organizations cannot store documents", async function () {
      const { identity, airline } = await loadFixture(deployAll);
      await expect(identity.connect(airline).StoreDocument(DOC.PASSPORT, id("f"), 0))
        .to.be.revertedWithCustomError(identity, "NotATraveler");
    });

    it("rejects unsupported document types", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await expect(identity.connect(traveler).StoreDocument(id("DIPLOMA"), id("f"), 0))
        .to.be.revertedWithCustomError(identity, "UnsupportedDocType");
    });

    it("admin can add a new document type", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await identity.AddDocType(id("ESTA"));
      await identity.connect(traveler).StoreDocument(id("ESTA"), id("f"), 0);
      expect(await identity.DocumentExists(traveler.address, id("ESTA"))).to.equal(true);
    });

    it("rejects an already-expired document", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      const past = (await time.latest()) - 1;
      await expect(identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("f"), past))
        .to.be.revertedWithCustomError(identity, "DocumentAlreadyExpired");
    });

    it("GetDocument reverts for missing document", async function () {
      const { identity, traveler } = await loadFixture(deployAll);
      await expect(identity.GetDocument(traveler.address, DOC.VISA))
        .to.be.revertedWithCustomError(identity, "DocumentNotFound");
    });
  });

  describe("Issuer attestation", function () {
    it("issuer attests a matching document", async function () {
      const { identity, traveler, issuer } = await loadFixture(deployAll);
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), 0);
      await expect(identity.connect(issuer).AttestDocument(traveler.address, DOC.PASSPORT, id("file")))
        .to.emit(identity, "DocumentAttested");
      expect((await identity.GetDocument(traveler.address, DOC.PASSPORT)).attestedBy).to.equal(issuer.address);
    });

    it("non-issuer cannot attest", async function () {
      const { identity, traveler, stranger } = await loadFixture(deployAll);
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), 0);
      await expect(identity.connect(stranger).AttestDocument(traveler.address, DOC.PASSPORT, id("file")))
        .to.be.revertedWithCustomError(identity, "NotAnIssuer");
    });

    it("attestation fails if the hash does not match", async function () {
      const { identity, traveler, issuer } = await loadFixture(deployAll);
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), 0);
      await expect(identity.connect(issuer).AttestDocument(traveler.address, DOC.PASSPORT, id("other")))
        .to.be.revertedWithCustomError(identity, "HashMismatch");
    });

    it("replacing a document removes its attestation", async function () {
      const { identity, traveler, issuer } = await loadFixture(deployAll);
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), 0);
      await identity.connect(issuer).AttestDocument(traveler.address, DOC.PASSPORT, id("file"));
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("forged"), 0);
      expect((await identity.GetDocument(traveler.address, DOC.PASSPORT)).attestedBy).to.equal(ethers.ZeroAddress);
    });

    it("admin can remove an issuer", async function () {
      const { identity, traveler, issuer } = await loadFixture(deployAll);
      await identity.SetIssuer(issuer.address, false);
      await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("file"), 0);
      await expect(identity.connect(issuer).AttestDocument(traveler.address, DOC.PASSPORT, id("file")))
        .to.be.revertedWithCustomError(identity, "NotAnIssuer");
    });
  });
});
