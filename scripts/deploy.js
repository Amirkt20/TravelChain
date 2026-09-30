// Deploys and wires up all TravelChain contracts.
// Usage:  npx hardhat node                                  (terminal 1)
//         npx hardhat run scripts/deploy.js --network localhost   (terminal 2)
const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TravelChain with:", deployer.address);

  // 1. Identity has no dependencies, so it goes first
  const identity = await (await hre.ethers.getContractFactory("DigitalIdentity")).deploy();
  await identity.waitForDeployment();
  console.log("DigitalIdentity:", await identity.getAddress());

  // 2. ConsentManager needs the identity address
  const consent = await (await hre.ethers.getContractFactory("ConsentManager")).deploy(await identity.getAddress());
  await consent.waitForDeployment();
  console.log("ConsentManager: ", await consent.getAddress());

  // 3. Token is independent
  const token = await (await hre.ethers.getContractFactory("RewardToken")).deploy();
  await token.waitForDeployment();
  console.log("RewardToken:    ", await token.getAddress());

  // 4. DataSharing needs all three
  const sharing = await (await hre.ethers.getContractFactory("DataSharing")).deploy(
    await identity.getAddress(),
    await consent.getAddress(),
    await token.getAddress()
  );
  await sharing.waitForDeployment();
  console.log("DataSharing:    ", await sharing.getAddress());

  // 5. Wiring (without these two steps nothing works!)
  //    a) ConsentManager only accepts calls from DataSharing
  await (await consent.SetDataSharing(await sharing.getAddress())).wait();
  //    b) DataSharing is allowed to mint reward tokens
  await (await token.grantRole(await token.MINTER_ROLE(), await sharing.getAddress())).wait();
  console.log("Wiring done: ConsentManager -> DataSharing, MINTER_ROLE -> DataSharing");

  // Save addresses so other scripts can connect to the deployed contracts
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

// Only run main() when this file is executed directly (so demo.js can import it)
if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { main };
