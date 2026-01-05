/*
Project : SertiChain (Platform Blockchain untuk Sertifikasi dan Verifikasi Kegiatan Mahasiswa)
No : 9
Kelompok:
- 23523170 Danendra Farrel Adriansyah
- 23523187 Zulpadli Syarif Harahap
- 23523211 Muhammad Dzaki Adibtyo
- 23523230 Vivi Zalzabilah Zl
*/




// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CertificateChain {

    address public admin;
    uint256 public totalCertificates;

    constructor() {
        admin = msg.sender;
    }

    enum CertStatus { ACTIVE, REVOKED }

    struct Certificate {
        address owner;
        address issuer;
        uint256 issuedAt;
        CertStatus status;
        bytes32 metadataHash;
        uint8 category;
    }

    struct Organization {
        bool active;
        uint256 issuedCount;
    }

    mapping(uint256 => Certificate) public certificates;
    mapping(address => Organization) public organizations;

    /* ================= ADMIN ================= */

    function verifyOrganization(address org) external {
        require(msg.sender == admin, "Only admin");
        organizations[org].active = true;
    }

    /* ================= ORGANIZATION ================= */

    function issueCertificate(
        address owner,
        bytes32 metadataHash,
        uint8 category
    ) external {
        require(organizations[msg.sender].active, "Org not verified");

        certificates[totalCertificates] = Certificate({
            owner: owner,
            issuer: msg.sender,
            issuedAt: block.timestamp,
            status: CertStatus.ACTIVE,
            metadataHash: metadataHash,
            category: category
        });

        organizations[msg.sender].issuedCount++;
        totalCertificates++;
    }

    function revokeCertificate(uint256 certId) external {
        Certificate storage cert = certificates[certId];
        require(msg.sender == cert.issuer, "Not issuer");
        cert.status = CertStatus.REVOKED;
    }

    /* ================= PUBLIC ================= */

    function verifyCertificate(uint256 certId)
        external
        view
        returns (
            address owner,
            address issuer,
            CertStatus status,
            bytes32 metadataHash
        )
    {
        Certificate memory cert = certificates[certId];
        return (cert.owner, cert.issuer, cert.status, cert.metadataHash);
    }
}
