const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const id = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

const DOC = {
  PASSPORT: id("PASSPORT"),
  VISA: id("VISA"),
  FLIGHT_BOOKING: id("FLIGHT_BOOKING"),
  HOTEL_BOOKING: id("HOTEL_BOOKING"),
  VACCINATION_CERT: id("VACCINATION_CERT"),
  TRAVEL_INSURANCE: id("TRAVEL_INSURANCE"),
};

const ROLE = { None: 0, Traveler: 1, Airline: 2, Hotel: 3, TravelAgency: 4, BorderControl: 5 };

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

async function deployAll() {

  const [admin, traveler, traveler2, airline, hotel, issuer, stranger, ...others] = await ethers.getSigners();

  const identity = await (await ethers.getContractFactory("DigitalIdentity")).deploy();
  const consent = await (await ethers.getContractFactory("ConsentManager")).deploy(await identity.getAddress());
  const token = await (await ethers.getContractFactory("RewardToken")).deploy();
  const sharing = await (await ethers.getContractFactory("DataSharing")).deploy(
    await identity.getAddress(),
    await consent.getAddress(),
    await token.getAddress()
  );

  await consent.SetDataSharing(await sharing.getAddress());
  await token.grantRole(await token.MINTER_ROLE(), await sharing.getAddress());

  await identity.connect(traveler).RegisterTraveler(id("NL-ID-123"), id("alice@mail.com"));
  await identity.connect(traveler2).RegisterTraveler(id("BR-ID-456"), id("bob@mail.com"));
  await identity.RegisterOrganization(airline.address, ROLE.Airline, id("KVK-KLM"), id("ops@klm.test"));
  await identity.RegisterOrganization(hotel.address, ROLE.Hotel, id("KVK-HOTEL"), id("desk@hotel.test"));
  await identity.SetIssuer(issuer.address, true);

  return { identity, consent, token, sharing, admin, traveler, traveler2, airline, hotel, issuer, stranger, others };
}

async function deployWithPassport() {
  const ctx = await deployAll();
  const now = await time.latest();
  const passportHash = id("alice-passport-file-contents");
  await ctx.identity.connect(ctx.traveler).StoreDocument(DOC.PASSPORT, passportHash, now + 365 * DAY);
  await ctx.identity.connect(ctx.issuer).AttestDocument(ctx.traveler.address, DOC.PASSPORT, passportHash);
  return { ...ctx, passportHash };
}

module.exports = { id, DOC, ROLE, HOUR, DAY, deployAll, deployWithPassport };
