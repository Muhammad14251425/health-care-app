"""
clinic_core.otp.setup_evolution -- find and store the Evolution credentials.

Three values are needed to send a WhatsApp message:

    clinic_evolution_url        where Evolution is listening
    clinic_evolution_api_key    the key Evolution accepts in the `apikey` header
    clinic_evolution_instance   which linked WhatsApp account to send from

`discover` asks the server which instances exist and whether each one is
connected, so the instance name is read off the server rather than guessed.
`configure` writes the values into site_config.json and verifies them.

Typical run:

    # 1. what instances does this server have, and are they connected?
    bench --site clinic.localhost execute clinic_core.otp.setup_evolution.discover \\
        --kwargs "{'url': 'http://localhost:8080', 'api_key': 'YOUR_KEY'}"

    # 2. store it (also flips clinic_otp_provider to whatsapp)
    bench --site clinic.localhost execute clinic_core.otp.setup_evolution.configure \\
        --kwargs "{'url': 'http://localhost:8080', 'api_key': 'YOUR_KEY', 'instance': 'clinic'}"

    # 3. prove it end to end
    bench --site clinic.localhost execute clinic_core.otp.diagnose.send_test \\
        --kwargs "{'phone_number': '03001234567'}"
"""

import json
import os

import frappe


def _mask(value):
    if not value:
        return "(not set)"
    text = str(value)
    return "*" * len(text) if len(text) <= 8 else f"{text[:4]}…{text[-4:]}"


def discover(url=None, api_key=None, timeout=10):
    """List the instances on an Evolution server and their connection state.

    Nothing is written. Use it to find the exact instance name (and to confirm
    the key works) before calling `configure`.
    """
    if not url or not api_key:
        print("\nBoth url and api_key are required.\n")
        print("  url     : where Evolution is reachable FROM THIS SERVER, e.g.")
        print("            http://localhost:8080, http://172.17.0.1:8080 (docker),")
        print("            or https://evo.yourdomain.com")
        print("  api_key : Evolution's AUTHENTICATION_API_KEY, or an instance apikey\n")
        return {"ok": False, "reason": "missing arguments"}

    url = url.rstrip("/")

    try:
        import requests
    except ImportError:
        print("\nThe 'requests' package is not available in this bench env.\n")
        return {"ok": False, "reason": "requests missing"}

    print(f"\nQuerying {url} …")
    try:
        response = requests.get(
            f"{url}/instance/fetchInstances",
            headers={"apikey": api_key},
            timeout=int(timeout),
        )
    except Exception as exc:
        print(f"  Could not reach it: {type(exc).__name__}: {exc}")
        print("\n  If Evolution runs in Docker and Frappe does not, 'localhost' inside")
        print("  this container is NOT the host. Try the host IP or the container name.\n")
        return {"ok": False, "reason": "unreachable"}

    if response.status_code in (401, 403):
        print(f"  HTTP {response.status_code} -- the api_key was rejected.")
        print("  Use Evolution's AUTHENTICATION_API_KEY, or the apikey returned")
        print("  when the instance was created.\n")
        return {"ok": False, "reason": "unauthorised"}

    if not response.ok:
        print(f"  HTTP {response.status_code}: {response.text[:200]}\n")
        return {"ok": False, "reason": f"http {response.status_code}"}

    try:
        payload = response.json()
    except ValueError:
        print(f"  Not JSON: {response.text[:200]}\n")
        return {"ok": False, "reason": "bad response"}

    rows = payload if isinstance(payload, list) else payload.get("data") or []
    if not rows:
        print("  The server answered, but has NO instances.")
        print("  Create one in the Evolution manager and scan its QR first.\n")
        return {"ok": True, "instances": []}

    print(f"\n  {len(rows)} instance(s):\n")
    found = []
    for row in rows:
        # Evolution has shipped both {"instance": {...}} and flat shapes.
        data = row.get("instance") if isinstance(row, dict) and "instance" in row else row
        if not isinstance(data, dict):
            continue

        name = (data.get("instanceName") or data.get("name") or "?")
        state = (data.get("connectionStatus") or data.get("state")
                 or data.get("status") or "unknown")
        number = data.get("owner") or data.get("number") or ""
        key = data.get("apikey") or data.get("token") or ""

        connected = str(state).lower() in ("open", "connected")
        mark = "connected" if connected else f"NOT CONNECTED ({state})"
        print(f"    name : {name}")
        print(f"    state: {mark}")
        if number:
            print(f"    number: {number}")
        if key:
            print(f"    instance apikey: {_mask(key)}")
        print()

        found.append({"instance": name, "state": state, "connected": connected})

    usable = [f for f in found if f["connected"]]
    if usable:
        print(f"  Use:  instance = '{usable[0]['instance']}'\n")
    else:
        print("  None are connected. Scan the QR in the Evolution manager,")
        print("  then re-run this.\n")

    return {"ok": True, "instances": found}


def configure(url=None, api_key=None, instance=None,
              verify_number=1, timeout=10, provider="whatsapp"):
    """Write the credentials into site_config.json, then verify them.

    site_config.json also holds db_name and encryption_key, so this reads the
    file, updates only these keys, and writes it back -- it never replaces it.
    """
    if not url or not api_key or not instance:
        print("\nurl, api_key and instance are all required.")
        print("Run clinic_core.otp.setup_evolution.discover first to find the instance.\n")
        return {"ok": False, "reason": "missing arguments"}

    path = os.path.join(frappe.get_site_path(), "site_config.json")
    with open(path) as handle:
        config = json.load(handle)

    config["clinic_otp_provider"] = provider
    config["clinic_evolution_url"] = url.rstrip("/")
    config["clinic_evolution_api_key"] = api_key
    config["clinic_evolution_instance"] = instance
    config["clinic_evolution_verify_number"] = int(verify_number)
    config["clinic_evolution_timeout"] = int(timeout)

    with open(path, "w") as handle:
        json.dump(config, handle, indent=1)

    # Reflect it in the running process so the check below sees the new values.
    frappe.conf.update({
        "clinic_otp_provider": provider,
        "clinic_evolution_url": url.rstrip("/"),
        "clinic_evolution_api_key": api_key,
        "clinic_evolution_instance": instance,
        "clinic_evolution_verify_number": int(verify_number),
        "clinic_evolution_timeout": int(timeout),
    })

    print(f"\nWrote to {path}:")
    print(f"  clinic_otp_provider       : {provider}")
    print(f"  clinic_evolution_url      : {url.rstrip('/')}")
    print(f"  clinic_evolution_instance : {instance}")
    print(f"  clinic_evolution_api_key  : {_mask(api_key)}")
    print(f"  verify_number             : {int(verify_number)}")
    print(f"  timeout                   : {int(timeout)}s")

    print("\nRestart bench for other workers to pick this up "
          "(this process already has it).")
    print("\nVerifying …")

    from clinic_core.otp import diagnose
    return diagnose.check()
