# TravelChain: Travel Document Sharing on Ethereum

TravelChain is a blockchain project for sharing travel documents in a
controlled and verifiable way. The main idea is that travelers keep
their actual documents off-chain and only store document hashes on
Ethereum.

A traveler can give an airline, hotel, travel agency, or border control
temporary access to a document. The consent can be revoked at any time.
Every successful and denied access attempt is logged on-chain, and
travelers receive TRVL tokens when they share a document with a new
requester.

## Team

-   Seyedamirreza Kalantarzadeh
-   Petrica Lin
-   Mohamed Mohamed Abdelhalim Saber Eldeeb
-   Julio Roxo Araujo Arruda

## How it works

A normal TravelChain flow looks like this:

1.  A traveler registers an identity.
2.  The traveler stores the hash of a travel document such as a passport
    or visa.
3.  A trusted issuer can attest the document hash.
4.  The traveler gives a registered organization access for a limited
    amount of time.
5.  The traveler receives 10 TRVL tokens for a new
    traveler/requester/document combination.
6.  The organization can access the document hash while the consent is
    valid.
7.  The actual file is shared off-chain and can be checked against the
    hash stored on-chain.
8.  The traveler can revoke the consent.
9.  Any later access attempt is denied and the attempt is still recorded
    in the audit trail.

## Quick start

Install the dependencies:

``` bash
npm install
```

Compile the contracts:

``` bash
npx hardhat compile
```

Run all tests:

``` bash
npx hardhat test
```

Run the full demo:

``` bash
npx hardhat run scripts/demo.js
```

The current test suite contains 41 tests: 29 Solidity tests and 12 Node.js tests.

To deploy the contracts to a local Hardhat node:

``` bash
# Terminal 1
npx hardhat node

# Terminal 2
npx hardhat run scripts/run-deploy.js --network localhost
```

## Main roles

**Admin**\
The admin deploys the contracts, registers organizations, manages
trusted issuers, and can add supported document types.

**Traveler**\
A traveler registers their own identity, stores document hashes, grants
and revokes consent, and receives TRVL tokens for sharing.

**Organizations**\
Airlines, hotels, travel agencies, and border control are registered by
the admin. They can request a traveler's document through
`AccessDocument`.

**Issuer**\
A trusted issuer can attest a stored document hash. This makes it
possible to distinguish an issuer-attested document from a document that
was only uploaded by the traveler.

## Supported documents

The project currently supports these document types:

-   `PASSPORT`
-   `VISA`
-   `FLIGHT_BOOKING`
-   `HOTEL_BOOKING`
-   `VACCINATION_CERT`
-   `TRAVEL_INSURANCE`

The admin can add more document types when needed.

## Smart contracts

### DigitalIdentity.sol

This contract handles traveler registration, organization roles,
document hashes, document validity dates, and issuer attestations.

### ConsentManager.sol

This contract stores and checks consent. Consent must last between 1 day
and 365 days and cannot last longer than the document itself.
Consent can also be revoked before it expires.

Only `DataSharing` is allowed to create or revoke consent records.

### DataSharing.sol

This is the main contract used for sharing. It connects the identity,
consent, and reward contracts.

It is responsible for:

-   granting and revoking consent
-   rewarding travelers
-   checking access
-   returning document hashes to valid requesters
-   logging successful and denied access attempts

A denied access request does not revert because the `AccessDenied` event
needs to remain in the blockchain log.

### RewardToken.sol

`TravelShareToken` (`TRVL`) is an ERC20 token used as the reward in the
project.

A traveler receives 10 TRVL for a new sharing combination. Granting,
revoking, and granting the exact same consent again does not create
unlimited rewards. The maximum token supply is 1,000,000 TRVL, and only
`DataSharing` has the minter role during normal operation.

### interfaces/

The interface files define the functions used between the contracts.

## Privacy

The actual passport, visa, booking, or other travel file is not stored
on-chain. Only its hash is stored.

This is important because blockchain data is public. A hash should not
be treated as private just because a Solidity variable is marked
`private`. For real personal data, identity values and document
commitments should be prepared safely off-chain. Using a random salt
before hashing can also make simple guessing attacks harder.

The actual document and any salt are shared with the requester
off-chain. The requester can hash the received data and compare the
result with the value stored on-chain.

The current system also has an admin that decides which organizations
and issuers are trusted. This is a design limitation and means this part
of the system is not fully decentralized.

## Testing

The project uses Hardhat 3 with Solidity-based tests and Node.js/Viem integration tests.

The tests are split into two parts. The main contract unit tests are written
in Solidity using the Foundry testing library through Hardhat:

-   `contracts/DigitalIdentity.t.sol`
-   `contracts/ConsentManager.t.sol`
-   `contracts/DataSharing.t.sol`
-   `contracts/RewardToken.t.sol`

The Node.js/Viem tests are used for complete flows and scalability:

-   `test/Integration.test.js` - complete travel sharing flows, audit
    logging, access isolation, and reward behavior
-   `test/Scalability.test.js` - gas behavior when the amount of activity
    increases
-   `test/helpers.js` - shared deployment setup

The current suite has **41 passing tests: 29 Solidity tests and 12 Node.js tests**.

The integration tests also check important cases such as:

-   access after revocation
-   access after consent expiry
-   one requester trying to use another requester's consent
-   one document consent being used for a different document
-   an attacker trying to grant themselves access
-   batch consent for multiple travel documents
-   repeated grant/revoke attempts trying to farm reward tokens

The scalability tests print gas measurements for the main operations. A separate gas summary is also included in `gas-report.txt`.

## Demo

The demo script shows one complete example with a traveler and an
airline.

It registers the required actors, stores a passport hash, attests it,
grants 48-hour access, rewards the traveler, verifies an original and
modified file, revokes the consent, and finally shows that the next
access attempt is denied.

Run it with:

``` bash
npx hardhat run scripts/demo.js
```

## Project structure

``` text
travelchain/
├── contracts/
│   ├── ConsentManager.sol
│   ├── ConsentManager.t.sol
│   ├── DataSharing.sol
│   ├── DataSharing.t.sol
│   ├── DigitalIdentity.sol
│   ├── DigitalIdentity.t.sol
│   ├── RewardToken.sol
│   ├── RewardToken.t.sol
│   └── interfaces/
├── diagrams/
├── scripts/
│   ├── deploy.js
│   ├── run-deploy.js
│   └── demo.js
├── test/
├── .gitignore
├── gas-report.txt
├── hardhat.config.js
├── package.json
└── README.md
```

## Technology

-   Solidity 0.8.20
-   Hardhat 3
-   OpenZeppelin Contracts
-   Viem
-   Foundry testing library (`forge-std`)
-   Node.js test runner
-   ERC20

## Current limitations

This project is a prototype for the course project and is tested on the
local Hardhat network. It does not include a frontend.

The blockchain stores hashes and permissions, not the actual travel
documents. A real deployment would still need a secure way to exchange
the actual files off-chain and would need stronger production key
management and administration.
