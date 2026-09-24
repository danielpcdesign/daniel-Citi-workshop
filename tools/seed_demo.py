"""Seed demo data through the public API, so every row obeys the same rules the demo shows.

usage:
    python3 tools/seed_demo.py                                          # local stack (:3001)
    python3 tools/seed_demo.py https://d2bwm7q2v18xxo.cloudfront.net   # cloud

env (prompted when unset): SEED_ADMIN_EMAIL (default you@acme.inc), SEED_ADMIN_PASSWORD, SEED_PASSWORD
(the password given to every demo person). re-running is safe: existing people, places and incident titles are reused.
"""

import getpass
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001").rstrip("/")

ENGINEERS = {
    "priya": ("Priya Nair", "demo.priya.nair@acme.inc"),
    "marcus": ("Marcus Webb", "demo.marcus.webb@acme.inc"),
    "sofia": ("Sofia Alvarez", "demo.sofia.alvarez@acme.inc"),
}
EMPLOYEES = {
    "tom": ("Tom Hughes", "demo.tom.hughes@acme.inc"),
    "aisha": ("Aisha Khan", "demo.aisha.khan@acme.inc"),
    "ben": ("Ben Carter", "demo.ben.carter@acme.inc"),
    "lena": ("Lena Fischer", "demo.lena.fischer@acme.inc"),
}

# building -> floor -> seats
PLACES = {
    "HQ Tower": {"Floor 1": ["1-04", "1-12"], "Floor 2": ["2-07", "2-15"], "Floor 3": ["3-02", "3-21"]},
    "Riverside Annex": {"Ground": ["G-03"], "Floor 1": ["1-08"]},
    "Data Centre North": {"Hall A": ["Rack 12", "Rack 30"]},
}

# each incident ends in a different state, so every board column, report and attention list has something in it.
# steps: ("assign", engineer) · ("move", actor, to, reason) · ("note", actor, body) · ("escalate", reason)
# · ("decide", status, reason). actor "admin", an engineer key, or "reporter"
INCIDENTS = [
    ("tom", "Flickering lights over the open-plan area", "Half the ceiling panels flicker every few seconds; headaches reported.",
     "electrical", "medium", ("HQ Tower", "Floor 2", "2-07"), []),
    ("aisha", "Kitchen tap leaking under the sink", "Water pooling in the cupboard under the Floor 1 kitchen sink.",
     "plumbing", "high", ("HQ Tower", "Floor 1", None), []),
    ("ben", "Badge reader rejects valid badges", "Side entrance reader shows red for everyone since this morning.",
     "access_security", "critical", ("Riverside Annex", "Ground", None),
     [("escalate", "Staff are propping the fire door open to get in.")]),
    ("lena", "Chair hydraulics failed", "Desk chair sinks to the lowest setting within minutes.",
     "furniture", "low", ("HQ Tower", "Floor 3", "3-21"), []),
    ("tom", "Meeting room display will not connect", "HDMI input shows no signal from any laptop in room 3B.",
     "hardware", "medium", ("HQ Tower", "Floor 3", None), [("assign", "marcus")]),
    ("aisha", "Air conditioning blowing warm air", "Floor 2 east side is at 28 degrees by midday.",
     "hvac", "high", ("HQ Tower", "Floor 2", None),
     [("assign", "priya"), ("note", "priya", "On my list for this afternoon; will check the east air handler first.")]),
    ("ben", "Wi-Fi drops every few minutes", "Laptops lose the ACME-Corp network on Floor 1 of the annex.",
     "network", "high", ("Riverside Annex", "Floor 1", None),
     [("assign", "marcus"), ("move", "marcus", "in_progress", None),
      ("note", "marcus", "Access point AP-R1-02 is rebooting on a loop; replacing its power injector.")]),
    ("lena", "Server rack temperature alarm", "Rack 12 inlet temperature alarm triggered twice overnight.",
     "hvac", "critical", ("Data Centre North", "Hall A", "Rack 12"),
     [("assign", "priya"), ("move", "priya", "in_progress", None)]),
    ("tom", "Toilet on Floor 3 will not flush", "Men's toilet cubicle 2 cistern does not refill.",
     "plumbing", "medium", ("HQ Tower", "Floor 3", None),
     [("assign", "sofia"), ("move", "sofia", "in_progress", None),
      ("move", "sofia", "blocked", "Replacement fill valve is on order; supplier delivery due Friday."),
      ("note", "reporter", "Thanks for the update, we'll use the Floor 2 facilities until then.")]),
    ("aisha", "Main entrance door will not lock", "The front door motor lock does not engage at night.",
     "access_security", "critical", ("HQ Tower", "Floor 1", None),
     [("assign", "marcus"), ("move", "marcus", "in_progress", None),
      ("move", "marcus", "blocked", "Needs the lock vendor's engineer; security guard posted overnight meanwhile."),
      ("escalate", "The building is unlocked overnight; this is a security risk.")]),
    ("ben", "Desk power socket sparking", "Floor socket under desk 1-12 sparked when a charger was plugged in.",
     "electrical", "critical", ("HQ Tower", "Floor 1", "1-12"),
     [("assign", "priya"), ("move", "priya", "in_progress", None),
      ("move", "priya", "resolved", None),
      ("note", "priya", "Socket replaced and circuit tested; the old one had a cracked housing.")]),
    ("lena", "Printer jams on every job", "The Floor 2 printer jams on every double-sided job.",
     "hardware", "low", ("HQ Tower", "Floor 2", None),
     [("assign", "marcus"), ("move", "marcus", "in_progress", None), ("move", "marcus", "resolved", None)]),
    ("tom", "Spill on the carpet by the lifts", "Coffee spilled across the carpet outside the Floor 3 lifts.",
     "cleaning", "low", ("HQ Tower", "Floor 3", None),
     [("assign", "sofia"), ("move", "sofia", "in_progress", None), ("move", "sofia", "resolved", None),
      ("move", "admin", "closed", None)]),
    ("aisha", "Blinds stuck half-closed", "The motorised blinds in the annex ground floor stopped halfway.",
     "furniture", "low", ("Riverside Annex", "Ground", "G-03"),
     [("assign", "sofia"), ("move", "sofia", "in_progress", None), ("move", "sofia", "resolved", None),
      ("move", "admin", "closed", None)]),
    ("ben", "VPN client fails to install", "The VPN installer fails with error 1603 on new laptops.",
     "software", "medium", ("HQ Tower", "Floor 2", "2-15"),
     [("assign", "marcus"), ("move", "marcus", "in_progress", None), ("move", "marcus", "resolved", None),
      ("move", "admin", "closed", None)]),
    ("lena", "Switch port flapping in Rack 30", "Monitoring shows port 14 on the Rack 30 switch going up and down.",
     "network", "high", ("Data Centre North", "Hall A", "Rack 30"),
     [("assign", "priya"), ("move", "priya", "in_progress", None),
      ("move", "admin", "unassigned", "Priya is on leave from tomorrow; reassigning to keep it moving."),
      ("assign", "marcus"), ("move", "marcus", "in_progress", None)]),
    ("tom", "Water on the floor by the server hall door", "A slow drip from the ceiling tile by the Hall A door.",
     "plumbing", "high", ("Data Centre North", "Hall A", None),
     [("escalate", "It is right next to the server racks."),
      ("decide", "granted", "Agreed; assigning it straight away."),
      ("assign", "sofia")]),
    ("aisha", "Radiator banging all day", "The radiator by seat 3-02 knocks loudly every few minutes.",
     "hvac", "medium", ("HQ Tower", "Floor 3", "3-02"),
     [("escalate", "It is impossible to take calls at this desk."),
      ("decide", "declined", "Not a safety issue; it is in the queue at medium priority.")]),
]


class ApiError(Exception):
    pass


def call(method: str, path: str, token: str | None = None, body: dict | None = None, query: dict | None = None):
    url = BASE_URL + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Access-Token"] = token
    if data is not None:
        # cloudfront signs lambda origins with sigv4, which cannot hash a body itself: the client must (AD-08b)
        headers["x-amz-content-sha256"] = hashlib.sha256(data).hexdigest()
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = raw.decode(errors="replace")[:200]
        return err.code, payload


def must(expected: tuple[int, ...], result: tuple[int, object], what: str):
    status, payload = result
    if status not in expected:
        raise ApiError(f"{what}: HTTP {status} {payload}")
    return payload


def items(payload) -> list:
    return payload["items"] if isinstance(payload, dict) else payload


def login(email: str, password: str) -> tuple[str, dict]:
    payload = must((200,), call("POST", "/api/auth/login", body={"email": email, "password": password}), f"login {email}")
    return payload["access_token"], payload["user"]


def ensure_person(full_name: str, email: str, password: str) -> tuple[str, dict]:
    status, payload = call("POST", "/api/auth/register", body={"email": email, "password": password, "full_name": full_name})
    if status not in (201, 409):
        raise ApiError(f"register {email}: HTTP {status} {payload}")
    return login(email, password)


def find_or_create(token: str, list_path: str, name: str, what: str) -> int:
    for item in items(must((200,), call("GET", list_path, token), f"list {what}")):
        if item["name"] == name:
            return item["id"]
    return must((201,), call("POST", list_path, token, {"name": name}), f"create {what} {name}")["id"]


def seed_places(token: str) -> dict:
    ids = {}
    for building, floors in PLACES.items():
        building_id = find_or_create(token, "/api/facilities/buildings", building, "building")
        ids[(building, None, None)] = (building_id, None, None)
        for floor, seats in floors.items():
            floor_id = find_or_create(token, f"/api/facilities/buildings/{building_id}/floors", floor, "floor")
            ids[(building, floor, None)] = (building_id, floor_id, None)
            for seat in seats:
                seat_id = find_or_create(token, f"/api/facilities/floors/{floor_id}/seats", seat, "seat")
                ids[(building, floor, seat)] = (building_id, floor_id, seat_id)
    return ids


def already_seeded(admin_token: str, title: str) -> bool:
    found = items(must((200,), call("GET", "/api/incidents", admin_token, query={"q": title, "limit": 5}), "search"))
    return any(item["title"] == title for item in found)


def run_step(step: tuple, incident_id: int, tokens: dict, reporter: str, users: dict) -> None:
    kind = step[0]
    path = f"/api/incidents/{incident_id}"
    if kind == "assign":
        must((200,), call("POST", f"{path}/assignment", tokens["admin"], {"engineer_id": users[step[1]]["id"]}), "assign")
    elif kind == "move":
        actor = reporter if step[1] == "reporter" else step[1]
        body = {"to": step[2]} if step[3] is None else {"to": step[2], "reason": step[3]}
        must((200,), call("POST", f"{path}/transitions", tokens[actor], body), f"move to {step[2]}")
    elif kind == "note":
        actor = reporter if step[1] == "reporter" else step[1]
        must((201,), call("POST", f"{path}/notes", tokens[actor], {"body": step[2]}), "note")
    elif kind == "escalate":
        must((200,), call("POST", f"{path}/escalation", tokens[reporter], {"reason": step[1]}), "escalate")
    elif kind == "decide":
        must((200,), call("PUT", f"{path}/escalation", tokens["admin"], {"status": step[1], "reason": step[2]}), "decide")


def main() -> None:
    admin_email = os.environ.get("SEED_ADMIN_EMAIL", "you@acme.inc")
    admin_password = os.environ.get("SEED_ADMIN_PASSWORD") or getpass.getpass(f"password for {admin_email}: ")
    password = os.environ.get("SEED_PASSWORD") or getpass.getpass("password to give every demo person: ")

    print(f"seeding {BASE_URL}")
    tokens, users = {}, {}
    tokens["admin"], _ = login(admin_email, admin_password)

    for key, (full_name, email) in {**ENGINEERS, **EMPLOYEES}.items():
        tokens[key], users[key] = ensure_person(full_name, email, password)
    for key in ENGINEERS:
        if users[key]["role"] != "engineer":
            path = f"/api/auth/users/{users[key]['id']}/role"
            must((200,), call("PUT", path, tokens["admin"], {"role": "engineer"}), f"promote {key}")
            # the role is a token claim: sign in again to carry the new one
            tokens[key], users[key] = login(ENGINEERS[key][1], password)
    print(f"  people: {len(ENGINEERS)} engineers, {len(EMPLOYEES)} employees")

    places = seed_places(tokens["admin"])
    print(f"  places: {len(PLACES)} buildings")

    created = skipped = 0
    for reporter, title, description, category, priority, place, steps in INCIDENTS:
        if already_seeded(tokens["admin"], title):
            skipped += 1
            continue
        building_id, floor_id, seat_id = places[place]
        body = {"title": title, "description": description, "category": category, "priority": priority,
                "building_id": building_id, "floor_id": floor_id, "seat_id": seat_id}
        incident = must((201,), call("POST", "/api/incidents", tokens[reporter], body), f"create '{title}'")
        for step in steps:
            run_step(step, incident["id"], tokens, reporter, users)
        created += 1
        print(f"  #{incident['id']} {title}")
    print(f"done: {created} incidents created, {skipped} already there")


if __name__ == "__main__":
    try:
        main()
    except ApiError as err:
        sys.exit(f"seed stopped: {err}")
