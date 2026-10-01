const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { id, DOC, HOUR, DAY, deployAll } = require("./helpers");

describe("Integration: full travel journeys", function () {
  it("Traveler -> Passport -> Airline: grant, access, verify, revoke, denied", async function () {
    const { identity, sharing, token, traveler, airline, issuer } = await loadFixture(deployAll);

    const passportFile = "PASSPORT|NL|ALICE|1990-01-01|NX1234567";
    const passportHash = ethers.keccak256(ethers.toUtf8Bytes(passportFile));
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, passportHash, (await time.latest()) + 365 * DAY);

    await identity.connect(issuer).AttestDocument(traveler.address, DOC.PASSPORT, passportHash);

    await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + 24 * HOUR);
    expect(await token.balanceOf(traveler.address)).to.equal(ethers.parseEther("10"));

    const [found, onChainHash, attested] =
      await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.PASSPORT);
    expect(found && attested).to.equal(true);
    expect(ethers.keccak256(ethers.toUtf8Bytes(passportFile))).to.equal(onChainHash);

    const tampered = passportFile.replace("ALICE", "MALLORY");
    expect(ethers.keccak256(ethers.toUtf8Bytes(tampered))).to.not.equal(onChainHash);

    await sharing.connect(traveler).RevokeConsent(airline.address, DOC.PASSPORT);
    const [foundAfter] = await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.PASSPORT);
    expect(foundAfter).to.equal(false);
  });

  it("consent is per requester: hotel can't use the airline's consent", async function () {
    const { identity, sharing, traveler, airline, hotel } = await loadFixture(deployAll);
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), 0);
    await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
    const [found] = await sharing.connect(hotel).AccessDocument.staticCall(traveler.address, DOC.PASSPORT);
    expect(found).to.equal(false);
  });

  it("consent is per document: passport consent doesn't expose the visa", async function () {
    const { identity, sharing, traveler, airline } = await loadFixture(deployAll);
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), 0);
    await identity.connect(traveler).StoreDocument(DOC.VISA, id("v"), 0);
    await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
    const [found] = await sharing.connect(airline).AccessDocument.staticCall(traveler.address, DOC.VISA);
    expect(found).to.equal(false);
  });

  it("consent is per traveler: Alice's consent doesn't expose Bob", async function () {
    const { identity, sharing, traveler, traveler2, airline } = await loadFixture(deployAll);
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("alice"), 0);
    await identity.connect(traveler2).StoreDocument(DOC.PASSPORT, id("bob"), 0);
    await sharing.connect(traveler).GrantConsent(airline.address, DOC.PASSPORT, (await time.latest()) + DAY);
    const [found] = await sharing.connect(airline).AccessDocument.staticCall(traveler2.address, DOC.PASSPORT);
    expect(found).to.equal(false);
  });

  it("an attacker cannot grant themselves access to someone else's passport", async function () {

    const { identity, consent, sharing, traveler, airline } = await loadFixture(deployAll);
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), 0);
    const expiry = (await time.latest()) + DAY;
    await expect(consent.connect(airline).SetConsent(traveler.address, airline.address, DOC.PASSPORT, expiry))
      .to.be.revertedWithCustomError(consent, "NotAuthorized");

    await expect(sharing.connect(airline).GrantConsent(airline.address, DOC.PASSPORT, expiry))
      .to.be.revertedWithCustomError(consent, "TravelerNotRegistered");
  });

  it("full trip: passport + visa to airline, booking to hotel, in one batch", async function () {
    const { identity, sharing, token, traveler, airline, hotel } = await loadFixture(deployAll);
    const yearFromNow = (await time.latest()) + 365 * DAY;
    await identity.connect(traveler).StoreDocument(DOC.PASSPORT, id("p"), yearFromNow);
    await identity.connect(traveler).StoreDocument(DOC.VISA, id("v"), yearFromNow);
    await identity.connect(traveler).StoreDocument(DOC.HOTEL_BOOKING, id("h"), 0);

    const expiry = (await time.latest()) + 7 * DAY;
    await sharing.connect(traveler).GrantMultipleConsents(
      [airline.address, airline.address, hotel.address],
      [DOC.PASSPORT, DOC.VISA, DOC.HOTEL_BOOKING],
      [expiry, expiry, expiry]
    );

    expect(await token.balanceOf(traveler.address)).to.equal(ethers.parseEther("30"));
    expect(await sharing.CanAccess(traveler.address, airline.address, DOC.VISA)).to.equal(true);
    expect(await sharing.CanAccess(traveler.address, hotel.address, DOC.HOTEL_BOOKING)).to.equal(true);
    expect(await sharing.CanAccess(traveler.address, hotel.address, DOC.PASSPORT)).to.equal(false);
  });
});
