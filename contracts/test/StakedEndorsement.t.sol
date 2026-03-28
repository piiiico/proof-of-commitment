// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {StakedEndorsement} from "../src/StakedEndorsement.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract StakedEndorsementTest is Test {
    StakedEndorsement public se;
    MockERC20 public usdc;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    string constant DOMAIN = "peppes-pizza.no";
    string constant DOMAIN2 = "bad-restaurant.com";
    uint256 constant STAKE_AMOUNT = 10e6; // 10 USDC

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        se = new StakedEndorsement(address(usdc));

        // Fund test accounts
        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);
        usdc.mint(charlie, 1000e6);

        // Approve contract
        vm.prank(alice);
        usdc.approve(address(se), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(se), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(se), type(uint256).max);
    }

    // ─── Staking Tests ──────────────────────────────────────────────────

    function test_stake_basic() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        assertEq(id, 0);
        assertEq(usdc.balanceOf(address(se)), STAKE_AMOUNT);
        assertEq(usdc.balanceOf(alice), 1000e6 - STAKE_AMOUNT);

        StakedEndorsement.Endorsement memory e = se.getEndorsement(id);
        assertEq(e.staker, alice);
        assertEq(e.amount, STAKE_AMOUNT);
        assertFalse(e.claimed);
    }

    function test_stake_multiple_stakers() public {
        vm.prank(alice);
        uint256 id1 = se.stake(DOMAIN, STAKE_AMOUNT);

        vm.prank(bob);
        uint256 id2 = se.stake(DOMAIN, 20e6);

        assertEq(id1, 0);
        assertEq(id2, 1);

        StakedEndorsement.DomainInfo memory info = se.getDomain(DOMAIN);
        assertEq(info.totalStaked, 30e6); // 10 + 20
    }

    function test_stake_revert_too_small() public {
        vm.prank(alice);
        vm.expectRevert(StakedEndorsement.StakeTooSmall.selector);
        se.stake(DOMAIN, 0.5e6); // 0.5 USDC < 1 USDC minimum
    }

    function test_stake_revert_resolved_domain() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        vm.prank(bob);
        vm.expectRevert(StakedEndorsement.DomainNotOpen.selector);
        se.stake(DOMAIN, STAKE_AMOUNT);
    }

    function test_stake_increments_ids() public {
        vm.startPrank(alice);
        uint256 id1 = se.stake(DOMAIN, STAKE_AMOUNT);
        uint256 id2 = se.stake(DOMAIN, STAKE_AMOUNT);
        uint256 id3 = se.stake(DOMAIN2, STAKE_AMOUNT);
        vm.stopPrank();

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(id3, 2);
        assertEq(se.nextEndorsementId(), 3);
    }

    // ─── Resolution Tests ───────────────────────────────────────────────

    function test_resolve_positive() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        StakedEndorsement.DomainInfo memory info = se.getDomain(DOMAIN);
        assertEq(uint8(info.status), uint8(StakedEndorsement.DomainStatus.Positive));
        assertGt(info.resolvedAt, 0);
    }

    function test_resolve_negative() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, false);

        StakedEndorsement.DomainInfo memory info = se.getDomain(DOMAIN);
        assertEq(uint8(info.status), uint8(StakedEndorsement.DomainStatus.Negative));

        // Check slash pool: totalStaked - 1.5% fee
        uint256 expectedFee = (STAKE_AMOUNT * 150) / 10000;
        uint256 expectedSlash = STAKE_AMOUNT - expectedFee;
        assertEq(se.slashPool(keccak256(abi.encodePacked(DOMAIN))), expectedSlash);
        assertEq(se.protocolFees(), expectedFee);
    }

    function test_resolve_revert_not_owner() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(StakedEndorsement.OnlyOwner.selector);
        se.resolve(DOMAIN, true);
    }

    function test_resolve_revert_already_resolved() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        vm.expectRevert(StakedEndorsement.DomainNotOpen.selector);
        se.resolve(DOMAIN, false);
    }

    function test_resolve_revert_no_stakes() public {
        vm.expectRevert(StakedEndorsement.InvalidResolution.selector);
        se.resolve(DOMAIN, true);
    }

    // ─── Claim Tests ────────────────────────────────────────────────────

    function test_claim_positive_resolution() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        uint256 balanceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        se.claim(id);

        uint256 balanceAfter = usdc.balanceOf(alice);
        uint256 fee = (STAKE_AMOUNT * 150) / 10000;
        uint256 expectedPayout = STAKE_AMOUNT - fee;

        assertEq(balanceAfter - balanceBefore, expectedPayout);
        assertTrue(se.getEndorsement(id).claimed);
    }

    function test_claim_negative_resolution_loses_stake() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, false);

        uint256 balanceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        se.claim(id);

        // Alice gets nothing back
        assertEq(usdc.balanceOf(alice), balanceBefore);
        assertTrue(se.getEndorsement(id).claimed);
    }

    function test_claim_revert_not_staker() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        vm.prank(bob);
        vm.expectRevert(StakedEndorsement.NothingToClaim.selector);
        se.claim(id);
    }

    function test_claim_revert_double_claim() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        vm.startPrank(alice);
        se.claim(id);
        vm.expectRevert(StakedEndorsement.AlreadyClaimed.selector);
        se.claim(id);
        vm.stopPrank();
    }

    function test_claim_revert_not_resolved() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(StakedEndorsement.DomainNotResolved.selector);
        se.claim(id);
    }

    // ─── Multi-User Scenario ────────────────────────────────────────────

    function test_full_scenario_positive() public {
        // Alice stakes 10 USDC, Bob stakes 20 USDC on same domain
        vm.prank(alice);
        uint256 id1 = se.stake(DOMAIN, 10e6);

        vm.prank(bob);
        uint256 id2 = se.stake(DOMAIN, 20e6);

        // Oracle resolves positively
        se.resolve(DOMAIN, true);

        // Both claim
        vm.prank(alice);
        se.claim(id1);

        vm.prank(bob);
        se.claim(id2);

        // Alice: 10 USDC - 1.5% = 9.85 USDC returned
        uint256 aliceFee = (10e6 * 150) / 10000;
        assertEq(usdc.balanceOf(alice), 1000e6 - 10e6 + (10e6 - aliceFee));

        // Bob: 20 USDC - 1.5% = 19.70 USDC returned
        uint256 bobFee = (20e6 * 150) / 10000;
        assertEq(usdc.balanceOf(bob), 1000e6 - 20e6 + (20e6 - bobFee));

        // Protocol fees accumulated
        assertEq(se.protocolFees(), aliceFee + bobFee);
    }

    function test_full_scenario_negative() public {
        // Three stakers on a bad domain
        vm.prank(alice);
        uint256 id1 = se.stake(DOMAIN2, 10e6);

        vm.prank(bob);
        uint256 id2 = se.stake(DOMAIN2, 20e6);

        vm.prank(charlie);
        uint256 id3 = se.stake(DOMAIN2, 5e6);

        // Oracle resolves negatively — total 35 USDC slashed
        se.resolve(DOMAIN2, false);

        uint256 totalSlashed = 35e6;
        uint256 fee = (totalSlashed * 150) / 10000;
        uint256 expectedSlashPool = totalSlashed - fee;

        assertEq(se.protocolFees(), fee);
        assertEq(se.slashPool(keccak256(abi.encodePacked(DOMAIN2))), expectedSlashPool);

        // Stakers claim — get nothing
        vm.prank(alice);
        se.claim(id1);
        vm.prank(bob);
        se.claim(id2);
        vm.prank(charlie);
        se.claim(id3);

        // Balances unchanged after claim (already lost at stake time)
        assertEq(usdc.balanceOf(alice), 1000e6 - 10e6);
        assertEq(usdc.balanceOf(bob), 1000e6 - 20e6);
        assertEq(usdc.balanceOf(charlie), 1000e6 - 5e6);
    }

    // ─── Admin Tests ────────────────────────────────────────────────────

    function test_withdraw_fees() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, true);

        vm.prank(alice);
        se.claim(0);

        uint256 fees = se.protocolFees();
        assertGt(fees, 0);

        address treasury = makeAddr("treasury");
        se.withdrawFees(treasury);

        assertEq(usdc.balanceOf(treasury), fees);
        assertEq(se.protocolFees(), 0);
    }

    function test_withdraw_slash_pool() public {
        vm.prank(alice);
        se.stake(DOMAIN, STAKE_AMOUNT);

        se.resolve(DOMAIN, false);

        bytes32 domainHash = keccak256(abi.encodePacked(DOMAIN));
        uint256 slashAmount = se.slashPool(domainHash);
        assertGt(slashAmount, 0);

        address treasury = makeAddr("treasury");
        se.withdrawSlashPool(DOMAIN, treasury);

        assertEq(usdc.balanceOf(treasury), slashAmount);
        assertEq(se.slashPool(domainHash), 0);
    }

    function test_transfer_ownership() public {
        address newOwner = makeAddr("newOwner");
        se.transferOwnership(newOwner);
        assertEq(se.owner(), newOwner);
    }

    function test_transfer_ownership_revert_not_owner() public {
        vm.prank(alice);
        vm.expectRevert(StakedEndorsement.OnlyOwner.selector);
        se.transferOwnership(alice);
    }

    // ─── Protocol Fee Calculation ───────────────────────────────────────

    function test_protocol_fee_calculation() public {
        // 1.5% of 100 USDC = 1.5 USDC
        vm.prank(alice);
        se.stake(DOMAIN, 100e6);

        se.resolve(DOMAIN, true);

        vm.prank(alice);
        se.claim(0);

        assertEq(se.protocolFees(), 1_500_000); // 1.5 USDC in 6-decimal
    }

    // ─── Edge Cases ─────────────────────────────────────────────────────

    function test_minimum_stake() public {
        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, 1e6); // exactly 1 USDC

        StakedEndorsement.Endorsement memory e = se.getEndorsement(id);
        assertEq(e.amount, 1e6);
    }

    function test_constructor_revert_zero_usdc() public {
        vm.expectRevert(StakedEndorsement.ZeroAddress.selector);
        new StakedEndorsement(address(0));
    }

    function test_multiple_domains_independent() public {
        // Stake on two different domains
        vm.prank(alice);
        se.stake(DOMAIN, 10e6);

        vm.prank(bob);
        se.stake(DOMAIN2, 20e6);

        // Resolve one positive, one negative
        se.resolve(DOMAIN, true);
        se.resolve(DOMAIN2, false);

        StakedEndorsement.DomainInfo memory info1 = se.getDomain(DOMAIN);
        StakedEndorsement.DomainInfo memory info2 = se.getDomain(DOMAIN2);

        assertEq(uint8(info1.status), uint8(StakedEndorsement.DomainStatus.Positive));
        assertEq(uint8(info2.status), uint8(StakedEndorsement.DomainStatus.Negative));
    }

    // ─── Fuzz Tests ─────────────────────────────────────────────────────

    function testFuzz_stake_amount(uint256 amount) public {
        amount = bound(amount, 1e6, 1000e6); // between 1 and 1000 USDC

        vm.prank(alice);
        uint256 id = se.stake(DOMAIN, amount);

        assertEq(se.getEndorsement(id).amount, amount);
        assertEq(usdc.balanceOf(address(se)), amount);
    }

    function testFuzz_protocol_fee_never_exceeds_stake(uint256 amount) public {
        amount = bound(amount, 1e6, 1000e6);

        vm.prank(alice);
        se.stake(DOMAIN, amount);

        se.resolve(DOMAIN, true);

        vm.prank(alice);
        se.claim(0);

        uint256 fees = se.protocolFees();
        assertLt(fees, amount);
        assertEq(fees, (amount * 150) / 10000);
    }
}
