pragma solidity ^0.8.28;

contract VulnerableRefund {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function refund(uint256) external {
        uint256 amount = balances[msg.sender];
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent);
        balances[msg.sender] = 0;
    }
}
