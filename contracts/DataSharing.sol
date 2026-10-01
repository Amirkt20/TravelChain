// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDigitalIdentity.sol";
import "./interfaces/IConsentManager.sol";
import "./interfaces/IRewardToken.sol";

contract DataSharing {
    IDigitalIdentity public immutable identity;
    IConsentManager public immutable consentManager;
    IRewardToken public immutable rewardToken;

    uint256 public constant REWARD_PER_CONSENT = 10 * 10 ** 18;

    enum DenyReason {
        NoValidConsent,
        DocumentExpired
    }

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

    function GrantConsent(address requester, bytes32 docType, uint256 expiryTimestamp) external {

        consentManager.SetConsent(msg.sender, requester, docType, expiryTimestamp);

        if (_markRewarded(msg.sender, requester, docType)) {
            rewardToken.mint(msg.sender, REWARD_PER_CONSENT);
            emit TokensRewarded(msg.sender, REWARD_PER_CONSENT, block.timestamp);
        }
    }

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

        if (newRewards > 0) {
            uint256 total = REWARD_PER_CONSENT * newRewards;
            rewardToken.mint(msg.sender, total);
            emit TokensRewarded(msg.sender, total, block.timestamp);
        }
    }

    function RevokeConsent(address requester, bytes32 docType) external {
        consentManager.RevokeConsent(msg.sender, requester, docType);
    }

    function AccessDocument(address traveler, bytes32 docType)
        external
        returns (bool found, bytes32 docHash, bool attested)
    {

        if (!identity.IsOrganization(msg.sender)) revert NotAnOrganization();

        if (!consentManager.CheckConsent(traveler, msg.sender, docType)) {

            emit AccessDenied(traveler, msg.sender, docType, DenyReason.NoValidConsent, block.timestamp);
            return (false, bytes32(0), false);
        }

        IDigitalIdentity.Document memory doc = identity.GetDocument(traveler, docType);

        if (doc.validUntil != 0 && block.timestamp >= doc.validUntil) {
            emit AccessDenied(traveler, msg.sender, docType, DenyReason.DocumentExpired, block.timestamp);
            return (false, bytes32(0), false);
        }

        attested = doc.attestedBy != address(0);
        emit AccessGranted(traveler, msg.sender, docType, doc.docHash, attested, block.timestamp);
        return (true, doc.docHash, attested);
    }

    function CanAccess(address traveler, address requester, bytes32 docType) external view returns (bool) {
        return consentManager.CheckConsent(traveler, requester, docType);
    }

    function GetConsentExpiry(address traveler, address requester, bytes32 docType) external view returns (uint256) {
        return consentManager.GetConsent(traveler, requester, docType).expiry;
    }

    function GetTokenBalance(address account) external view returns (uint256) {
        return rewardToken.balanceOf(account);
    }

    function _markRewarded(address traveler, address requester, bytes32 docType) internal returns (bool) {
        bytes32 key = keccak256(abi.encode(traveler, requester, docType));
        if (rewarded[key]) return false;
        rewarded[key] = true;
        return true;
    }
}
