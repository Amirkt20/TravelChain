// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDigitalIdentity.sol";
import "./interfaces/IConsentManager.sol";

contract ConsentManager is IConsentManager {
    IDigitalIdentity public immutable identity;

    address public dataSharing;

    address public immutable deployer;

    uint256 public constant MIN_CONSENT_DURATION = 1 days;
    uint256 public constant MAX_CONSENT_DURATION = 365 days;

    mapping(address => mapping(address => mapping(bytes32 => Consent))) private consents;

    event DataSharingSet(address indexed dataSharing);
    event ConsentGranted(
        address indexed traveler, address indexed requester, bytes32 indexed docType, uint256 expiry, uint256 timestamp
    );
    event ConsentRevoked(address indexed traveler, address indexed requester, bytes32 indexed docType, uint256 timestamp);

    error InvalidAddress();
    error NotAuthorized();
    error AlreadyInitialized();
    error TravelerNotRegistered();
    error RequesterNotOrganization();
    error DocumentNotFound();
    error InvalidExpiryTimestamp();
    error InvalidConsentDuration();
    error ConsentOutlivesDocument();
    error ConsentNotFound();

    modifier onlyDataSharing() {
        if (msg.sender != dataSharing) revert NotAuthorized();
        _;
    }

    constructor(address identityAddress) {
        if (identityAddress == address(0)) revert InvalidAddress();
        identity = IDigitalIdentity(identityAddress);
        deployer = msg.sender;
    }

    function SetDataSharing(address dataSharingAddress) external {
        if (msg.sender != deployer) revert NotAuthorized();
        if (dataSharing != address(0)) revert AlreadyInitialized();
        if (dataSharingAddress == address(0)) revert InvalidAddress();
        dataSharing = dataSharingAddress;
        emit DataSharingSet(dataSharingAddress);
    }

    function SetConsent(address traveler, address requester, bytes32 docType, uint256 expiryTimestamp)
        external
        onlyDataSharing
    {

        if (!identity.IsTraveler(traveler)) revert TravelerNotRegistered();
        if (!identity.IsOrganization(requester)) revert RequesterNotOrganization();
        if (!identity.DocumentExists(traveler, docType)) revert DocumentNotFound();
        if (expiryTimestamp <= block.timestamp) revert InvalidExpiryTimestamp();

        uint256 duration = expiryTimestamp - block.timestamp;
        if (duration < MIN_CONSENT_DURATION || duration > MAX_CONSENT_DURATION) revert InvalidConsentDuration();

        uint64 docValidUntil = identity.GetDocument(traveler, docType).validUntil;
        if (docValidUntil != 0 && expiryTimestamp > docValidUntil) revert ConsentOutlivesDocument();

        consents[traveler][requester][docType] =
            Consent({grantedAt: uint64(block.timestamp), expiry: uint64(expiryTimestamp)});

        emit ConsentGranted(traveler, requester, docType, expiryTimestamp, block.timestamp);
    }

    function RevokeConsent(address traveler, address requester, bytes32 docType) external onlyDataSharing {
        if (consents[traveler][requester][docType].expiry == 0) revert ConsentNotFound();
        delete consents[traveler][requester][docType];
        emit ConsentRevoked(traveler, requester, docType, block.timestamp);
    }

    function CheckConsent(address traveler, address requester, bytes32 docType) external view returns (bool) {
        uint64 expiry = consents[traveler][requester][docType].expiry;

        return expiry != 0 && block.timestamp < expiry;
    }

    function GetConsent(address traveler, address requester, bytes32 docType) external view returns (Consent memory) {
        Consent memory c = consents[traveler][requester][docType];
        if (c.expiry == 0) revert ConsentNotFound();
        return c;
    }
}
