"""Post-deployment smoke test for the Navyakosh IoT backend.

Runs the auth, scoping, and device-key checks against a live deployment.
Zero dependencies beyond the standard library.

Usage:
    python smoke_test.py --base-url https://iot-control-backend.vercel.app \
        --email admin@example.com --password "..." --hub-key "..."

Exit code 0 = all checks passed.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

results = []


def call(method, url, body=None, headers=None):
    """Returns (status_code, parsed_json_or_none). Never raises."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None
    except Exception as e:
        return -1, {"error": str(e)}


def check(name, passed, detail=""):
    results.append((name, passed))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail and not passed else ""))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--email", required=True, help="A SUPER_ADMIN account email")
    p.add_argument("--password", required=True)
    p.add_argument("--hub-key", required=True, help="Must match the backend's HUB_API_KEY env var")
    args = p.parse_args()
    base = args.base_url.rstrip("/")

    print(f"\nSmoke-testing {base}\n")

    # 1. Health
    code, body = call("GET", f"{base}/api/health")
    check("health endpoint responds ONLINE", code == 200 and body and body.get("status") == "ONLINE", f"got {code}: {body}")

    # 2. Login issues a JWT
    code, body = call("POST", f"{base}/api/login", {"email": args.email, "password": args.password})
    token = (body or {}).get("access_token")
    check("login returns access_token", code == 200 and bool(token), f"got {code}: {body}")
    auth = {"Authorization": f"Bearer {token}"} if token else {}

    # 3. Bad credentials rejected
    code, _ = call("POST", f"{base}/api/login", {"email": args.email, "password": "definitely-wrong-password"})
    check("wrong password rejected with 401", code == 401, f"got {code}")

    # 4. Protected route blocks anonymous callers
    code, _ = call("GET", f"{base}/api/onboard/all-plants")
    check("all-plants without token -> 401", code == 401, f"got {code}")

    # 5. Same route works with the token
    code, body = call("GET", f"{base}/api/onboard/all-plants", headers=auth)
    check("all-plants with token -> 200", code == 200 and (body or {}).get("success") is True, f"got {code}: {body}")

    # 6. Garbage token rejected
    code, _ = call("GET", f"{base}/api/onboard/all-plants", headers={"Authorization": "Bearer not-a-real-token"})
    check("forged token rejected with 401", code == 401, f"got {code}")

    # 7. Ingest requires the hub key
    ingest_body = {"hub_id": "SMOKE-TEST-FAKE-HUB", "uptime_seconds": 1, "readings": []}
    code, _ = call("POST", f"{base}/api/telemetry/ingest", ingest_body)
    check("ingest without X-Hub-Key -> 401", code == 401, f"got {code}")

    # 8. Ingest accepts the hub key (fake hub id returns success:false, which proves auth passed)
    code, body = call("POST", f"{base}/api/telemetry/ingest", ingest_body, headers={"X-Hub-Key": args.hub_key})
    check(
        "ingest with X-Hub-Key -> authenticated",
        code == 200 and (body or {}).get("detail") == "HARDWARE_NOT_PROVISIONED",
        f"got {code}: {body}",
    )

    # 9. Firmware manifest reachable with hub key
    code, body = call("GET", f"{base}/api/firmware/latest?device_type=CENTRAL_HUB", headers={"X-Hub-Key": args.hub_key})
    check("firmware manifest responds", code == 200 and (body or {}).get("success") is True, f"got {code}: {body}")

    # 10. Firmware manifest validates device_type
    code, _ = call("GET", f"{base}/api/firmware/latest?device_type=TOASTER", headers={"X-Hub-Key": args.hub_key})
    check("firmware manifest rejects unknown device type", code == 400, f"got {code}")

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed.")
    if failed:
        print("Failed: " + ", ".join(failed))
        sys.exit(1)
    print("Deployment looks healthy.")


if __name__ == "__main__":
    main()
