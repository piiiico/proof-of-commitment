// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {StakedEndorsement} from "../src/StakedEndorsement.sol";

/// @notice Deploy StakedEndorsement to Base Sepolia or Base mainnet.
///
/// Usage:
///   # Base Sepolia (testnet)
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
///
///   # Base mainnet
///   forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
///
/// USDC addresses:
///   Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
///   Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
contract DeployStakedEndorsement is Script {
    // USDC on Base Sepolia (Circle faucet)
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    // USDC on Base mainnet
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        // Determine which USDC address to use based on chain ID
        uint256 chainId = block.chainid;
        address usdcAddress;

        if (chainId == 84532) {
            // Base Sepolia
            usdcAddress = USDC_BASE_SEPOLIA;
            console2.log("Deploying to Base Sepolia");
        } else if (chainId == 8453) {
            // Base mainnet
            usdcAddress = USDC_BASE;
            console2.log("Deploying to Base mainnet");
        } else {
            revert("Unsupported chain. Use Base Sepolia (84532) or Base (8453).");
        }

        console2.log("USDC address:", usdcAddress);

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        StakedEndorsement se = new StakedEndorsement(usdcAddress);
        console2.log("StakedEndorsement deployed at:", address(se));

        vm.stopBroadcast();
    }
}
