// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IConsentManager
 * @notice Interface DataSharing uses to store, remove and check consents.
 * @dev SetConsent / RevokeConsent may ONLY be called by the DataSharing contract.
 *      Travelers never call ConsentManager directly; they go through DataSharing.
 */
interface IConsentManager {
    // A single "permission slip": traveler X lets requester Y see document Z until `expiry`.
    struct Consent {
        uint64 grantedAt; // when the consent was given
        uint64 expiry;    // unix timestamp after which access is no longer allowed (0 = no consent)
    }

    function SetConsent(address traveler, address requester, bytes32 docType, uint256 expiryTimestamp) external;
    function RevokeConsent(address traveler, address requester, bytes32 docType) external;
    function CheckConsent(address traveler, address requester, bytes32 docType) external view returns (bool);
    function GetConsent(address traveler, address requester, bytes32 docType) external view returns (Consent memory);
}
