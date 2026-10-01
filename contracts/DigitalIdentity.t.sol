// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./DigitalIdentity.sol";

contract DigitalIdentityTest is Test {
    DigitalIdentity private identity;

    address private traveler = address(0x1);
    address private issuer = address(0x2);

    bytes32 private idHash = keccak256("traveler-id");
    bytes32 private contactHash = keccak256("traveler-contact");
    bytes32 private passportHash = keccak256("passport-data");

    function setUp() public {
        identity = new DigitalIdentity();
    }

    function test_RegisterTraveler() public {
        vm.prank(traveler);
        identity.RegisterTraveler(idHash, contactHash);

        assertTrue(identity.IsRegistered(traveler));
        assertTrue(identity.IsTraveler(traveler));
        assertEq(
            uint256(identity.GetRole(traveler)),
            uint256(IDigitalIdentity.Role.Traveler)
        );
    }

    function test_CannotRegisterTravelerTwice() public {
        vm.startPrank(traveler);

        identity.RegisterTraveler(idHash, contactHash);

        vm.expectRevert(DigitalIdentity.AlreadyRegistered.selector);
        identity.RegisterTraveler(idHash, contactHash);

        vm.stopPrank();
    }

    function test_TravelerCanStorePassport() public {
        vm.startPrank(traveler);

        identity.RegisterTraveler(idHash, contactHash);

        uint64 validUntil = uint64(block.timestamp + 30 days);
        identity.StoreDocument(
            identity.PASSPORT(),
            passportHash,
            validUntil
        );

        vm.stopPrank();

        assertTrue(
            identity.DocumentExists(traveler, identity.PASSPORT())
        );

        IDigitalIdentity.Document memory doc =
            identity.GetDocument(traveler, identity.PASSPORT());

        assertEq(doc.docHash, passportHash);
        assertEq(doc.validUntil, validUntil);
    }

    function test_CannotStoreUnsupportedDocumentType() public {
        vm.startPrank(traveler);

        identity.RegisterTraveler(idHash, contactHash);

        bytes32 unsupportedType = keccak256("DRIVING_LICENSE");

        vm.expectRevert(DigitalIdentity.UnsupportedDocType.selector);
        identity.StoreDocument(
            unsupportedType,
            passportHash,
            uint64(block.timestamp + 30 days)
        );

        vm.stopPrank();
    }

    function test_IssuerCanAttestDocument() public {
        bytes32 passport = identity.PASSPORT();

        vm.prank(traveler);
        identity.RegisterTraveler(idHash, contactHash);

        vm.prank(traveler);
        identity.StoreDocument(
            passport,
            passportHash,
            uint64(block.timestamp + 30 days)
        );

        identity.SetIssuer(issuer, true);

        vm.prank(issuer);
        identity.AttestDocument(
            traveler,
            passport,
            passportHash
        );

        IDigitalIdentity.Document memory doc =
            identity.GetDocument(traveler, passport);

        assertEq(doc.attestedBy, issuer);
    }

    function test_AttestationFailsWithWrongHash() public {
        bytes32 passport = identity.PASSPORT();

        vm.prank(traveler);
        identity.RegisterTraveler(idHash, contactHash);

        vm.prank(traveler);
        identity.StoreDocument(
            passport,
            passportHash,
            uint64(block.timestamp + 30 days)
        );

        identity.SetIssuer(issuer, true);

        vm.prank(issuer);
        vm.expectRevert(DigitalIdentity.HashMismatch.selector);
        identity.AttestDocument(
            traveler,
            passport,
            keccak256("wrong-passport-data")
        );
    }
}
