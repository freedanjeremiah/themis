// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IThemisRegistryView {
    function stats(address agent) external view returns (uint64, uint64, int128, bool);
}

contract TraceAnchor {
    IThemisRegistryView public immutable registry;

    event TraceAnchored(address indexed agent, bytes32 hash, string cid, uint256 timestamp);

    constructor(address _registry) {
        registry = IThemisRegistryView(_registry);
    }

    function anchor(bytes32 hash, string calldata cid) external {
        (, , , bool active) = registry.stats(msg.sender);
        require(active, "not registered agent");
        emit TraceAnchored(msg.sender, hash, cid, block.timestamp);
    }
}
