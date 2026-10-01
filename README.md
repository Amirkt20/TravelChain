# TravelChain: Travel Document Sharing on Ethereum

A decentralized travel identity and document-sharing platform built on
Ethereum.

Travelers store **hashes** of their travel documents (passport, visa,
bookings...) on-chain. Trusted issuers can **attest** those hashes.
Travelers give airlines, hotels, agencies or border control
**time-limited, revocable consent** and earn **TRVL** tokens for
sharing. Every access attempt (granted *and* denied) is logged on-chain.

## Team

-   Seyedamirreza Kalantarzadeh
-   Petrica Lin
-   Mohamed Mohamed Abdelhalim Saber Eldeeb
-   Julio Roxo Araujo Arruda

## Quick start

``` bash
npm install
npx hardhat compile
npx hardhat test                 # 68 tests, writes gas-report.txt
npx hardhat run scripts/demo.js  # full story in the terminal
```

Deploy to a local node:

``` bash
npx hardhat node                                        # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
```

## Actors

  ------------------------------------------------------------------------
  Role                    How they get it          What they do
  ----------------------- ------------------------ -----------------------
  Admin                   deploys the contracts    registers
                                                   organizations, manages
                                                   issuers and doc types

  Traveler                `RegisterTraveler`       stores documents,
                          (self)                   grants/revokes consent,
                                                   earns TRVL

  Airline / Hotel /       `RegisterOrganization`   request documents with
  TravelAgency /          (admin only)             `AccessDocument`
  BorderControl                                    

  Issuer                  `SetIssuer` (admin only) `AttestDocument`: vouch
                                                   that a stored hash is
                                                   genuine
  ------------------------------------------------------------------------

Document types: `PASSPORT`, `VISA`, `FLIGHT_BOOKING`, `HOTEL_BOOKING`,
`VACCINATION_CERT`, `TRAVEL_INSURANCE` (admin can add more). On-chain
they are `keccak256("PASSPORT")` etc.

## Contracts

-   **DigitalIdentity**: roles, document hashes with validity dates,
    issuer attestations.
-   **ConsentManager**: consent records (1 hour to 30 days, never longer
    than the document is valid). Only DataSharing can modify consents.
-   **DataSharing**: entry point. Grant/revoke consent, reward tokens,
    access documents, audit events.
-   **RewardToken**: ERC20 `TravelShareToken` (TRVL), capped at 1M, only
    DataSharing can mint.
-   **interfaces/**: the agreed API between contracts. Change these only
    as a team.

## Changes vs. EduChain (and why)

  -----------------------------------------------------------------------
  Problem in EduChain                 Fix in TravelChain
  ----------------------------------- -----------------------------------
  `ConsentManager.SetConsent` had no  `onlyDataSharing` modifier;
  caller check: anyone could grant    DataSharing always uses
  themselves access to anyone's       `msg.sender` as the owner
  credential                          

  Credentials were self-uploaded, so  Issuer attestation;
  a match only proved "same file the  `AccessDocument` returns `attested`
  student uploaded"                   

  `AccessDenied` was emitted and then Denials return `found = false`
  reverted, so denials were never     instead of reverting, so the event
  actually logged                     persists

  Grant/revoke/grant minted unlimited Reward only once per (traveler,
  tokens                              requester, docType) + supply cap

  Everyone registered the same way;   Role enum; organizations are
  anyone could act as an "employer"   registered by the admin

  No document expiry                  `validUntil` on documents; access
                                      denied with `DocumentExpired`

  Unused `revoked` flag, 4-slot       1-slot struct, existence =
  consent struct                      `expiry != 0`

  README claimed ReentrancyGuard (not Claim removed; external calls only
  used)                               go to our own trusted contracts
  -----------------------------------------------------------------------

## Privacy notes and limitations

-   **Everything on-chain is public**, including `private` variables and
    the document hash itself. The consent check controls *who gets
    logged as a legitimate requester*; it cannot hide data that is
    already public. That's why the document hash should be a **salted
    commitment**: `hash(file + randomSalt)`. The traveler sends file +
    salt to the requester off-chain. Without the salt, the public hash
    reveals nothing and can't be matched against guessed data.
-   Identity hashes (`idHash`, `contactHash`) should be salted off-chain
    for the same reason: emails and ID numbers are easy to brute-force.
-   The admin is a central point of trust (vets organizations and
    issuers). A DAO or multisig would decentralize that.
-   Return values of `AccessDocument` aren't visible to a wallet when
    sent as a transaction; apps read the `AccessGranted` event from the
    receipt.

## Tests

  -----------------------------------------------------------------------
  File                                Covers
  ----------------------------------- -----------------------------------
  DigitalIdentity.test.js             registration, roles, documents,
                                      attestation

  ConsentManager.test.js              access control fix, durations, doc
                                      expiry limit, revoke

  DataSharing.test.js                 rewards + anti-farming, access,
                                      audit events

  RewardToken.test.js                 ERC20 basics, minter role, supply
                                      cap

  Integration.test.js                 full journeys, isolation between
                                      travelers/requesters/docs, attack
                                      attempt

  Scalability.test.js                 O(1) gas per operation
  -----------------------------------------------------------------------

## Stack

Solidity 0.8.20, Hardhat, OpenZeppelin 5, ethers v6, Chai.
