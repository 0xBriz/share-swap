// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(uint256 _initMintAmount) ERC20("MOCK", "MOCK") {
        _mint(msg.sender, _initMintAmount);
    }
}
