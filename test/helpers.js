import { network } from "hardhat";
import { keccak256, toBytes } from "viem";

const id = (text) => keccak256(toBytes(text));

const DOC = {
  PASSPORT: id("PASSPORT"),
  VISA: id("VISA"),
  FLIGHT_BOOKING: id("FLIGHT_BOOKING"),
  HOTEL_BOOKING: id("HOTEL_BOOKING"),
  VACCINATION_CERT: id("VACCINATION_CERT"),
  TRAVEL_INSURANCE: id("TRAVEL_INSURANCE"),
};

const ROLE = {
  None: 0,
  Traveler: 1,
  Airline: 2,
  Hotel: 3,
  TravelAgency: 4,
  BorderControl: 5,
};

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

async function deployAll() {
  const { viem } = await network.connect();

  const [
    admin,
    traveler,
    traveler2,
    airline,
    hotel,
    issuer,
    stranger,
    ...others
  ] = await viem.getWalletClients();

  const identity = await viem.deployContract("DigitalIdentity");

  const consent = await viem.deployContract("ConsentManager", [
    identity.address,
  ]);

  const token = await viem.deployContract("RewardToken");

  const sharing = await viem.deployContract("DataSharing", [
    identity.address,
    consent.address,
    token.address,
  ]);

  await consent.write.SetDataSharing([sharing.address]);

  const minterRole = await token.read.MINTER_ROLE();
  await token.write.grantRole([minterRole, sharing.address]);

  await identity.write.RegisterTraveler(
    [id("NL-ID-123"), id("alice@mail.com")],
    { account: traveler.account }
  );

  await identity.write.RegisterTraveler(
    [id("BR-ID-456"), id("bob@mail.com")],
    { account: traveler2.account }
  );

  await identity.write.RegisterOrganization([
    airline.account.address,
    ROLE.Airline,
    id("KVK-KLM"),
    id("ops@klm.test"),
  ]);

  await identity.write.RegisterOrganization([
    hotel.account.address,
    ROLE.Hotel,
    id("KVK-HOTEL"),
    id("desk@hotel.test"),
  ]);

  await identity.write.SetIssuer([issuer.account.address, true]);

  return {
    viem,
    identity,
    consent,
    token,
    sharing,
    admin,
    traveler,
    traveler2,
    airline,
    hotel,
    issuer,
    stranger,
    others,
  };
}

async function deployWithPassport() {
  const ctx = await deployAll();

  const publicClient = await ctx.viem.getPublicClient();
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);

  const passportHash = id("alice-passport-file-contents");

  await ctx.identity.write.StoreDocument(
    [DOC.PASSPORT, passportHash, BigInt(now + 365 * DAY)],
    { account: ctx.traveler.account }
  );

  await ctx.identity.write.AttestDocument(
    [
      ctx.traveler.account.address,
      DOC.PASSPORT,
      passportHash,
    ],
    { account: ctx.issuer.account }
  );

  return { ...ctx, passportHash };
}

export {
  id,
  DOC,
  ROLE,
  HOUR,
  DAY,
  deployAll,
  deployWithPassport,
};
