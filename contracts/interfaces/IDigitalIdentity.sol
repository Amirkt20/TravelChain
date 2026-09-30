// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDigitalIdentity
 * @notice The "contract between contracts" for the identity layer.
 * @dev ConsentManager and DataSharing ONLY talk to DigitalIdentity through this file.
 *      If you change a function here, the other contracts must be updated too,
 *      so treat this as frozen once the team agrees on it.
 */
interface IDigitalIdentity {
    // Who someone is in the system.
    // - Traveler: owns documents and grants consent
    // - Airline / Hotel / TravelAgency / BorderControl: "requesters" that want to see documents
    // None = not registered (default value of an enum is its first member).
    enum Role {
        None,
        Traveler,
        Airline,
        Hotel,
        TravelAgency,
        BorderControl
    }

    // One travel document (passport, visa, booking...) belonging to a traveler.
    // Only the HASH of the file is stored, never the file itself.
    struct Document {
        bytes32 docHash;    // hash of the actual document file (ideally salted, see README)
        address attestedBy; // issuer that confirmed this hash (address(0) = not attested yet)
        uint64 storedAt;    // when the traveler uploaded the hash
        uint64 validUntil;  // expiry date of the real document (0 = does not expire)
    }

    function IsRegistered(address user) external view returns (bool);
    function GetRole(address user) external view returns (Role);
    function IsTraveler(address user) external view returns (bool);
    function IsOrganization(address user) external view returns (bool);

    function DocumentExists(address traveler, bytes32 docType) external view returns (bool);
    function GetDocument(address traveler, bytes32 docType) external view returns (Document memory);
}
