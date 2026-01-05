import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const signer = await provider.getSigner();

const contractAddress = "0xYourContractAddress";
const abi = [
  "function issueCertificate(address,bytes32,uint8)",
  "function verifyCertificate(uint256) view returns(address,address,uint8,bytes32)",
];

const contract = new ethers.Contract(contractAddress, abi, signer);

// Issue certificate
await contract.issueCertificate(
  "0xStudentWallet",
  ethers.keccak256(ethers.toUtf8Bytes("ipfs://metadata.json")),
  1
);

// Verify certificate
const cert = await contract.verifyCertificate(0);
console.log(cert);
