// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IDigitalIdentity.sol";

contract DigitalIdentity is IDigitalIdentity, Ownable {

    bytes32 public constant PASSPORT = keccak256("PASSPORT");
    bytes32 public constant VISA = keccak256("VISA");
    bytes32 public constant FLIGHT_BOOKING = keccak256("FLIGHT_BOOKING");
    bytes32 public constant HOTEL_BOOKING = keccak256("HOTEL_BOOKING");
    bytes32 public constant VACCINATION_CERT = keccak256("VACCINATION_CERT");
    bytes32 public constant TRAVEL_INSURANCE = keccak256("TRAVEL_INSURANCE");

    struct User {
        Role role;
        uint64 registeredAt;
        bytes32 idHash;
        bytes32 contactHash;
    }

    mapping(address => User) private users;

    mapping(address => mapping(bytes32 => Document)) private documents;

    mapping(bytes32 => bool) public supportedDocTypes;

    mapping(address => bool) public isIssuer;

    event TravelerRegistered(address indexed traveler, uint256 timestamp);
    event OrganizationRegistered(address indexed org, Role role, uint256 timestamp);
    event IssuerUpdated(address indexed issuer, bool allowed);
    event DocTypeAdded(bytes32 indexed docType);
    event DocumentStored(address indexed traveler, bytes32 indexed docType, uint64 validUntil, uint256 timestamp);
    event DocumentAttested(address indexed traveler, bytes32 indexed docType, address indexed issuer, uint256 timestamp);

    error AlreadyRegistered();
    error NotRegistered();
    error NotATraveler();
    error InvalidParameter();
    error InvalidRole();
    error UnsupportedDocType();
    error DocumentNotFound();
    error DocumentAlreadyExpired();
    error NotAnIssuer();
    error HashMismatch();

    constructor() Ownable(msg.sender) {

        _addDocType(PASSPORT);
        _addDocType(VISA);
        _addDocType(FLIGHT_BOOKING);
        _addDocType(HOTEL_BOOKING);
        _addDocType(VACCINATION_CERT);
        _addDocType(TRAVEL_INSURANCE);
    }

    function RegisterOrganization(address org, Role role, bytes32 idHash, bytes32 contactHash)
        external
        onlyOwner
    {
        if (org == address(0) || idHash == bytes32(0) || contactHash == bytes32(0)) revert InvalidParameter();

        if (role == Role.None || role == Role.Traveler) revert InvalidRole();
        if (users[org].role != Role.None) revert AlreadyRegistered();

        users[org] = User({role: role, registeredAt: uint64(block.timestamp), idHash: idHash, contactHash: contactHash});
        emit OrganizationRegistered(org, role, block.timestamp);
    }

    function SetIssuer(address issuer, bool allowed) external onlyOwner {
        if (issuer == address(0)) revert InvalidParameter();
        isIssuer[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    function AddDocType(bytes32 docType) external onlyOwner {
        if (docType == bytes32(0)) revert InvalidParameter();
        _addDocType(docType);
    }

    function RegisterTraveler(bytes32 idHash, bytes32 contactHash) external {
        if (users[msg.sender].role != Role.None) revert AlreadyRegistered();
        if (idHash == bytes32(0) || contactHash == bytes32(0)) revert InvalidParameter();

        users[msg.sender] =
            User({role: Role.Traveler, registeredAt: uint64(block.timestamp), idHash: idHash, contactHash: contactHash});
        emit TravelerRegistered(msg.sender, block.timestamp);
    }

    function StoreDocument(bytes32 docType, bytes32 docHash, uint64 validUntil) external {
        if (users[msg.sender].role != Role.Traveler) revert NotATraveler();
        if (!supportedDocTypes[docType]) revert UnsupportedDocType();
        if (docHash == bytes32(0)) revert InvalidParameter();

        if (validUntil != 0 && validUntil <= block.timestamp) revert DocumentAlreadyExpired();

        documents[msg.sender][docType] = Document({
            docHash: docHash,
            attestedBy: address(0),
            storedAt: uint64(block.timestamp),
            validUntil: validUntil
        });
        emit DocumentStored(msg.sender, docType, validUntil, block.timestamp);
    }

    function AttestDocument(address traveler, bytes32 docType, bytes32 expectedHash) external {
        if (!isIssuer[msg.sender]) revert NotAnIssuer();

        Document storage doc = documents[traveler][docType];
        if (doc.docHash == bytes32(0)) revert DocumentNotFound();
        if (doc.docHash != expectedHash) revert HashMismatch();

        doc.attestedBy = msg.sender;
        emit DocumentAttested(traveler, docType, msg.sender, block.timestamp);
    }

    function IsRegistered(address user) external view returns (bool) {
        return users[user].role != Role.None;
    }

    function GetRole(address user) external view returns (Role) {
        return users[user].role;
    }

    function IsTraveler(address user) external view returns (bool) {
        return users[user].role == Role.Traveler;
    }

    function IsOrganization(address user) external view returns (bool) {
        Role r = users[user].role;
        return r != Role.None && r != Role.Traveler;
    }

    function GetUser(address user) external view returns (User memory) {
        if (users[user].role == Role.None) revert NotRegistered();
        return users[user];
    }

    function DocumentExists(address traveler, bytes32 docType) external view returns (bool) {
        return documents[traveler][docType].docHash != bytes32(0);
    }

    function GetDocument(address traveler, bytes32 docType) external view returns (Document memory) {
        Document memory doc = documents[traveler][docType];
        if (doc.docHash == bytes32(0)) revert DocumentNotFound();
        return doc;
    }

    function _addDocType(bytes32 docType) internal {
        supportedDocTypes[docType] = true;
        emit DocTypeAdded(docType);
    }
}
