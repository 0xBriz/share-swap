import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ShareSwap, TestERC20 } from "../typechain";

describe("ShareSwap", () => {
  let shareSwap: ShareSwap;
  let ASHARE: TestERC20;
  let AALTO: TestERC20;

  let owner: SignerWithAddress;
  let testUser: SignerWithAddress;
  let testUserTwo: SignerWithAddress;

  let treasuryAddress = "";

  const testTokenOwnerAmount = ethers.utils.parseEther("100000000000");
  const AALTO_FOR_SWAP_AMOUNT = ethers.utils.parseEther("1000000");

  const format = (val) => ethers.utils.formatEther(val);

  async function moveUpBlockTime() {
    const increasedBlockNumberHex = "0x186A0"; // 100000 blocks
    const increasedBlockTimeIntervalHex = "0x3c"; // one minute
    await ethers.provider.send("hardhat_mine", [
      increasedBlockNumberHex,
      increasedBlockTimeIntervalHex, // interval between the timestamps of each block, in seconds
    ]);
  }

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    owner = accounts[0];
    testUser = accounts[1];
    testUserTwo = accounts[2];
    treasuryAddress = accounts[3].address;

    const Share = await ethers.getContractFactory("TestERC20");
    const shareToken = await Share.deploy(testTokenOwnerAmount);
    ASHARE = await shareToken.deployed();

    const Aalto = await ethers.getContractFactory("TestERC20");
    const AaltoToken = await Aalto.deploy(testTokenOwnerAmount);
    AALTO = await AaltoToken.deployed();

    const ShareSwap = await ethers.getContractFactory("ShareSwap");
    const swap = await ShareSwap.deploy(
      ASHARE.address,
      AALTO.address,
      treasuryAddress
    );
    shareSwap = await swap.deployed();
  });

  const testUserShareAmount = 10;

  async function exchangeFunds() {
    // Fund contract with aalto
    await AALTO.transfer(shareSwap.address, AALTO_FOR_SWAP_AMOUNT);

    // Fund test user with share token
    await ASHARE.transfer(testUser.address, testUserShareAmount);
    await ASHARE.transfer(testUserTwo.address, testUserShareAmount);
  }

  it("Should revert when swap not enabled", async () => {
    await shareSwap.setSwapEnabled(false);
    await expect(
      shareSwap.connect(testUser).swap(testUserShareAmount)
    ).to.be.revertedWith("Swap not enabled");
  });

  it("Should revert on a zero amount", async () => {
    await expect(shareSwap.swap(0)).to.be.revertedWith("Zero share amount");
  });

  it("Should revert if user does not have correct share balance", async () => {
    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    // Not funding user first
    await expect(
      shareSwap.connect(testUser).swap(testUserShareAmount)
    ).to.be.revertedWith("User Share balance too low");
  });

  it("Should revert if amount is over max per epoch", async () => {
    await exchangeFunds();

    const maxAmount = await shareSwap.maxAaltoPerEpoch();

    // Fund test user with share token to cause overflow
    await ASHARE.transfer(testUser.address, maxAmount);

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await expect(
      shareSwap.connect(testUser).swap(maxAmount)
    ).to.be.revertedWith("Over max per epoch");
  });

  it("Should revert if amount is over max per epoch", async () => {
    await exchangeFunds();

    const maxAmount = await shareSwap.maxAaltoPerEpoch();

    console.log(maxAmount);

    // Fund test user with share token to cause overflow
    const userOneAmount = maxAmount.toNumber() / 2;
    const userTwoAmount = maxAmount.toNumber() / 2;
    await ASHARE.transfer(testUser.address, userOneAmount);
    await ASHARE.transfer(testUserTwo.address, userTwoAmount);

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );
    await ASHARE.connect(testUserTwo).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await expect(shareSwap.connect(testUser).swap(userOneAmount)).to.not.be
      .reverted;

    await expect(
      shareSwap.connect(testUserTwo).swap(userTwoAmount)
    ).to.be.revertedWith("Over max per epoch");
  });

  it("Should reset the shares swap cap for a new epoch", async () => {
    await exchangeFunds();

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await shareSwap.connect(testUser).swap(testUserShareAmount);

    let currentEpochAmount = await shareSwap.currentAaltoForEpoch();
    expect(currentEpochAmount).to.equal(testUserShareAmount);

    await moveUpBlockTime();

    currentEpochAmount = await shareSwap.currentAaltoForEpoch();

    const boostedAmount = 100;
    await ASHARE.transfer(testUser.address, boostedAmount);
    await shareSwap.connect(testUser).swap(boostedAmount);

    await moveUpBlockTime();

    currentEpochAmount = await shareSwap.currentAaltoForEpoch();

    // Should have reset after the time fast forward
    expect(currentEpochAmount).to.equal(boostedAmount);
  });

  it("Should revert if contract aalto balance can not meet share amount * aaltoPerShare", async () => {
    // Fund test user with share token
    await ASHARE.transfer(testUser.address, testUserShareAmount);

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    // Not funding contract first
    await expect(
      shareSwap.connect(testUser).swap(testUserShareAmount)
    ).to.be.revertedWith("Contract Aalto balance too low");
  });

  it("Should burn half of the share tokens", async () => {
    await exchangeFunds();

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await shareSwap.connect(testUser).swap(testUserShareAmount);
    const burnAmount = await ASHARE.balanceOf(
      "0x000000000000000000000000000000000000dEaD"
    );
    expect(burnAmount).to.equal(testUserShareAmount / 2);
  });

  it("Should send half of share amount to treasury", async () => {
    await exchangeFunds();

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await shareSwap.connect(testUser).swap(testUserShareAmount);
    const treasuryAmount = await ASHARE.balanceOf(treasuryAddress);
    expect(treasuryAmount).to.equal(testUserShareAmount / 2);
  });

  it("Should give the user the proper aalto amount", async () => {
    await exchangeFunds();

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await shareSwap.connect(testUser).swap(testUserShareAmount);

    const aaltoPerShare = await shareSwap.aaltoPerShare();

    const userAaltoAmount = await AALTO.balanceOf(testUser.address);
    expect(userAaltoAmount).to.equal(aaltoPerShare.mul(testUserShareAmount));
  });

  it("Should emit the ShareSwapped event", async () => {
    await exchangeFunds();

    // approve ShareSwap
    await ASHARE.connect(testUser).approve(
      shareSwap.address,
      ethers.constants.MaxUint256
    );

    await expect(shareSwap.connect(testUser).swap(testUserShareAmount)).to.emit(
      shareSwap,
      "ShareSwapped"
    );
  });
});
