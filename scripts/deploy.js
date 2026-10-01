const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TravelChain with:", deployer.address);

  const identity = await (await hre.ethers.getContractFactory("DigitalIdentity")).deploy();
  await identity.waitForDeployment();
  console.log("DigitalIdentity:", await identity.getAddress());

  const consent = await (await hre.ethers.getContractFactory("ConsentManager")).deploy(await identity.getAddress());
  await consent.waitForDeployment();
  console.log("ConsentManager: ", await consent.getAddress());

  const token = await (await hre.ethers.getContractFactory("RewardToken")).deploy();
  await token.waitForDeployment();
  console.log("RewardToken:    ", await token.getAddress());

  const sharing = await (await hre.ethers.getContractFactory("DataSharing")).deploy(
    await identity.getAddress(),
    await consent.getAddress(),
    await token.getAddress()
  );
  await sharing.waitForDeployment();
  console.log("DataSharing:    ", await sharing.getAddress());

  await (await consent.SetDataSharing(await sharing.getAddress())).wait();

  await (await token.grantRole(await token.MINTER_ROLE(), await sharing.getAddress())).wait();
  console.log("Wiring done: ConsentManager -> DataSharing, MINTER_ROLE -> DataSharing");

  const info = {
    network: hre.network.name,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      DigitalIdentity: await identity.getAddress(),
      ConsentManager: await consent.getAddress(),
      RewardToken: await token.getAddress(),
      DataSharing: await sharing.getAddress(),
    },
  };
  fs.writeFileSync("deployment-addresses.json", JSON.stringify(info, null, 2));
  console.log("Saved deployment-addresses.json");

  return { identity, consent, token, sharing };
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { main };
