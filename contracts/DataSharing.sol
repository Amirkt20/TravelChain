// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDigitalIdentity.sol";
import "./interfaces/IConsentManager.sol";
import "./interfaces/IRewardToken.sol";

/**
 * @title DataSharing (TravelChain)
 * @notice The contract travelers and requesters actually interact with. It ties together
 *         identity (who you are), consent (who may see what) and rewards (tokens for sharing).
 *
 * WHAT CHANGED vs the old EduChain version:
 *  1. AUDIT FIX: the old AccessData emitted AccessDenied and then REVERTED. A revert undoes
 *     everything in the transaction, INCLUDING emitted events, so denied attempts were never
 *     actually logged. Now a denied access returns normally with found = false, so the
 *     AccessDenied event is permanently stored.
 *  2. ANTI-FARMING: the old version minted 10 tokens on every grant, so grant -> revoke ->
 *     grant again printed infinite tokens. Now each (traveler, requester, docType) combination
 *     is rewarded only the first time.
 *  3. Access also checks that the document itself hasn't expired (e.g. expired passport).
 *  4. The access result tells the requester whether the document was attested by an issuer.
 *  5. Deny reasons are an enum instead of a string (cheaper, easier to filter off-chain).
 */
contract DataSharing {
    IDigitalIdentity public immutable identity;
    IConsentManager public immutable consentManager;
    IRewardToken public immutable rewardToken;

    // 10 tokens. Tokens have 18 decimals, like ETH, so 1 token = 10**18 base units.
    uint256 public constant REWARD_PER_CONSENT = 10 * 10 ** 18;

    // Why an access attempt was refused (logged in AccessDenied)
    enum DenyReason {
        NoValidConsent,  // never granted, revoked, or consent expired
        DocumentExpired  // consent is fine but the document itself is past its validUntil date
    }

    // Tracks which (traveler, requester, docType) combos already earned a reward.
    // Key = keccak256(traveler, requester, docType), cheaper than a 3-level mapping of bools.
    mapping(bytes32 => bool) public rewarded;

    event TokensRewarded(address indexed traveler, uint256 amount, uint256 timestamp);
    event AccessGranted(
        address indexed traveler,
        address indexed requester,
        bytes32 indexed docType,
        bytes32 docHash,
        bool attested,
        uint256 timestamp
    );
    event AccessDenied(
        address indexed traveler, address indexed requester, bytes32 indexed docType, DenyReason reason, uint256 timestamp
    );

    error InvalidAddress();
    error LengthMismatch();
    error NotAnOrganization();

    constructor(address identityAddress, address consentManagerAddress, address rewardTokenAddress) {
        if (identityAddress == address(0) || consentManagerAddress == address(0) || rewardTokenAddress == address(0)) {
            revert InvalidAddress();
        }
        identity = IDigitalIdentity(identityAddress);
        consentManager = IConsentManager(consentManagerAddress);
        rewardToken = IRewardToken(rewardTokenAddress);
    }

    // ==================================================================================
    // Traveler actions
    // ==================================================================================

    /**
     * @notice Let `requester` see one of your documents until `expiryTimestamp`.
     *         First time for this requester + document: you earn REWARD_PER_CONSENT tokens.
     * @dev msg.sender is always used as the traveler, so nobody can grant consent for
     *      someone else's documents.
     */
    function GrantConsent(address requester, bytes32 docType, uint256 expiryTimestamp) external {
        // ConsentManager does all validation and reverts if anything is wrong
        consentManager.SetConsent(msg.sender, requester, docType, expiryTimestamp);

        if (_markRewarded(msg.sender, requester, docType)) {
            rewardToken.mint(msg.sender, REWARD_PER_CONSENT);
            emit TokensRewarded(msg.sender, REWARD_PER_CONSENT, block.timestamp);
        }
    }

    /**
     * @notice Grant several consents in one transaction, e.g. passport + visa to an airline,
     *         and a booking to a hotel. Arrays must be the same length; index i of each
     *         array together forms one consent.
     */
    function GrantMultipleConsents(
        address[] calldata requesters,
        bytes32[] calldata docTypes,
        uint256[] calldata expiries
    ) external {
        uint256 length = requesters.length;
        if (length != docTypes.length || length != expiries.length) revert LengthMismatch();

        uint256 newRewards = 0;
        for (uint256 i = 0; i < length; i++) {
            consentManager.SetConsent(msg.sender, requesters[i], docTypes[i], expiries[i]);
            if (_markRewarded(msg.sender, requesters[i], docTypes[i])) newRewards++;
        }

        // One mint call for the whole batch is cheaper than one per consent
        if (newRewards > 0) {
            uint256 total = REWARD_PER_CONSENT * newRewards;
            rewardToken.mint(msg.sender, total);
            emit TokensRewarded(msg.sender, total, block.timestamp);
        }
    }

    /// @notice Take back access immediately. You keep tokens you already earned.
    function RevokeConsent(address requester, bytes32 docType) external {
        consentManager.RevokeConsent(msg.sender, requester, docType);
    }

    // ==================================================================================
    // Requester actions
    // ==================================================================================

    /**
     * @notice A requester (airline, hotel...) retrieves a traveler's document hash.
     *         Every attempt is logged: AccessGranted or AccessDenied.
     * @return found true if access was allowed
     * @return docHash the stored hash (bytes32(0) if denied)
     * @return attested true if a trusted issuer vouched for this document
     *
     * @dev This is a state-changing function (it emits events), so when called as a real
     *      transaction the return values are NOT visible to the caller's wallet. Off-chain
     *      apps should read the AccessGranted event from the transaction receipt. Tests can
     *      use `.staticCall` to preview the return values.
     *
     * After receiving the hash, the requester hashes the file the traveler sent them
     * (off-chain) and compares. Same hash = the file is exactly what was registered.
     */
    function AccessDocument(address traveler, bytes32 docType)
        external
        returns (bool found, bytes32 docHash, bool attested)
    {
        // Only vetted organizations can request documents
        if (!identity.IsOrganization(msg.sender)) revert NotAnOrganization();

        if (!consentManager.CheckConsent(traveler, msg.sender, docType)) {
            // No revert here on purpose: a revert would erase this audit event
            emit AccessDenied(traveler, msg.sender, docType, DenyReason.NoValidConsent, block.timestamp);
            return (false, bytes32(0), false);
        }

        // Consent exists, so the document exists too (ConsentManager checked that)
        IDigitalIdentity.Document memory doc = identity.GetDocument(traveler, docType);

        if (doc.validUntil != 0 && block.timestamp >= doc.validUntil) {
            emit AccessDenied(traveler, msg.sender, docType, DenyReason.DocumentExpired, block.timestamp);
            return (false, bytes32(0), false);
        }

        attested = doc.attestedBy != address(0);
        emit AccessGranted(traveler, msg.sender, docType, doc.docHash, attested, block.timestamp);
        return (true, doc.docHash, attested);
    }

    // ==================================================================================
    // View helpers (free, don't log anything)
    // ==================================================================================

    function CanAccess(address traveler, address requester, bytes32 docType) external view returns (bool) {
        return consentManager.CheckConsent(traveler, requester, docType);
    }

    function GetConsentExpiry(address traveler, address requester, bytes32 docType) external view returns (uint256) {
        return consentManager.GetConsent(traveler, requester, docType).expiry;
    }

    function GetTokenBalance(address account) external view returns (uint256) {
        return rewardToken.balanceOf(account);
    }

    // ==================================================================================
    // Internal
    // ==================================================================================

    /// @dev Returns true (and records it) if this combo has NOT been rewarded before.
    function _markRewarded(address traveler, address requester, bytes32 docType) internal returns (bool) {
        bytes32 key = keccak256(abi.encode(traveler, requester, docType));
        if (rewarded[key]) return false;
        rewarded[key] = true;
        return true;
    }
}
