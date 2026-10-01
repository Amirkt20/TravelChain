import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default {
  plugins: [hardhatToolboxViem],

  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  paths: {
    sources: "./contracts",
    tests: {
      solidity: "./contracts",
      nodejs: "./test",
    },
  },
};
