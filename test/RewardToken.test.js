// Unit tests for the TRVL reward token.
const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

async function deployToken() {
  const [admin, minter, user, other] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("RewardToken")).deploy();
  await token.grantRole(await token.MINTER_ROLE(), minter.address);
  return { token, admin, minter, user, other };
}

describe("RewardToken", function () {
  it("has the right name, symbol and decimals", async function () {
    const { token } = await loadFixture(deployToken);
    expect(await token.name()).to.equal("TravelShareToken");
    expect(await token.symbol()).to.equal("TRVL");
    expect(await token.decimals()).to.equal(18);
  });

  it("starts with zero supply", async function () {
    const { token } = await loadFixture(deployToken);
    expect(await token.totalSupply()).to.equal(0);
  });

  it("minter can mint", async function () {
    const { token, minter, user } = await loadFixture(deployToken);
    await token.connect(minter).mint(user.address, ethers.parseEther("10"));
    expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("10"));
  });

  it("non-minter cannot mint", async function () {
    const { token, user } = await loadFixture(deployToken);
    await expect(token.connect(user).mint(user.address, 1))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("admin without MINTER_ROLE cannot mint either", async function () {
    const { token, admin } = await loadFixture(deployToken);
    await expect(token.connect(admin).mint(admin.address, 1))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("cannot mint beyond MAX_SUPPLY", async function () {
    const { token, minter, user } = await loadFixture(deployToken);
    const max = await token.MAX_SUPPLY();
    await token.connect(minter).mint(user.address, max);
    await expect(token.connect(minter).mint(user.address, 1))
      .to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
  });

  it("admin can revoke the minter role", async function () {
    const { token, minter, user } = await loadFixture(deployToken);
    await token.revokeRole(await token.MINTER_ROLE(), minter.address);
    await expect(token.connect(minter).mint(user.address, 1))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("tokens are transferable like any ERC20", async function () {
    const { token, minter, user, other } = await loadFixture(deployToken);
    await token.connect(minter).mint(user.address, 100);
    await token.connect(user).transfer(other.address, 40);
    expect(await token.balanceOf(other.address)).to.equal(40);
    expect(await token.balanceOf(user.address)).to.equal(60);
  });
});
