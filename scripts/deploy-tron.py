"""Deploy escrow v2 to Tron (spec 007 T705, docs/decisions/010-usdt-tron.md), built with Tron's own solc.

    .venv/bin/python scripts/deploy-tron.py 728126428                   mainnet, Tether's USDT, 007's numbers
    .venv/bin/python scripts/deploy-tron.py 3448148188 end-to-end       Nile, Tether's test USDT, rules in minutes
    .venv/bin/python scripts/deploy-tron.py 3448148188 end-to-end-blocked
                                                                        Nile, our blocking test token, in minutes

Keys come from ~/.vaticeno-keys/<chain id>/ (scripts/make-v2-wallets.py) and are never printed. The caller pays all
of a call's energy (`consume_user_resource_percent` 100), and the deployed bytecode is checked against the build.
TRON_SOLC names the compiler; it must report 0.8.28, the version the contract pins.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from eth_abi import encode
from eth_account import Account
from tronpy import Tron
from tronpy.contract import Contract
from tronpy.keys import PrivateKey, to_base58check_address, to_hex_address

ROOT = Path(__file__).resolve().parents[1]
SOLC = os.environ.get("TRON_SOLC", str(Path.home() / ".vaticeno-tools/tron-solc-0.8.28/solc-static-linux"))
NETWORKS = {"728126428": "mainnet", "3448148188": "nile"}
USDT = {"728126428": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "3448148188": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"}
UNIT = 10**6  # USDT and the test token both have 6 decimals
DEPLOY_FEE_LIMIT_SUN = 2_000 * UNIT  # what one deployment may burn at most; Nile's probe took 18 TRX for 895 bytes
ORIGIN_ENERGY_LIMIT = 10_000_000  # the deployer subsidises nothing at 100% user share; Tron still wants a number
CONFIG = "(address,address,address,address,uint16,uint64,uint64,uint64,uint64,uint128,uint128,uint128,uint128)"
REAL_RULES = (72 * 3600, 14 * 86400, 24 * 3600, 7 * 86400)  # window, timeout, acceptance closes, offer lifetime
MINUTE_RULES = (10 * 60, 30 * 60, 2 * 60, 5 * 60)  # the end-to-end run's, as scripts/e2e_v2.py's


def build() -> dict:
    version = subprocess.run([SOLC, "--version"], capture_output=True, text=True, check=True).stdout
    if "0.8.28" not in version or "tron" not in version.lower():
        sys.exit(f"{SOLC} is not Tron's solc 0.8.28:\n{version}")
    out = subprocess.run([SOLC, "--optimize", "--optimize-runs", "200", "--combined-json", "abi,bin",
                          "src/EscrowV2.sol", "src/TestUsdc.sol"],
                         cwd=ROOT / "contracts", capture_output=True, text=True, check=True).stdout
    contracts = json.loads(out)["contracts"]
    built = {}
    for name in ("EscrowV2", "TestUsdc"):
        entry = contracts[f"src/{name}.sol:{name}"]
        abi = entry["abi"] if isinstance(entry["abi"], list) else json.loads(entry["abi"])
        built[name] = {"bin": entry["bin"], "abi": abi}
        digest = hashlib.sha256(bytes.fromhex(entry["bin"])).hexdigest()
        print(f"built {name}: {len(entry['bin']) // 2} bytes, sha256 {digest}")
    return built


def hex20(address: str) -> str:
    return "0x" + to_hex_address(address)[2:]


def deploy(client: Tron, key: PrivateKey, name: str, artifact: dict, args: bytes = b"") -> str:
    owner = key.public_key.to_base58check_address()
    contract = Contract(name=name, bytecode=artifact["bin"] + args.hex(), abi=artifact["abi"],
                        user_resource_percent=100, origin_energy_limit=ORIGIN_ENERGY_LIMIT)
    result = client.trx.deploy_contract(owner, contract).fee_limit(DEPLOY_FEE_LIMIT_SUN).build().sign(key) \
        .broadcast().wait()
    receipt = result.get("receipt", {})
    if receipt.get("result", "SUCCESS") != "SUCCESS":
        sys.exit(f"{name} deployment failed: {receipt}")
    address = result["contract_address"]
    print(f"{name} at {address}: burned {result.get('fee', 0) / UNIT} TRX, energy {receipt.get('energy_usage_total')}")
    # Read raw: Tron leaves a zero field out, and tronpy would fill a missing share in as 100.
    on_chain = client.provider.make_request("wallet/getcontract", {"value": address, "visible": True})
    if on_chain.get("bytecode") not in (artifact["bin"], artifact["bin"] + args.hex()):
        sys.exit(f"{name}: the bytecode on chain is not the build's")
    if on_chain.get("consume_user_resource_percent", 0) != 100:
        sys.exit(f"{name}: the caller does not pay all energy ({on_chain.get('consume_user_resource_percent', 0)}%)")
    return address


def main() -> None:
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in NETWORKS:
        sys.exit(__doc__)
    chain, mode = sys.argv[1], (sys.argv[2] if len(sys.argv) == 3 else "")
    if mode not in ("", "end-to-end", "end-to-end-blocked") or (mode and chain != "3448148188"):
        sys.exit("end-to-end deployments are Nile only")
    # The folder is the market's name, as deploy/network-on.sh reads it: mainnet's is `728126428-usdt`.
    keys = Path.home() / ".vaticeno-keys" / (f"{chain}-usdt" if chain == "728126428" else chain)
    key_of = {role: (keys / f"{role}.key").read_text().strip() for role in ("deployer", "oracle", "guardian", "fee")}
    tron_of = {role: to_base58check_address("41" + Account.from_key(k).address[2:]) for role, k in key_of.items()}
    deployer = PrivateKey(bytes.fromhex(key_of["deployer"].removeprefix("0x")))
    client = Tron(network=NETWORKS[chain])
    built = build()
    if mode == "end-to-end-blocked":
        token = deploy(client, deployer, "TestUsdc", built["TestUsdc"])
        test_token = client.get_contract(token)
        test_token.abi = built["TestUsdc"]["abi"]
        owner = tron_of["deployer"]
        # Like Tether's USDT: a transfer that worked returns false (010-usdt-tron).
        test_token.functions.setTransferReturnsFalse(True).with_owner(owner).fee_limit(100 * UNIT).build() \
            .sign(deployer).broadcast().wait()
    else:
        token = USDT[chain]
    window, timeout, closes, lifetime = MINUTE_RULES if mode else REAL_RULES
    args = encode([CONFIG], [(hex20(token), hex20(tron_of["oracle"]), hex20(tron_of["guardian"]), hex20(tron_of["fee"]),
                              0, window, timeout, closes, lifetime,
                              UNIT // 100, 1_000 * UNIT, 10_000 * UNIT, 50_000 * UNIT)])
    escrow = deploy(client, deployer, "EscrowV2", built["EscrowV2"], args)
    print(f"WAGER_NETWORKS entry: {chain}:2:{escrow}:{token}")
    print(f"escrow in its 0x form, for deploy/network-on.sh: {hex20(escrow)}")


if __name__ == "__main__":
    main()
