// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./RewardToken.sol";

contract RewardTokenTest is Test {
    RewardToken private token;

    address private minter = address(0x1);
    address private traveler = address(0x2);
    address private outsider = address(0x3);

    function setUp() public {
        token = new RewardToken();
        token.grantRole(token.MINTER_ROLE(), minter);
    }

    function test_HasCorrectNameAndSymbol() public view {
        assertEq(token.name(), "TravelShareToken");
        assertEq(token.symbol(), "TRVL");
        assertEq(token.decimals(), 18);
    }

    function test_StartsWithZeroSupply() public view {
        assertEq(token.totalSupply(), 0);
    }

    function test_MinterCanMint() public {
        vm.prank(minter);
        token.mint(traveler, 10 ether);

        assertEq(token.balanceOf(traveler), 10 ether);
        assertEq(token.totalSupply(), 10 ether);
    }

    function test_NonMinterCannotMint() public {
        vm.prank(outsider);
        vm.expectRevert();
        token.mint(traveler, 10 ether);
    }

    function test_CannotMintBeyondMaxSupply() public {
        vm.startPrank(minter);

        token.mint(traveler, token.MAX_SUPPLY());

        vm.expectRevert(RewardToken.MaxSupplyExceeded.selector);
        token.mint(traveler, 1);

        vm.stopPrank();
    }

    function test_AdminCanRevokeMinterRole() public {
        token.revokeRole(token.MINTER_ROLE(), minter);

        vm.prank(minter);
        vm.expectRevert();
        token.mint(traveler, 10 ether);
    }

    function test_TokensAreTransferable() public {
        vm.prank(minter);
        token.mint(traveler, 10 ether);

        vm.prank(traveler);
        token.transfer(outsider, 4 ether);

        assertEq(token.balanceOf(traveler), 6 ether);
        assertEq(token.balanceOf(outsider), 4 ether);
    }
}
