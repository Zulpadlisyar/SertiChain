import hre from "hardhat";

async function main() {
  console.log("HRE keys:", Object.keys(hre));
  console.log(
    "hre.ethers:",
    typeof hre.ethers,
    hre.ethers ? Object.keys(hre.ethers) : hre.ethers
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
