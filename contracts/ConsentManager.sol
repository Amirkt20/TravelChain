// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDigitalIdentity.sol";
import "./interfaces/IConsentManager.sol";

/**
 * @title ConsentManager (TravelChain)
 * @notice Stores "permission slips": traveler X allows requester Y to see document Z until time T.
 *
 * WHAT CHANGED vs the old EduChain version:
 *  1. SECURITY FIX: the old SetConsent/RevokeConsent had NO caller check. Anyone could call
 *     SetConsent(victim, attacker, ...) and give themselves access to someone else's diploma.
 *     Now only the DataSharing contract can call them (`onlyDataSharing`), and DataSharing
 *     always passes msg.sender as the traveler, so you can only manage YOUR OWN consents.
 *  2. Durations fit travel: 1 hour minimum, 30 days maximum (was 1 day - 365 days).
 *     E.g. an airline needs your passport around check-in, not for a whole year.
 *  3. Consent can't outlive the document: if your visa expires in 5 days,
 *     you can't give a 10-day consent for it.
 *  4. Only organizations can receive consent (not other travelers).
 *  5. Removed the unused `revoked` flag (the old code deleted records instead, so the flag
 *     was never true). A consent now "exists" when expiry != 0. Struct is 1 slot instead of 4.
 */
contract ConsentManager is IConsentManager {
    IDigitalIdentity public immutable identity;

    // The address allowed to modify consents. Set once after deployment (see SetDataSharing).
    address public dataSharing;
    // Who deployed us. Only they may call SetDataSharing. `immutable` = fixed at deploy time.
    address public immutable deployer;

    uint256 public constant MIN_CONSENT_DURATION = 1 hours;
    uint256 public constant MAX_CONSENT_DURATION = 30 days;

    // traveler => requester => docType => consent
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

    // Modifier = a reusable check that runs before the function body (`_;` = "run the function here")
    modifier onlyDataSharing() {
        if (msg.sender != dataSharing) revert NotAuthorized();
        _;
    }

    constructor(address identityAddress) {
        if (identityAddress == address(0)) revert InvalidAddress();
        identity = IDigitalIdentity(identityAddress);
        deployer = msg.sender;
    }

    /**
     * @notice Link this contract to DataSharing. Can only be done ONCE, by the deployer.
     * @dev Why not in the constructor? DataSharing's constructor needs OUR address and we'd
     *      need ITS address, a chicken-and-egg problem. So: deploy both, then link.
     */
    function SetDataSharing(address dataSharingAddress) external {
        if (msg.sender != deployer) revert NotAuthorized();
        if (dataSharing != address(0)) revert AlreadyInitialized();
        if (dataSharingAddress == address(0)) revert InvalidAddress();
        dataSharing = dataSharingAddress;
        emit DataSharingSet(dataSharingAddress);
    }

    /**
     * @notice Create or overwrite a consent. Only callable through DataSharing.
     * @param traveler the document owner (DataSharing passes msg.sender here)
     * @param requester the airline / hotel / ... getting access
     * @param docType which document
     * @param expiryTimestamp when access ends
     */
    function SetConsent(address traveler, address requester, bytes32 docType, uint256 expiryTimestamp)
        external
        onlyDataSharing
    {
        // --- CHECKS ---
        if (!identity.IsTraveler(traveler)) revert TravelerNotRegistered();
        if (!identity.IsOrganization(requester)) revert RequesterNotOrganization();
        if (!identity.DocumentExists(traveler, docType)) revert DocumentNotFound();
        if (expiryTimestamp <= block.timestamp) revert InvalidExpiryTimestamp();

        uint256 duration = expiryTimestamp - block.timestamp;
        if (duration < MIN_CONSENT_DURATION || duration > MAX_CONSENT_DURATION) revert InvalidConsentDuration();

        // Consent must end before (or when) the document itself expires
        uint64 docValidUntil = identity.GetDocument(traveler, docType).validUntil;
        if (docValidUntil != 0 && expiryTimestamp > docValidUntil) revert ConsentOutlivesDocument();

        // --- EFFECTS ---
        consents[traveler][requester][docType] =
            Consent({grantedAt: uint64(block.timestamp), expiry: uint64(expiryTimestamp)});

        emit ConsentGranted(traveler, requester, docType, expiryTimestamp, block.timestamp);
    }

    /// @notice Remove a consent early. Deleting storage gives a partial gas refund.
    function RevokeConsent(address traveler, address requester, bytes32 docType) external onlyDataSharing {
        if (consents[traveler][requester][docType].expiry == 0) revert ConsentNotFound();
        delete consents[traveler][requester][docType];
        emit ConsentRevoked(traveler, requester, docType, block.timestamp);
    }

    /// @notice True if the requester currently has a valid (existing, not expired) consent.
    function CheckConsent(address traveler, address requester, bytes32 docType) external view returns (bool) {
        uint64 expiry = consents[traveler][requester][docType].expiry;
        // expiry == 0 means "no consent" (never granted or revoked)
        return expiry != 0 && block.timestamp < expiry;
    }

    /// @notice Raw consent record. Reverts if none exists (expired ones are still returned).
    function GetConsent(address traveler, address requester, bytes32 docType) external view returns (Consent memory) {
        Consent memory c = consents[traveler][requester][docType];
        if (c.expiry == 0) revert ConsentNotFound();
        return c;
    }
}
