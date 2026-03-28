// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title StakedEndorsement
/// @notice Minimal staked endorsement contract — Layer 2 of the commitment graph.
///         Users stake USDC on recommendations (domains). An oracle resolves outcomes.
///         Winners claim proportional shares of the losing pool.
/// @dev MVP: manual/multisig resolution via owner. Production would use UMA oracle.
///
/// Flow:
///   1. stake(domain, amount)  — endorse a business by staking USDC
///   2. resolve(domain, true)  — oracle marks domain as good/bad
///   3. claim()                — winners collect proportional share of loser pool
///
/// Design choices:
///   - USDC denomination (no volatile token risk)
///   - Domain-based (maps to proof-of-commitment behavioral data)
///   - Binary resolution for MVP (mechanism design doc §2 allows continuous later)
///   - 1.5% protocol fee on resolution (per mechanism design doc §7)
contract StakedEndorsement {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────────

    struct Endorsement {
        address staker;
        bytes32 domainHash;
        uint256 amount;
        bool claimed;
    }

    enum DomainStatus {
        Open,       // accepting stakes
        Positive,   // resolved favorably — endorsers win
        Negative    // resolved unfavorably — endorsers lose
    }

    struct DomainInfo {
        DomainStatus status;
        uint256 totalStaked;       // total USDC staked on this domain
        uint256 resolvedAt;        // timestamp of resolution
        string domain;             // human-readable domain string
    }

    // ─── State ───────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public owner;

    uint256 public nextEndorsementId;
    uint256 public protocolFees;                    // accumulated protocol fees
    uint256 public constant PROTOCOL_FEE_BPS = 150; // 1.5%
    uint256 public constant MIN_STAKE = 1e6;        // 1 USDC (6 decimals)

    mapping(uint256 => Endorsement) public endorsements;
    mapping(bytes32 => DomainInfo) public domains;

    // Track total staked per domain that is winning/losing for proportional claims
    // When resolved Negative: endorsers lose their stake → goes to slash pool
    // When resolved Positive: endorsers get back stake + share of protocol rewards
    mapping(bytes32 => uint256) public slashPool;   // funds from negatively-resolved domains

    // ─── Events ──────────────────────────────────────────────────────────

    event Staked(uint256 indexed endorsementId, address indexed staker, bytes32 indexed domainHash, string domain, uint256 amount);
    event Resolved(bytes32 indexed domainHash, string domain, DomainStatus status);
    event Claimed(uint256 indexed endorsementId, address indexed staker, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);

    // ─── Errors ──────────────────────────────────────────────────────────

    error OnlyOwner();
    error DomainNotOpen();
    error DomainNotResolved();
    error AlreadyClaimed();
    error StakeTooSmall();
    error InvalidResolution();
    error NothingToClaim();
    error ZeroAddress();

    // ─── Constructor ─────────────────────────────────────────────────────

    /// @param _usdc Address of USDC token on the target chain
    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        owner = msg.sender;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ─── Core Functions ──────────────────────────────────────────────────

    /// @notice Stake USDC endorsing a domain (business).
    /// @param domain Human-readable domain string (e.g., "peppes-pizza.no")
    /// @param amount Amount of USDC to stake (6 decimals)
    /// @return endorsementId The ID of the new endorsement
    function stake(string calldata domain, uint256 amount) external returns (uint256 endorsementId) {
        if (amount < MIN_STAKE) revert StakeTooSmall();

        bytes32 domainHash = keccak256(abi.encodePacked(domain));

        // Initialize domain if first stake
        if (bytes(domains[domainHash].domain).length == 0) {
            domains[domainHash].domain = domain;
        }

        if (domains[domainHash].status != DomainStatus.Open) revert DomainNotOpen();

        // Transfer USDC from staker to contract
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Record endorsement
        endorsementId = nextEndorsementId++;
        endorsements[endorsementId] = Endorsement({
            staker: msg.sender,
            domainHash: domainHash,
            amount: amount,
            claimed: false
        });

        domains[domainHash].totalStaked += amount;

        emit Staked(endorsementId, msg.sender, domainHash, domain, amount);
    }

    /// @notice Resolve a domain's endorsements. Oracle (owner for MVP) decides outcome.
    /// @param domain The domain to resolve
    /// @param positive True if the domain is endorsed positively (stakers win)
    function resolve(string calldata domain, bool positive) external onlyOwner {
        bytes32 domainHash = keccak256(abi.encodePacked(domain));
        DomainInfo storage info = domains[domainHash];

        if (info.status != DomainStatus.Open) revert DomainNotOpen();
        if (info.totalStaked == 0) revert InvalidResolution();

        if (positive) {
            info.status = DomainStatus.Positive;
        } else {
            info.status = DomainStatus.Negative;
            // Slashed funds go to slash pool (minus protocol fee)
            uint256 fee = (info.totalStaked * PROTOCOL_FEE_BPS) / 10000;
            protocolFees += fee;
            slashPool[domainHash] = info.totalStaked - fee;
        }

        info.resolvedAt = block.timestamp;

        emit Resolved(domainHash, domain, info.status);
    }

    /// @notice Claim returns for a positively-resolved endorsement.
    ///         Winners get their original stake back (minus protocol fee).
    /// @param endorsementId The endorsement to claim
    function claim(uint256 endorsementId) external {
        Endorsement storage e = endorsements[endorsementId];
        if (e.claimed) revert AlreadyClaimed();
        if (e.staker != msg.sender) revert NothingToClaim();

        DomainInfo storage info = domains[e.domainHash];
        if (info.status == DomainStatus.Open) revert DomainNotResolved();

        e.claimed = true;

        if (info.status == DomainStatus.Positive) {
            // Winner: get stake back minus protocol fee
            uint256 fee = (e.amount * PROTOCOL_FEE_BPS) / 10000;
            protocolFees += fee;
            uint256 payout = e.amount - fee;
            usdc.safeTransfer(e.staker, payout);
            emit Claimed(endorsementId, e.staker, payout);
        } else {
            // Negative resolution: staker loses their stake (already in slash pool)
            // Emit zero-amount claim for tracking
            emit Claimed(endorsementId, e.staker, 0);
        }
    }

    // ─── View Functions ──────────────────────────────────────────────────

    /// @notice Get domain info by domain string
    function getDomain(string calldata domain) external view returns (DomainInfo memory) {
        return domains[keccak256(abi.encodePacked(domain))];
    }

    /// @notice Get endorsement details
    function getEndorsement(uint256 endorsementId) external view returns (Endorsement memory) {
        return endorsements[endorsementId];
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /// @notice Withdraw accumulated protocol fees
    function withdrawFees(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = protocolFees;
        protocolFees = 0;
        usdc.safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    /// @notice Redistribute slash pool from a negatively-resolved domain
    ///         In production, this would go to successful disputers / insurance.
    ///         For MVP, owner can withdraw slashed funds.
    function withdrawSlashPool(string calldata domain, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        bytes32 domainHash = keccak256(abi.encodePacked(domain));
        DomainInfo storage info = domains[domainHash];
        if (info.status != DomainStatus.Negative) revert InvalidResolution();

        uint256 amount = slashPool[domainHash];
        slashPool[domainHash] = 0;
        usdc.safeTransfer(to, amount);
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
