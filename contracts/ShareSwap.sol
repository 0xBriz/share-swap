// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "hardhat/console.sol";

contract ShareSwap is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public shareToken;

    IERC20 public aaltoToken;

    address public treasuryAddress;

    address private constant ZERO_ADDRESS = address(0);

    address private constant BURN_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    uint256 public aaltoPerShare = 2;

    // Prevent fat finger
    uint256 private constant MAX_AALTO_PER_SHARE = 5;

    // Ability to toggle swap on/off if needed
    bool public swapEnabled = true;

    uint256 public swapEpochLength = 1 weeks; // TODO: 1 WEEK

    uint256 public maxAaltoPerEpoch = 1000;

    uint256 public currentAaltoForEpoch;

    uint256 public lastTimeSwap;

    mapping(address => bool) public managers;

    modifier onlyManager() {
        require(managers[msg.sender], "Not a manager");
        _;
    }

    constructor(
        address _shareToken,
        address _aaltoToken,
        address _treasuryAddress
    ) {
        require(_shareToken != ZERO_ADDRESS, "0x0 _shareToken");
        require(_aaltoToken != ZERO_ADDRESS, "0x0 _aaltoToken");
        require(_treasuryAddress != ZERO_ADDRESS, "0x0 _treasuryAddress");

        shareToken = IERC20(_shareToken);
        aaltoToken = IERC20(_aaltoToken);
        treasuryAddress = _treasuryAddress;

        lastTimeSwap = block.timestamp;

        managers[msg.sender] = true;
    }

    event ShareSwapped(
        address indexed user,
        uint256 indexed shareAmount,
        uint256 indexed aaltoReceived
    );

    function swap(uint256 _shareAmount) external {
        address caller = _msgSender();

        require(swapEnabled, "Swap not enabled");
        require(_shareAmount > 0, "Zero share amount");
        // Would fail anyway, but an extra check
        require(
            shareToken.balanceOf(caller) >= _shareAmount,
            "User Share balance too low"
        );
        require(
            shareToken.allowance(caller, address(this)) >= _shareAmount,
            "Share Token allowance too low"
        );

        // Make sure we have enough to satisfy the exchange
        uint256 userAaltoAmount = _shareAmount * aaltoPerShare;
        require(
            aaltoToken.balanceOf(address(this)) >= userAaltoAmount,
            "Contract Aalto balance too low"
        );

        console.log(
            "lastTimeSwap + swapEpochLength",
            lastTimeSwap + swapEpochLength
        );
        console.log(
            "lastTimeSwap - swapEpochLength",
            lastTimeSwap - swapEpochLength
        );
        console.log("block.timestamp", block.timestamp);

        if (lastTimeSwap - swapEpochLength >= block.timestamp) {
            currentAaltoForEpoch = 0;
        }

        currentAaltoForEpoch += _shareAmount;

        require(currentAaltoForEpoch < maxAaltoPerEpoch, "Over max per epoch");

        // Effects before transfering to caller

        // Bring amount in to contract to do proper accounting
        shareToken.safeTransferFrom(caller, address(this), _shareAmount);

        // Contract share balance should only be more than zero during this transaction
        // Regardless, half is getting burned and half to treasury
        uint256 contractShareBalance = shareToken.balanceOf(address(this));

        // Burn half
        shareToken.safeTransfer(BURN_ADDRESS, contractShareBalance / 2);

        // Send whatever is left over to treasury
        shareToken.safeTransfer(
            treasuryAddress,
            shareToken.balanceOf(address(this))
        );

        lastTimeSwap = block.timestamp;

        emit ShareSwapped(caller, _shareAmount, userAaltoAmount);

        // Give caller their aaltoPerShare for _amount
        aaltoToken.safeTransfer(caller, userAaltoAmount);
    }

    /* ========================= ADMIN FUNCTIONS ======================== */

    function setSwapEnabled(bool _enabled) external onlyManager {
        require(swapEnabled != _enabled, "swapEnabled not changed");

        swapEnabled = _enabled;
    }

    function updateAaltoPerShare(uint256 _amount) external onlyManager {
        require(_amount <= MAX_AALTO_PER_SHARE, "Over MAX_AALTO_PER_SHARE");

        aaltoPerShare = _amount;
    }

    function updateTreasury(address _treasuryAddress) external onlyManager {
        require(_treasuryAddress != address(0), "0x0 _treasuryAddress");

        treasuryAddress = _treasuryAddress;
    }

    function emergencyWithdraw(address _tokenAddress, uint256 _amount)
        external
        onlyManager
    {
        require(_tokenAddress != ZERO_ADDRESS, "0x0 _tokenAddress");
        // Would fail anyway, but still
        require(
            IERC20(_tokenAddress).balanceOf(address(this)) >= _amount,
            "Contract balance too low"
        );

        IERC20(_tokenAddress).safeTransfer(owner(), _amount);
    }

    function toggleManager(address _who, bool _enabled) external onlyManager {
        managers[_who] = _enabled;
    }

    function setEpochContraints(
        uint256 _timeInSeconds,
        uint256 _maxAaltoPerEpoch
    ) external onlyManager {
        swapEpochLength = _timeInSeconds;
        maxAaltoPerEpoch = _maxAaltoPerEpoch;
        currentAaltoForEpoch = 0;
        lastTimeSwap = block.timestamp;
    }
}
