# TravelChain: Travel Document Sharing on Ethereum

Remodel of the EduChain credential-sharing project into a travel identity & document platform.

Travelers store **hashes** of their travel documents (passport, visa, bookings...) on-chain.
Trusted issuers can **attest** those hashes. Travelers give airlines, hotels, agencies or border
control **time-limited, revocable consent** and earn **TRVL** tokens for sharing. Every access
attempt (granted *and* denied) is logged on-chain.

## Quick start

```bash
npm install
npx hardhat compile
npx hardhat test                 # 68 tests, writes gas-report.txt
npx hardhat run scripts/demo.js  # full story in the terminal
```

Deploy to a local node:
```bash
npx hardhat node                                        # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
```

## Actors

| Role | How they get it | What they do |
|---|---|---|
| Admin | deploys the contracts | registers organizations, manages issuers and doc types |
| Traveler | `RegisterTraveler` (self) | stores documents, grants/revokes consent, earns TRVL |
| Airline / Hotel / TravelAgency / BorderControl | `RegisterOrganization` (admin only) | request documents with `AccessDocument` |
| Issuer | `SetIssuer` (admin only) | `AttestDocument`: vouch that a stored hash is genuine |

Document types: `PASSPORT`, `VISA`, `FLIGHT_BOOKING`, `HOTEL_BOOKING`, `VACCINATION_CERT`,
`TRAVEL_INSURANCE` (admin can add more). On-chain they are `keccak256("PASSPORT")` etc.

## Contracts

- **DigitalIdentity**: roles, document hashes with validity dates, issuer attestations.
- **ConsentManager**: consent records (1 hour to 30 days, never longer than the document is valid).
  Only DataSharing can modify consents.
- **DataSharing**: entry point. Grant/revoke consent, reward tokens, access documents, audit events.
- **RewardToken**: ERC20 `TravelShareToken` (TRVL), capped at 1M, only DataSharing can mint.
- **interfaces/**: the agreed API between contracts. Change these only as a team.

## Changes vs. EduChain (and why)

| Problem in EduChain | Fix in TravelChain |
|---|---|
| `ConsentManager.SetConsent` had no caller check: anyone could grant themselves access to anyone's credential | `onlyDataSharing` modifier; DataSharing always uses `msg.sender` as the owner |
| Credentials were self-uploaded, so a match only proved "same file the student uploaded" | Issuer attestation; `AccessDocument` returns `attested` |
| `AccessDenied` was emitted and then reverted, so denials were never actually logged | Denials return `found = false` instead of reverting, so the event persists |
| Grant/revoke/grant minted unlimited tokens | Reward only once per (traveler, requester, docType) + supply cap |
| Everyone registered the same way; anyone could act as an "employer" | Role enum; organizations are registered by the admin |
| No document expiry | `validUntil` on documents; access denied with `DocumentExpired` |
| Unused `revoked` flag, 4-slot consent struct | 1-slot struct, existence = `expiry != 0` |
| README claimed ReentrancyGuard (not used) | Claim removed; external calls only go to our own trusted contracts |

## Privacy notes and limitations

- **Everything on-chain is public**, including `private` variables and the document hash itself.
  The consent check controls *who gets logged as a legitimate requester*; it cannot hide data that
  is already public. That's why the document hash should be a **salted commitment**:
  `hash(file + randomSalt)`. The traveler sends file + salt to the requester off-chain. Without the
  salt, the public hash reveals nothing and can't be matched against guessed data.
- Identity hashes (`idHash`, `contactHash`) should be salted off-chain for the same reason: emails and
  ID numbers are easy to brute-force.
- The admin is a central point of trust (vets organizations and issuers). A DAO or multisig would
  decentralize that.
- Return values of `AccessDocument` aren't visible to a wallet when sent as a transaction; apps read
  the `AccessGranted` event from the receipt.

## Tests

| File | Covers |
|---|---|
| DigitalIdentity.test.js | registration, roles, documents, attestation |
| ConsentManager.test.js | access control fix, durations, doc expiry limit, revoke |
| DataSharing.test.js | rewards + anti-farming, access, audit events |
| RewardToken.test.js | ERC20 basics, minter role, supply cap |
| Integration.test.js | full journeys, isolation between travelers/requesters/docs, attack attempt |
| Scalability.test.js | O(1) gas per operation |

## Stack

Solidity 0.8.20, Hardhat, OpenZeppelin 5, ethers v6, Chai.
