import hre from "hardhat";
import { JsonRpcProvider } from "ethers";
import { writeFile } from "fs/promises";

async function main() {
  // Prefer Hardhat's ethers plugin if available
  if (hre.ethers && typeof hre.ethers.getContractFactory === "function") {
    const Contract = await hre.ethers.getContractFactory("smartContract");
    const contract = await Contract.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    // Persist the deployed address so other scripts can find it
    try {
      await writeFile(
        "backend/last_deploy.json",
        JSON.stringify(
          {
            address,
            network: hre.network ? hre.network.name : undefined,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );
      console.log("Saved deployed address to backend/last_deploy.json");
    } catch (e) {
      console.warn("Warning: failed to write last_deploy.json:", e.message);
    }

    console.log("Contract deployed to:", address);
    return;
  }

  // Fallback: use JSON-RPC to send an unsigned transaction (requires unlocked local node)
  const artifact = await hre.artifacts.readArtifact("CertificateChain");

  const providerUrl =
    (hre.network && hre.network.config && hre.network.config.url) ||
    process.env.RPC_URL ||
    "http://127.0.0.1:8545";
  const provider = new JsonRpcProvider(providerUrl);

  const accounts = await provider.send("eth_accounts", []);
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts available on the JSON-RPC provider");
  }

  const txHash = await provider.send("eth_sendTransaction", [
    { from: accounts[0], data: artifact.bytecode },
  ]);

  const receipt = await provider.waitForTransaction(txHash);
  const address = receipt.contractAddress;

  try {
    await writeFile(
      "backend/last_deploy.json",
      JSON.stringify(
        {
          address,
          network: hre.network ? hre.network.name : undefined,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log("Saved deployed address to backend/last_deploy.json");
  } catch (e) {
    console.warn("Warning: failed to write last_deploy.json:", e.message);
  }

  console.log("Contract deployed to:", address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
