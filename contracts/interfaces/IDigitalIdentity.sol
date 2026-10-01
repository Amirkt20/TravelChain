// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDigitalIdentity {

    enum Role {
        None,
        Traveler,
        Airline,
        Hotel,
        TravelAgency,
        BorderControl
    }

    struct Document {
        bytes32 docHash;
        address attestedBy;
        uint64 storedAt;
        uint64 validUntil;
    }

    function IsRegistered(address user) external view returns (bool);
    function GetRole(address user) external view returns (Role);
    function IsTraveler(address user) external view returns (bool);
    function IsOrganization(address user) external view returns (bool);

    function DocumentExists(address traveler, bytes32 docType) external view returns (bool);
    function GetDocument(address traveler, bytes32 docType) external view returns (Document memory);
}
