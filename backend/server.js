import fs from "fs/promises";
import * as ethers from "ethers";

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj, null, 2));
}

async function resolveContractAddress() {
  if (process.env.CONTRACT_ADDRESS) return process.env.CONTRACT_ADDRESS;
  try {
    const raw = await fs.readFile("backend/last_deploy.json", "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.address) return parsed.address;
  } catch (_) {}
  throw new Error(
    "CONTRACT_ADDRESS not set and no backend/last_deploy.json found"
  );
}

async function handleIssue(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    const json = JSON.parse(body || "{}");

    // Accept either a wrapped metadata object (json.metadata) or flat fields (legacy)
    let metadataObject = null;

    if (
      json &&
      json.metadata &&
      typeof json.metadata === "object" &&
      json.metadata.name &&
      Array.isArray(json.metadata.attributes)
    ) {
      metadataObject = json.metadata;
    } else {
      // Legacy flat fields expected
      const required = [
        "fullname",
        "institution",
        "program",
        "activity",
        "category",
        "issuedAt",
      ];
      for (const k of required) {
        if (!json[k]) return sendJson(res, 400, { error: `${k} is required` });
      }

      metadataObject = {
        name: json.metadataName || "Blockchain Workshop Certificate",
        description:
          json.metadataDescription || "Official academic certificate",
        attributes: [
          { trait_type: "Full Name", value: json.fullname },
          { trait_type: "Institution", value: json.institution },
          { trait_type: "Program", value: json.program },
          { trait_type: "Activity", value: json.activity },
          { trait_type: "Category", value: json.category },
          { trait_type: "Issued At", value: json.issuedAt },
        ],
      };
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts || accounts.length < 1)
      return sendJson(res, 500, {
        error: "No unlocked accounts on RPC provider",
      });

    const contractAddress = await resolveContractAddress();

    const abi = [
      "function issueCertificate(address,bytes32,uint8)",
      "function totalCertificates() view returns (uint256)",
    ];

    const iface = new ethers.Interface(abi);

    // 1️⃣ Upload metadata ke IPFS
    const ipfsUrl = await uploadToIPFS(metadataObject);

    // 2️⃣ Hash URL IPFS (yang masuk blockchain)
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(ipfsUrl));

    // persist locally (store the wrapped metadata object)
    try {
      let map = {};
      try {
        const raw = await fs.readFile("backend/metadata.json", "utf8");
        map = JSON.parse(raw);
      } catch (_) {}
      map[metadataHash] = metadataObject;
      await fs.writeFile(
        "backend/metadata.json",
        JSON.stringify(map, null, 2),
        "utf8"
      );
    } catch (e) {
      // non-fatal
      console.warn("failed to persist metadata:", e.message);
    }

    // send issueCertificate using eth_sendTransaction (from second account by default)
    const from = accounts[1] || accounts[0];
    const data = iface.encodeFunctionData("issueCertificate", [
      accounts[2] || accounts[0],
      metadataHash,
      Number(1),
    ]);

    const txHash = await provider.send("eth_sendTransaction", [
      { from, to: contractAddress, data },
    ]);
    const receipt = await provider.waitForTransaction(txHash);

    // read totalCertificates, fallback to eth_call
    let total = null;
    try {
      const totalVal = await (async () => {
        // try call using eth_call
        const dataTotal = iface.encodeFunctionData("totalCertificates", []);
        const hex = await provider.send("eth_call", [
          { to: contractAddress, data: dataTotal },
          "latest",
        ]);
        const decoded = iface.decodeFunctionResult("totalCertificates", hex);
        return Number(decoded[0].toString ? decoded[0].toString() : decoded[0]);
      })();
      total = totalVal;
    } catch (_) {}

    const certId = total !== null ? Math.max(0, total - 1) : null;

    return sendJson(res, 200, {
      success: true,
      contractAddress,
      txHash,
      certId,
      ipfsUrl,
      metadataHash,
      metadata: metadataObject,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
}

import http from "http";

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    // preflight
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method === "POST" && req.url === "/issue")
    return handleIssue(req, res);

  // fallback: simple status
  sendJson(res, 200, { status: "ok", rpc: RPC_URL, port: PORT });
});

server.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);

async function uploadToIPFS(metadataObject) {
  // Use global fetch if available (Node 18+); otherwise dynamically import node-fetch
  let fetchFn = globalThis.fetch;
  if (!fetchFn) {
    const mod = await import("node-fetch");
    fetchFn = mod.default || mod;
  }

  const res = await fetchFn("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET,
    },
    body: JSON.stringify(metadataObject),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("IPFS upload failed: " + text);
  }

  const json = await res.json();
  return `ipfs://${json.IpfsHash}`;
}
  
