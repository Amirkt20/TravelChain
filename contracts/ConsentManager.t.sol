// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./DigitalIdentity.sol";
import "./ConsentManager.sol";

contract ConsentManagerTest is Test {
    DigitalIdentity private identity;
    ConsentManager private consentManager;

    address private traveler = address(0x1);
    address private requester = address(0x2);
    address private dataSharing = address(0x3);

    bytes32 private idHash = keccak256("traveler-id");
    bytes32 private contactHash = keccak256("traveler-contact");
    bytes32 private orgIdHash = keccak256("organization-id");
    bytes32 private orgContactHash = keccak256("organization-contact");
    bytes32 private passportHash = keccak256("passport-data");

    bytes32 private passport;

    function setUp() public {
        identity = new DigitalIdentity();
        consentManager = new ConsentManager(address(identity));

        passport = identity.PASSPORT();

        vm.prank(traveler);
        identity.RegisterTraveler(idHash, contactHash);

        identity.RegisterOrganization(
            requester,
            IDigitalIdentity.Role.Airline,
            orgIdHash,
            orgContactHash
        );

        vm.prank(traveler);
        identity.StoreDocument(
            passport,
            passportHash,
            uint64(block.timestamp + 400 days)
        );

        consentManager.SetDataSharing(dataSharing);
    }

    function test_DataSharingCanGrantConsent() public {
        uint256 expiry = block.timestamp + 7 days;

        vm.prank(dataSharing);
        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );

        assertTrue(
            consentManager.CheckConsent(
                traveler,
                requester,
                passport
            )
        );

        IConsentManager.Consent memory consent =
            consentManager.GetConsent(
                traveler,
                requester,
                passport
            );

        assertEq(consent.expiry, expiry);
    }

    function test_UnauthorizedAddressCannotGrantConsent() public {
        uint256 expiry = block.timestamp + 7 days;

        vm.prank(traveler);
        vm.expectRevert(ConsentManager.NotAuthorized.selector);

        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );
    }

    function test_ConsentExpires() public {
        uint256 expiry = block.timestamp + 1 days;

        vm.prank(dataSharing);
        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );

        assertTrue(
            consentManager.CheckConsent(
                traveler,
                requester,
                passport
            )
        );

        vm.warp(expiry);

        assertFalse(
            consentManager.CheckConsent(
                traveler,
                requester,
                passport
            )
        );
    }

    function test_DataSharingCanRevokeConsent() public {
        uint256 expiry = block.timestamp + 7 days;

        vm.prank(dataSharing);
        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );

        vm.prank(dataSharing);
        consentManager.RevokeConsent(
            traveler,
            requester,
            passport
        );

        assertFalse(
            consentManager.CheckConsent(
                traveler,
                requester,
                passport
            )
        );

        vm.expectRevert(ConsentManager.ConsentNotFound.selector);
        consentManager.GetConsent(
            traveler,
            requester,
            passport
        );
    }

    function test_ConsentCannotBeShorterThanMinimumDuration() public {
        uint256 expiry = block.timestamp + 23 hours;

        vm.prank(dataSharing);
        vm.expectRevert(
            ConsentManager.InvalidConsentDuration.selector
        );

        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );
    }

    function test_ConsentCannotExceedMaximumDuration() public {
        uint256 expiry = block.timestamp + 366 days;

        vm.prank(dataSharing);
        vm.expectRevert(
            ConsentManager.InvalidConsentDuration.selector
        );

        consentManager.SetConsent(
            traveler,
            requester,
            passport,
            expiry
        );
    }

    function test_ConsentCannotOutliveDocument() public {
        address secondTraveler = address(0x4);

        vm.prank(secondTraveler);
        identity.RegisterTraveler(
            keccak256("second-traveler-id"),
            keccak256("second-traveler-contact")
        );

        vm.prank(secondTraveler);
        identity.StoreDocument(
            passport,
            keccak256("second-passport"),
            uint64(block.timestamp + 2 days)
        );

        uint256 consentExpiry = block.timestamp + 3 days;

        vm.prank(dataSharing);
        vm.expectRevert(
            ConsentManager.ConsentOutlivesDocument.selector
        );

        consentManager.SetConsent(
            secondTraveler,
            requester,
            passport,
            consentExpiry
        );
    }

    function test_RequesterMustBeOrganization() public {
        address nonOrganization = address(0x5);

        uint256 expiry = block.timestamp + 7 days;

        vm.prank(dataSharing);
        vm.expectRevert(
            ConsentManager.RequesterNotOrganization.selector
        );

        consentManager.SetConsent(
            traveler,
            nonOrganization,
            passport,
            expiry
        );
    }
}
