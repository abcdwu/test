"""One-time/ongoing deployment from GitHub Actions with app-scoped credentials."""
import ipaddress
import hashlib
import json
import os
import subprocess
import tomllib
import urllib.request
from pathlib import Path

with open("fly.toml", "rb") as config_file:
    config = tomllib.load(config_file)
app = config["app"]
region = config["primary_region"]


def fly(*args, capture=False, input_text=None):
    return subprocess.run(
        ["flyctl", *args, "--app", app], check=True, text=True,
        input=input_text, stdout=subprocess.PIPE if capture else None,
    ).stdout


volumes = json.loads(fly("volumes", "list", "--json", capture=True))
matching = [volume for volume in volumes if volume.get("name", volume.get("Name")) == "mistake_data"
            and volume.get("state", volume.get("State")) != "destroyed"]
if not matching:
    fly("volumes", "create", "mistake_data", "--region", region, "--size", "1", "--snapshot-retention", "30", "--yes")
elif len(matching) != 1 or matching[0].get("region", matching[0].get("Region")) != region:
    raise RuntimeError("Expected exactly one mistake_data volume in the configured region; review before deploying")

addresses = json.loads(fly("ips", "list", "--json", capture=True))
has_ipv4 = False
for address in addresses:
    try:
        has_ipv4 |= ipaddress.ip_address(address.get("address", address.get("Address", ""))).version == 4
    except ValueError:
        pass
if not has_ipv4:
    fly("ips", "allocate-v4", "--shared")

password = os.environ["LOGIN_PASSWORD"]
if len(password) < 1 or "\n" in password or "\r" in password:
    raise RuntimeError("LOGIN_PASSWORD must contain at least 1 character and no newlines")
# Pass the password through stdin, never a command argument or log line.
fly("secrets", "import", "--stage", input_text=f"LOGIN_PASSWORD={password}\n")
fly("deploy", "--remote-only", "--ha=false")

base = f"https://{app}.fly.dev"


def api(path, body=None, token=None, method="POST"):
    request = urllib.request.Request(
        base + path, data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


health = api("/health", method="GET")
assert health["ok"] and "quiz-attempts" in health.get("features", [])
assert "public-bank" in health.get("features", [])
assert "highlights" in health.get("features", [])
manifest = api("/bank/manifest.json", method="GET")
assert manifest == json.loads(Path("bank/manifest.json").read_text())
for info in manifest["subjects"].values():
    request = urllib.request.Request(base + "/bank/" + info["file"], headers={"Origin": "https://test.chaoxu.me"})
    with urllib.request.urlopen(request, timeout=60) as response:
        assert response.headers.get("Access-Control-Allow-Origin") == "https://test.chaoxu.me"
        assert hashlib.sha256(response.read()).hexdigest() == info["sha256"]
with urllib.request.urlopen(base + "/", timeout=60) as response:
    assert response.read() == Path("index.html").read_bytes()
request = urllib.request.Request(base + "/sources/torts.pdf", headers={"Range": "bytes=0-31", "Origin": "https://test.chaoxu.me"})
with urllib.request.urlopen(request, timeout=60) as response:
    assert response.status == 206 and len(response.read()) == 32
session = api("/auth/login", {"password": password})
try:
    synced = api("/api/sync", {"entries": [], "attempts": []}, session["token"])
    assert isinstance(synced["entries"], list) and isinstance(synced["attempts"], list)
    assert isinstance(synced["highlights"], list)
finally:
    api("/auth/session", token=session["token"], method="DELETE")

print("Deployment, public bank mirror, PDF range and authenticated sync checks passed:", base)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"Private API deployed: {base}\n\nHealth and authenticated sync checks passed.\n"
                      f"\nFrontend cloud-config.json can now use apiBase: {base}\n")
