import hre from "hardhat";
import * as ethers from "ethers";
import fs from "fs/promises";

async function main() {
  // Provider (prefer HRE's network URL when available)
  const providerUrl =
    (hre.network && hre.network.config && hre.network.config.url) ||
    process.env.RPC_URL ||
    "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(providerUrl);

  // Use JSON-RPC accounts (requires unlocked provider such as Hardhat node)
  const accounts = await provider.send("eth_accounts", []);
  if (!accounts || accounts.length < 1) {
    throw new Error(
      "No accounts available from the provider at " + providerUrl
    );
  }

  // Build signers
  const admin = provider.getSigner(accounts[0]);
  const org = provider.getSigner(accounts[1] || accounts[0]);
  const student = provider.getSigner(accounts[2] || accounts[0]);

  // Resolve contract address: env var takes precedence, then backend/last_deploy.json
  let contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    try {
      const raw = await fs.readFile("backend/last_deploy.json", "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.address) {
        contractAddress = parsed.address;
        console.log(
          "Using contract address from backend/last_deploy.json:",
          contractAddress
        );
      }
    } catch (e) {
      // ignore; we'll error below if nothing found
    }
  }

  if (!contractAddress) {
    throw new Error(
      "Set CONTRACT_ADDRESS environment variable or have a valid backend/last_deploy.json file created by the deploy script"
    );
  }

  const abi = [
    "function verifyOrganization(address)",
    "function issueCertificate(address,bytes32,uint8)",
    "function verifyCertificate(uint256) view returns(address,address,uint8,bytes32)",
    "function totalCertificates() view returns (uint256)",
  ];

  const contract = new ethers.Contract(contractAddress, abi, admin);

  // helper to send transaction: try direct contract call, fallback to eth_sendTransaction if runner doesn't support it
  async function sendTx(fromAddress, methodName, args) {
    try {
      // Try invoking through ethers Contract (if signer/runner supports it)
      const tx = await contract[methodName](...args);
      if (tx && tx.wait) {
        await tx.wait();
      }
      return tx;
    } catch (e) {
      // Fallback: encode and send raw transaction through JSON-RPC
      const iface = new ethers.Interface(abi);
      const data = iface.encodeFunctionData(methodName, args);
      const txHash = await provider.send("eth_sendTransaction", [
        { from: fromAddress, to: contractAddress, data },
      ]);
      const receipt = await provider.waitForTransaction(txHash);
      return receipt;
    }
  }

  // 1️⃣ Admin verifikasi organisasi (use raw addresses from eth_accounts)
  await sendTx(accounts[0], "verifyOrganization", [accounts[1] || accounts[0]]);

  // 2️⃣ Organisasi menerbitkan sertifikat
  // Prepare metadata JSON to attach to the certificate
  const metadataObject = {
    fullname: "Zulpadli Harahap",
    institution: "Universitas Islam Indonesia",
    program: "Informatika",
    activity: "Blockchain Workshop",
    category: "Seminar",
    issuedAt: "2026-01-05",
  };
  const metadataString = JSON.stringify(metadataObject);
  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadataString));

  // Persist metadata mapping locally so we can resolve it later
  try {
    let metaMap = {};
    try {
      const raw = await fs.readFile("backend/metadata.json", "utf8");
      metaMap = JSON.parse(raw);
    } catch (_) {}
    metaMap[metadataHash] = metadataObject;
    await fs.writeFile(
      "backend/metadata.json",
      JSON.stringify(metaMap, null, 2),
      "utf8"
    );
    console.log("Saved metadata locally to backend/metadata.json");
  } catch (e) {
    console.warn("Failed to persist metadata:", e.message);
  }

  const issueResult = await sendTx(
    accounts[1] || accounts[0],
    "issueCertificate",
    [accounts[2] || accounts[0], metadataHash, 1]
  );
  // Inspect totalCertificates to confirm issuance
  let totalNum = null;
  try {
    const t = await contract.totalCertificates();
    totalNum = Number(t.toString ? t.toString() : t);
  } catch (e) {
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData("totalCertificates", []);
    const hex = await provider.send("eth_call", [
      { to: contractAddress, data },
      "latest",
    ]);
    const decodedTotal = iface.decodeFunctionResult("totalCertificates", hex);
    totalNum = Number(
      decodedTotal[0].toString ? decodedTotal[0].toString() : decodedTotal[0]
    );
  }
  console.log("totalCertificates after issue:", totalNum);
  console.log("sendTx result:", issueResult);
  // Debug: inspect tx input to confirm issued metadata
  try {
    if (issueResult && issueResult.hash) {
      const txData = await provider.getTransaction(issueResult.hash);
      try {
        const iface = new ethers.Interface(abi);
        const decoded = iface.decodeFunctionData(
          "issueCertificate",
          txData.data
        );
        console.log("issued args:", decoded);
      } catch (_) {
        console.log("Could not decode tx input");
      }
    }
  } catch (_) {}

  // 3️⃣ Perusahaan verifikasi sertifikat (read-only)
  // Find the most recently issued certificate id (totalCertificates - 1)
  let certId = 0;
  try {
    let totalNum = null;

    if (contract.totalCertificates) {
      try {
        const total = await contract.totalCertificates();
        totalNum = Number(total.toString ? total.toString() : total);
      } catch (innerErr) {
        // fall through to eth_call fallback
      }
    }

    if (totalNum === null) {
      const iface = new ethers.Interface(abi);
      const data = iface.encodeFunctionData("totalCertificates", []);
      const hex = await provider.send("eth_call", [
        { to: contractAddress, data },
        "latest",
      ]);
      const decodedTotal = iface.decodeFunctionResult("totalCertificates", hex);
      totalNum = Number(
        decodedTotal[0].toString ? decodedTotal[0].toString() : decodedTotal[0]
      );
    }

    certId = Math.max(0, totalNum - 1);
  } catch (err) {
    console.warn(
      "Failed to determine certId via totalCertificates:",
      err && err.message ? err.message : err
    );
    certId = 0;
  }

  // Now read that certificate and resolve metadata
  try {
    console.log("Reading certificate id:", certId);
    const cert = await contract.verifyCertificate(certId);
    const metadataHash = cert[3];
    let metadata = null;
    try {
      const raw = await fs.readFile("backend/metadata.json", "utf8");
      const map = JSON.parse(raw);
      metadata = map[metadataHash] || map[metadataHash.toLowerCase()];
    } catch (_) {}

    if (metadata) {
      console.log(metadata);
    } else {
      console.log(cert);
    }

    // Also compare direct eth_call decode
    try {
      const iface2 = new ethers.Interface(abi);
      const data2 = iface2.encodeFunctionData("verifyCertificate", [certId]);
      const hex2 = await provider.send("eth_call", [
        { to: contractAddress, data: data2 },
        "latest",
      ]);
      const decodedCall = iface2.decodeFunctionResult(
        "verifyCertificate",
        hex2
      );
      console.log("eth_call decoded:", decodedCall);
    } catch (_) {}
  } catch (e) {
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData("verifyCertificate", [certId]);
    const hex = await provider.send("eth_call", [
      { to: contractAddress, data },
      "latest",
    ]);
    const decoded = iface.decodeFunctionResult("verifyCertificate", hex);
    const metadataHash = decoded[3];

    let metadata = null;
    try {
      const raw = await fs.readFile("backend/metadata.json", "utf8");
      const map = JSON.parse(raw);
      metadata = map[metadataHash] || map[metadataHash.toLowerCase()];
    } catch (_) {}

    if (metadata) {
      console.log(metadata);
    } else {
      console.log(decoded);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
