import { network } from "hardhat";
import fs from "node:fs";

export async function deploy() {
  const { viem, networkName } = await network.connect();
  const [deployer] = await viem.getWalletClients();

  console.log("Deploying TravelChain with:", deployer.account.address);

  const identity = await viem.deployContract("DigitalIdentity");
  console.log("DigitalIdentity:", identity.address);

  const consent = await viem.deployContract("ConsentManager", [
    identity.address,
  ]);
  console.log("ConsentManager: ", consent.address);

  const token = await viem.deployContract("RewardToken");
  console.log("RewardToken:    ", token.address);

  const sharing = await viem.deployContract("DataSharing", [
    identity.address,
    consent.address,
    token.address,
  ]);
  console.log("DataSharing:    ", sharing.address);

  await consent.write.SetDataSharing([sharing.address]);

  const minterRole = await token.read.MINTER_ROLE();
  await token.write.grantRole([minterRole, sharing.address]);

  console.log(
    "Wiring done: ConsentManager -> DataSharing, MINTER_ROLE -> DataSharing"
  );

  const info = {
    network: networkName ?? "hardhat",
    deployer: deployer.account.address,
    timestamp: new Date().toISOString(),
    contracts: {
      DigitalIdentity: identity.address,
      ConsentManager: consent.address,
      RewardToken: token.address,
      DataSharing: sharing.address,
    },
  };

  fs.writeFileSync(
    "deployment-addresses.json",
    JSON.stringify(info, null, 2)
  );

  console.log("Saved deployment-addresses.json");

  return { viem, identity, consent, token, sharing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
