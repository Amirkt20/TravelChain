// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./DigitalIdentity.sol";
import "./ConsentManager.sol";
import "./RewardToken.sol";
import "./DataSharing.sol";

contract DataSharingTest is Test {
    DigitalIdentity private identity;
    ConsentManager private consentManager;
    RewardToken private rewardToken;
    DataSharing private dataSharing;

    address private traveler = address(0x1);
    address private requester = address(0x2);
    address private outsider = address(0x3);

    bytes32 private passport;
    bytes32 private passportHash = keccak256("passport-data");

    function setUp() public {
        identity = new DigitalIdentity();
        consentManager = new ConsentManager(address(identity));
        rewardToken = new RewardToken();

        dataSharing = new DataSharing(
            address(identity),
            address(consentManager),
            address(rewardToken)
        );

        consentManager.SetDataSharing(address(dataSharing));

        rewardToken.grantRole(
            rewardToken.MINTER_ROLE(),
            address(dataSharing)
        );

        passport = identity.PASSPORT();

        vm.prank(traveler);
        identity.RegisterTraveler(
            keccak256("traveler-id"),
            keccak256("traveler-contact")
        );

        identity.RegisterOrganization(
            requester,
            IDigitalIdentity.Role.Airline,
            keccak256("airline-id"),
            keccak256("airline-contact")
        );

        vm.prank(traveler);
        identity.StoreDocument(
            passport,
            passportHash,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_TravelerCanGrantConsent() public {
        uint256 expiry = block.timestamp + 7 days;

        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            expiry
        );

        assertTrue(
            dataSharing.CanAccess(
                traveler,
                requester,
                passport
            )
        );

        assertEq(
            dataSharing.GetConsentExpiry(
                traveler,
                requester,
                passport
            ),
            expiry
        );
    }

    function test_TravelerReceivesRewardForConsent() public {
        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            block.timestamp + 7 days
        );

        assertEq(
            rewardToken.balanceOf(traveler),
            dataSharing.REWARD_PER_CONSENT()
        );
    }

    function test_SameConsentIsNotRewardedTwice() public {
        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            block.timestamp + 7 days
        );

        uint256 firstBalance = rewardToken.balanceOf(traveler);

        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            block.timestamp + 8 days
        );

        assertEq(
            rewardToken.balanceOf(traveler),
            firstBalance
        );
    }

    function test_OrganizationCanAccessWithValidConsent() public {
        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            block.timestamp + 7 days
        );

        vm.prank(requester);
        (
            bool found,
            bytes32 returnedHash,
            bool attested
        ) = dataSharing.AccessDocument(
            traveler,
            passport
        );

        assertTrue(found);
        assertEq(returnedHash, passportHash);
        assertFalse(attested);
    }

    function test_AccessWithoutConsentIsDenied() public {
        vm.prank(requester);
        (
            bool found,
            bytes32 returnedHash,
            bool attested
        ) = dataSharing.AccessDocument(
            traveler,
            passport
        );

        assertFalse(found);
        assertEq(returnedHash, bytes32(0));
        assertFalse(attested);
    }

    function test_RevokedConsentPreventsAccess() public {
        vm.prank(traveler);
        dataSharing.GrantConsent(
            requester,
            passport,
            block.timestamp + 7 days
        );

        vm.prank(traveler);
        dataSharing.RevokeConsent(
            requester,
            passport
        );

        assertFalse(
            dataSharing.CanAccess(
                traveler,
                requester,
                passport
            )
        );

        vm.prank(requester);
        (
            bool found,
            bytes32 returnedHash,
            bool attested
        ) = dataSharing.AccessDocument(
            traveler,
            passport
        );

        assertFalse(found);
        assertEq(returnedHash, bytes32(0));
        assertFalse(attested);
    }

    function test_NonOrganizationCannotAccessDocument() public {
        vm.prank(outsider);
        vm.expectRevert(
            DataSharing.NotAnOrganization.selector
        );

        dataSharing.AccessDocument(
            traveler,
            passport
        );
    }

    function test_BatchConsentRejectsLengthMismatch() public {
        address[] memory requesters = new address[](1);
        bytes32[] memory docTypes = new bytes32[](2);
        uint256[] memory expiries = new uint256[](1);

        requesters[0] = requester;
        docTypes[0] = passport;
        docTypes[1] = passport;
        expiries[0] = block.timestamp + 7 days;

        vm.prank(traveler);
        vm.expectRevert(
            DataSharing.LengthMismatch.selector
        );

        dataSharing.GrantMultipleConsents(
            requesters,
            docTypes,
            expiries
        );
    }
}
