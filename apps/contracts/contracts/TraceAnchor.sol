// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TraceAnchor {
    event TraceAnchored(address indexed agent, bytes32 hash, string cid, uint256 timestamp);

    function anchor(address agent, bytes32 hash, string calldata cid) external {
        emit TraceAnchored(agent, hash, cid, block.timestamp);
    }
}
