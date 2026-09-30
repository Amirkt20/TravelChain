// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IDigitalIdentity.sol";

/**
 * @title DigitalIdentity (TravelChain)
 * @notice Registers travelers and organizations, and stores HASHES of travel documents.
 *
 * WHAT CHANGED vs the old EduChain version:
 *  1. Roles. Old version: everyone registered the same way, so a "student" and an
 *     "employer" were indistinguishable. Now every address has a Role.
 *  2. Organizations are registered by the admin (owner), so a random wallet can't just
 *     claim to be "KLM" and ask travelers for their passport.
 *  3. Issuers. Old version: a student uploaded their own diploma hash, so a match only
 *     proved "this is the file the student uploaded", not that it's genuine.
 *     Now trusted issuers (e.g. a passport office, an embassy for visas, an airline for
 *     bookings) can ATTEST a document hash. Requesters can see whether a doc is attested.
 *  4. Documents have a validity date (passports and visas expire).
 *  5. Only known document types are accepted (PASSPORT, VISA, ...).
 *
 * PRIVACY: we only store hashes. Personal data (name, email, passport number) is hashed
 * off-chain before being sent here. Anything on a public chain is readable by anyone,
 * including "private" variables, so NEVER put plaintext here.
 */
contract DigitalIdentity is IDigitalIdentity, Ownable {
    // ----------------------------------------------------------------------------------
    // Document types
    // ----------------------------------------------------------------------------------
    // Document types are identified by keccak256 of a name. Using bytes32 instead of
    // strings is cheaper and fixed-size. These are `constant`, so they cost no storage.
    bytes32 public constant PASSPORT = keccak256("PASSPORT");
    bytes32 public constant VISA = keccak256("VISA");
    bytes32 public constant FLIGHT_BOOKING = keccak256("FLIGHT_BOOKING");
    bytes32 public constant HOTEL_BOOKING = keccak256("HOTEL_BOOKING");
    bytes32 public constant VACCINATION_CERT = keccak256("VACCINATION_CERT");
    bytes32 public constant TRAVEL_INSURANCE = keccak256("TRAVEL_INSURANCE");

    // ----------------------------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------------------------
    struct User {
        Role role;          // 1 byte  } these two are packed together
        uint64 registeredAt; // 8 bytes } into one 32-byte storage slot (saves gas)
        bytes32 idHash;     // hash of a unique ID (traveler: national ID, org: company reg. number)
        bytes32 contactHash; // hash of email / contact info
    }

    mapping(address => User) private users;

    // traveler address => document type => document
    mapping(address => mapping(bytes32 => Document)) private documents;

    // which document type names are allowed
    mapping(bytes32 => bool) public supportedDocTypes;

    // addresses allowed to attest documents (passport office, embassy, ...)
    mapping(address => bool) public isIssuer;

    // ----------------------------------------------------------------------------------
    // Events (cheap permanent log that off-chain apps can read)
    // ----------------------------------------------------------------------------------
    event TravelerRegistered(address indexed traveler, uint256 timestamp);
    event OrganizationRegistered(address indexed org, Role role, uint256 timestamp);
    event IssuerUpdated(address indexed issuer, bool allowed);
    event DocTypeAdded(bytes32 indexed docType);
    event DocumentStored(address indexed traveler, bytes32 indexed docType, uint64 validUntil, uint256 timestamp);
    event DocumentAttested(address indexed traveler, bytes32 indexed docType, address indexed issuer, uint256 timestamp);

    // ----------------------------------------------------------------------------------
    // Errors (custom errors are cheaper than require("long string"))
    // ----------------------------------------------------------------------------------
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

    // Ownable(msg.sender): whoever deploys the contract becomes the admin.
    constructor() Ownable(msg.sender) {
        // Register the default travel document types
        _addDocType(PASSPORT);
        _addDocType(VISA);
        _addDocType(FLIGHT_BOOKING);
        _addDocType(HOTEL_BOOKING);
        _addDocType(VACCINATION_CERT);
        _addDocType(TRAVEL_INSURANCE);
    }

    // ==================================================================================
    // Admin functions (only the owner can call these, enforced by `onlyOwner`)
    // ==================================================================================

    /// @notice Register an airline / hotel / agency / border control authority.
    /// @dev Done by the admin so organizations are vetted, not self-declared.
    function RegisterOrganization(address org, Role role, bytes32 idHash, bytes32 contactHash)
        external
        onlyOwner
    {
        if (org == address(0) || idHash == bytes32(0) || contactHash == bytes32(0)) revert InvalidParameter();
        // An organization can't be registered with the None or Traveler role
        if (role == Role.None || role == Role.Traveler) revert InvalidRole();
        if (users[org].role != Role.None) revert AlreadyRegistered();

        users[org] = User({role: role, registeredAt: uint64(block.timestamp), idHash: idHash, contactHash: contactHash});
        emit OrganizationRegistered(org, role, block.timestamp);
    }

    /// @notice Allow or disallow an address to attest documents.
    function SetIssuer(address issuer, bool allowed) external onlyOwner {
        if (issuer == address(0)) revert InvalidParameter();
        isIssuer[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    /// @notice Add a new document type later on (e.g. "ESTA", "RAIL_PASS").
    function AddDocType(bytes32 docType) external onlyOwner {
        if (docType == bytes32(0)) revert InvalidParameter();
        _addDocType(docType);
    }

    // ==================================================================================
    // Traveler functions
    // ==================================================================================

    /// @notice A traveler registers themselves. One registration per wallet.
    /// @param idHash hash of e.g. national ID number (hash + salt it off-chain!)
    /// @param contactHash hash of email address
    function RegisterTraveler(bytes32 idHash, bytes32 contactHash) external {
        if (users[msg.sender].role != Role.None) revert AlreadyRegistered();
        if (idHash == bytes32(0) || contactHash == bytes32(0)) revert InvalidParameter();

        users[msg.sender] =
            User({role: Role.Traveler, registeredAt: uint64(block.timestamp), idHash: idHash, contactHash: contactHash});
        emit TravelerRegistered(msg.sender, block.timestamp);
    }

    /// @notice Store (or replace) the hash of one of your travel documents.
    /// @param docType e.g. keccak256("PASSPORT")
    /// @param docHash hash of the document file
    /// @param validUntil expiry date of the real document, 0 if it never expires
    /// @dev Replacing a document wipes the old attestation, because the issuer only
    ///      vouched for the OLD file, not the new one.
    function StoreDocument(bytes32 docType, bytes32 docHash, uint64 validUntil) external {
        if (users[msg.sender].role != Role.Traveler) revert NotATraveler();
        if (!supportedDocTypes[docType]) revert UnsupportedDocType();
        if (docHash == bytes32(0)) revert InvalidParameter();
        // Storing an already-expired passport makes no sense
        if (validUntil != 0 && validUntil <= block.timestamp) revert DocumentAlreadyExpired();

        documents[msg.sender][docType] = Document({
            docHash: docHash,
            attestedBy: address(0), // fresh upload = not attested yet
            storedAt: uint64(block.timestamp),
            validUntil: validUntil
        });
        emit DocumentStored(msg.sender, docType, validUntil, block.timestamp);
    }

    // ==================================================================================
    // Issuer functions
    // ==================================================================================

    /// @notice An issuer confirms that the stored hash belongs to a genuine document.
    /// @param expectedHash the hash the issuer computed from THEIR copy of the document.
    ///        It must equal the stored hash, which prevents the issuer from accidentally
    ///        attesting a different file (e.g. if the traveler replaced it in the meantime).
    function AttestDocument(address traveler, bytes32 docType, bytes32 expectedHash) external {
        if (!isIssuer[msg.sender]) revert NotAnIssuer();

        Document storage doc = documents[traveler][docType]; // `storage` = edit in place
        if (doc.docHash == bytes32(0)) revert DocumentNotFound();
        if (doc.docHash != expectedHash) revert HashMismatch();

        doc.attestedBy = msg.sender;
        emit DocumentAttested(traveler, docType, msg.sender, block.timestamp);
    }

    // ==================================================================================
    // View functions (free to call off-chain, used by the other contracts)
    // ==================================================================================

    function IsRegistered(address user) external view returns (bool) {
        return users[user].role != Role.None;
    }

    function GetRole(address user) external view returns (Role) {
        return users[user].role;
    }

    function IsTraveler(address user) external view returns (bool) {
        return users[user].role == Role.Traveler;
    }

    /// @notice True for any registered non-traveler (airline, hotel, agency, border control).
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

    /// @notice Full document record. Reverts if there is no such document.
    /// @dev Note: this is callable by anyone. Blockchain storage is public anyway, so
    ///      hiding it behind a function would give a false sense of privacy. Real
    ///      protection comes from salting the hash off-chain (see README).
    function GetDocument(address traveler, bytes32 docType) external view returns (Document memory) {
        Document memory doc = documents[traveler][docType];
        if (doc.docHash == bytes32(0)) revert DocumentNotFound();
        return doc;
    }

    // ==================================================================================
    // Internal helpers
    // ==================================================================================

    function _addDocType(bytes32 docType) internal {
        supportedDocTypes[docType] = true;
        emit DocTypeAdded(docType);
    }
}
