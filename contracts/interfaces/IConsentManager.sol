// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IConsentManager {

    struct Consent {
        uint64 grantedAt;
        uint64 expiry;
    }

    function SetConsent(address traveler, address requester, bytes32 docType, uint256 expiryTimestamp) external;
    function RevokeConsent(address traveler, address requester, bytes32 docType) external;
    function CheckConsent(address traveler, address requester, bytes32 docType) external view returns (bool);
    function GetConsent(address traveler, address requester, bytes32 docType) external view returns (Consent memory);
}
