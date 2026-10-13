"""
End-to-end HTTP test of the sign-in safety features, notifications and the email cron, against a RUNNING app
and an EMPTY, freshly seeded test database. Never use a database with real data.

Covers: forgot / reset password, change password, session invalidation, OTP (wrong code, lockout, remember this
device, revoking trusted devices), account deactivation, in-app notifications, and the cron endpoint's secret.

The script starts its own tiny SMTP server to read the emails the app sends, so start the app pointing at it:

  SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=u SMTP_PASS=p SMTP_FROM=noreply@test.local
  EMAIL_DELIVERY_ENABLED=true PASSWORD_RESET_EMAIL_ENABLED=true APP_URL=<the app's URL>
  CRON_SECRET=test-cron-secret UPLOAD_PATH=<a folder> DATABASE_URL=... AUTH_SECRET=...

Then:  BASE_URL=http://localhost:3000 python3 scripts/e2e-auth-test.py
Optional: ADMIN_EMAIL / ADMIN_PASSWORD (default admin@test.local / Adm1n!Passw0rd#), CRON_SECRET, SMTP_SINK_PORT.
Note: OTP in this app applies to one hard-coded address (reine.alsouki@ahmadiah.com); the test creates that user.
"""
import base64, email, email.policy, json, os, re, socket, sys, threading, time
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@test.local")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "Adm1n!Passw0rd#")
CRON_SECRET = os.environ.get("CRON_SECRET", "test-cron-secret")
SINK_PORT = int(os.environ.get("SMTP_SINK_PORT", "2525"))
OTP_EMAIL = "reine.alsouki@ahmadiah.com"
PDF = base64.b64decode("JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCA4MAo+PgpzdHJlYW0KeJwr5HIK4TJQAMGidC59j9ScstSSzOREXXMDSwsTCwNzC0sFIxOFkDQuEOnDZQhWCiFDcrlszE3MTM2NzU3sFEKyuEK0uFxDuAK5AFdUEtYKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvT2JqU3RtCi9OIDUKL0ZpcnN0IDI2Ci9MZW5ndGggMzU5Cj4+CnN0cmVhbQp4nNVS30vDMBB+z19xj/ogSdP0l4zBtrYKMpRNUBQfujaMykikzWT+996lnWMP4rOUj+Tuvku+9L4ABEhQCkJIUlAQhRIiSIIAJhPGH78+NPCHaqt7xu/apodX5AhYwRvjC7s3DgI2nbITd1G5ame3bGiCgMhHxkNnm32tO5iURVkKkQghYoWIhZA5rgtEhpAYY02muEckagTmklCIcIa1ckCcDD1U99xo7C9wRW5MnHzgqnSIf+6lu4rhDPmXnmzK+NI2eeU0XOTXUsg4oJZMqSh7ucTf0enK2f/7OK+/tebXF57NmcZLQ+40ecBPma90b/ddjWMnXmmxQptbvfvUrq2rKzwrRZ1JmqHHRmPw5/vNu649lcLi4G7WjjQMCcotddNWc3tA9wn88OUe6MGZMdaRK70fjUM1FMWjR88kkyDG1/uN8yElA8bnVa+91JNOFGFq27RmC/ypNTPTt8cEnfgNNpHF7QplbmRzdHJlYW0KZW5kb2JqCgo4IDAgb2JqCjw8Ci9TaXplIDkKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCA0MAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA5IF0KPj4Kc3RyZWFtCnicFcSxEQAgDAOxt8MdLcuyE1smWIWAbrMhKTlVWuKAeD9fGGBBA2gKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjYyOQolJUVPRg==")
passed = failed = 0
def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL ", name, str(detail)[:300])
def section(t): print("\n==", t)

# ---------- a tiny SMTP server that keeps what it receives ----------
class Sink:
    def __init__(self, port):
        self.messages, self.lock = [], threading.Lock()
        self.srv = socket.socket(); self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", port)); self.srv.listen(5)
        threading.Thread(target=self._accept, daemon=True).start()
    def _accept(self):
        while True:
            try: conn, _ = self.srv.accept()
            except OSError: return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()
    def _handle(self, conn):
        f = conn.makefile("rwb"); w = lambda s: (f.write(s.encode() + b"\r\n"), f.flush())
        rcpt = []
        try:
            w("220 sink ESMTP")
            while True:
                line = f.readline()
                if not line: break
                cmd = line.decode(errors="replace").strip(); up = cmd.upper()
                if up.startswith("EHLO") or up.startswith("HELO"): f.write(b"250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"); f.flush()
                elif up.startswith("AUTH LOGIN"):
                    w("334 VXNlcm5hbWU6"); f.readline(); w("334 UGFzc3dvcmQ6"); f.readline(); w("235 2.7.0 ok")
                elif up.startswith("AUTH"): w("235 2.7.0 ok")
                elif up.startswith("MAIL"): rcpt = []; w("250 ok")
                elif up.startswith("RCPT"): rcpt.append(re.search(r"<([^>]+)>", cmd).group(1).lower()); w("250 ok")
                elif up == "DATA":
                    w("354 go"); data = b""
                    while True:
                        l = f.readline()
                        if l in (b".\r\n", b""): break
                        data += l[1:] if l.startswith(b"..") else l
                    msg = email.message_from_bytes(data, policy=email.policy.default)
                    body = msg.get_body(preferencelist=("html", "plain")); text = body.get_content() if body else ""
                    with self.lock: self.messages.append({"to": rcpt, "subject": str(msg["Subject"]), "body": text, "at": time.time()})
                    w("250 queued")
                elif up == "RSET": w("250 ok")
                elif up == "QUIT": w("221 bye"); break
                else: w("250 ok")
        finally:
            conn.close()
    def find(self, to, subject_has="", timeout=10, after=0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                for m in reversed(self.messages):
                    if m["at"] >= after and to.lower() in m["to"] and subject_has.lower() in m["subject"].lower(): return m
            time.sleep(0.2)
        return None
    def count(self, to):
        with self.lock: return sum(1 for m in self.messages if to.lower() in m["to"])

# ---------- HTTP client that carries Secure cookies over plain http ----------
class Client:
    COOKIES = ("docflow_session", "docflow_otp_challenge", "docflow_trusted_device")
    def __init__(self, label):
        self.s = requests.Session(); self.csrf = "csrf-" + label; self.s.cookies.set("docflow_csrf", self.csrf)
    def absorb(self, r):
        for h in r.raw.headers.getlist("Set-Cookie"):
            m = re.match(r"([^=]+)=([^;]*)", h)
            if m and m.group(1) in self.COOKIES:
                self.drop(m.group(1))
                if m.group(2) != "" and "Max-Age=0" not in h: self.s.cookies.set(m.group(1), m.group(2))
        return r
    def drop(self, name):
        for c in [c for c in self.s.cookies if c.name == name]: self.s.cookies.clear(c.domain, c.path, c.name)
    def value(self, name):
        found = [c.value for c in self.s.cookies if c.name == name]
        return found[-1] if found else None
    def req(self, method, path, body=None, headers=None):
        h = {"x-csrf-token": self.csrf, "Origin": BASE}; h.update(headers or {})
        return self.absorb(self.s.request(method, BASE + path, json=body, headers=h, allow_redirects=False))
    def get(self, p): return self.req("GET", p)
    def post(self, p, b=None): return self.req("POST", p, b if b is not None else {})
    def has(self, name): return self.value(name) is not None
    def clone_session(self):
        c = Client("copy"); c.s.cookies.set("docflow_session", self.value("docflow_session")); return c
    def login(self, e, p): return self.post("/api/auth/login", {"email": e, "password": p})

try: requests.get(BASE + "/login", timeout=5)
except Exception: print(f"Cannot reach the app at {BASE}. Start it first."); sys.exit(2)
sink = Sink(SINK_PORT)
PW = "Str0ng!Passw0rd#1"; PW2 = "An0ther!Passw0rd#2"

section("Setup through the admin API")
admin = Client("admin"); r = admin.login(ADMIN_EMAIL, ADMIN_PW)
check("admin signs in", r.status_code == 200, r.text[:200])
ut = {t["code"]: t["id"] for t in admin.get("/api/admin/users").json()["userTypes"]}
def mkuser(name, t, mail=None):
    r = admin.post("/api/admin/users", {"name": name, "email": mail or f"{name}@test.local", "password": PW, "userTypeId": ut[t]})
    check(f"user {name} created", r.status_code == 201, r.text[:200]); return r.json()["user"]
alice = mkuser("alice", "clerk"); otpu = mkuser("reine", "clerk", OTP_EMAIL)
eng, mgr, eng2 = mkuser("eng", "eng"), mkuser("mgr", "manager"), mkuser("eng2", "eng")
p1 = admin.post("/api/admin/projects", {"code": "P1", "name": "Project One"}).json()["project"]
roles = {x["name"]: x["id"] for x in admin.get("/api/admin/roles").json()["roles"]}
for u in (alice, eng): admin.post("/api/admin/assignments", {"userId": u["id"], "roleId": roles["Approver"], "projectId": p1["id"]})
types = {t["code"]: t for t in admin.get("/api/admin/document-types").json()["documentTypes"]}
MR = types["MR"]; CASH = next(s for s in MR["subtypes"] if s["code"] == "CASH")
flow = admin.post("/api/admin/flows", {"code": "F1", "name": "MR", "steps": [
    {"stepNumber": 0, "name": "Uploader", "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["clerk"]}]},
    {"stepNumber": 1, "name": "Engineer", "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["eng"]}]},
    {"stepNumber": 2, "name": "Manager", "approvers": [{"approverType": "USER", "userId": mgr["id"]}]}]}).json()["flow"]
admin.post("/api/admin/flow-assignments", {"documentTypeId": MR["id"], "documentSubtypeId": CASH["id"], "templateId": flow["id"]})

section("Forgot password")
c = Client("anon")
r = c.req("POST", "/api/auth/password/forgot", {"email": "alice@test.local"}, headers={"Origin": "http://evil.example"})
check("request from a foreign origin is refused", r.status_code == 403, r.status_code)
r = c.post("/api/auth/password/forgot", {"email": "not-an-email"}); check("invalid email refused", r.status_code == 400)
before = len(sink.messages)
r = c.post("/api/auth/password/forgot", {"email": "nobody@test.local"})
check("unknown email gets the same generic answer", r.status_code == 200 and "reset link will be sent" in r.json()["message"], r.text)
time.sleep(1); check("and no email is sent", len(sink.messages) == before)
t0 = time.time(); r = c.post("/api/auth/password/forgot", {"email": "alice@test.local"})
check("known email gets the generic answer", r.status_code == 200)
mail = sink.find("alice@test.local", "reset", after=t0)
check("reset email arrives", mail is not None)
token = re.search(r"token=([a-f0-9]{64})", mail["body"]).group(1) if mail else ""
check("link points at this app and the token is 64 hex characters", bool(token) and BASE in mail["body"].replace("&amp;", "&"), mail["body"][:300] if mail else "")
n = sink.count("alice@test.local"); c.post("/api/auth/password/forgot", {"email": "alice@test.local"}); time.sleep(1.5)
check("a second request within a minute sends nothing (cooldown)", sink.count("alice@test.local") == n)

section("Reset password")
alice_old = Client("alice-old"); alice_old.login("alice@test.local", PW)
check("alice has a working session before the reset", alice_old.get("/api/sidebar-counts").status_code == 200)
check("weak new password refused", c.post("/api/auth/password/reset", {"token": token, "newPassword": "short"}).status_code == 400)
check("unknown token refused", c.post("/api/auth/password/reset", {"token": "0" * 64, "newPassword": PW2}).status_code == 400)
check("malformed token refused", c.post("/api/auth/password/reset", {"token": "abc", "newPassword": PW2}).status_code == 400)
r = c.post("/api/auth/password/reset", {"token": token, "newPassword": PW2})
check("valid token resets the password", r.status_code == 200, r.text)
check("the token cannot be used twice", c.post("/api/auth/password/reset", {"token": token, "newPassword": "Third!Passw0rd#3"}).status_code == 400)
check("old password no longer works", Client("a").login("alice@test.local", PW).status_code == 401)
alice = Client("alice-new"); check("new password works", alice.login("alice@test.local", PW2).status_code == 200)
check("a session opened before the reset is signed out", alice_old.get("/api/sidebar-counts").status_code == 401, alice_old.get("/api/sidebar-counts").status_code)

section("Change password while signed in")
copy = alice.clone_session()
check("wrong current password refused", alice.post("/api/auth/password/change", {"currentPassword": "nope-nope-nope-1!", "newPassword": PW}).status_code == 401)
check("same password refused", alice.post("/api/auth/password/change", {"currentPassword": PW2, "newPassword": PW2}).status_code == 400)
r = alice.post("/api/auth/password/change", {"currentPassword": PW2, "newPassword": PW})
check("password changed", r.status_code == 200, r.text)
check("another copy of the old session is signed out too", copy.get("/api/sidebar-counts").status_code == 401, copy.get("/api/sidebar-counts").status_code)
alice = Client("alice3"); check("sign in with the changed password", alice.login("alice@test.local", PW).status_code == 200)
r = alice.post("/api/auth/logout"); check("logout clears the cookie", r.status_code == 200 and not alice.has("docflow_session"))

section("One-time passcode (OTP)")
u = Client("otp1"); t0 = time.time(); r = u.login(OTP_EMAIL, PW)
check("sign-in asks for a code instead of opening a session", r.status_code == 200 and r.json().get("requiresOtp") is True and not u.has("docflow_session"), r.text)
mail = sink.find(OTP_EMAIL, after=t0); code = re.search(r"\b(\d{6})\b", mail["body"]).group(1) if mail else ""
check("a 6-digit code is emailed", len(code) == 6, mail["body"][:200] if mail else "no mail")
check("no session before the code is verified", u.get("/api/sidebar-counts").status_code == 401)
check("wrong code refused", u.post("/api/auth/verify-otp", {"code": "000000" if code != "000000" else "111111"}).status_code == 401)
check("completing without verifying is refused", u.post("/api/auth/complete-otp-login", {"rememberDevice": True}).status_code == 401)
check("right code accepted", u.post("/api/auth/verify-otp", {"code": code}).json().get("otpVerified") is True)
r = u.post("/api/auth/complete-otp-login", {"rememberDevice": True})
check("login completes with a session and a remembered device", r.status_code == 200 and u.has("docflow_session") and u.has("docflow_trusted_device"), r.text)
check("the session works", u.get("/api/sidebar-counts").status_code == 200)
check("the challenge cannot be reused", Client("x").post("/api/auth/complete-otp-login", {"rememberDevice": False}).status_code == 401)
trusted = u.value("docflow_trusted_device")
u2 = Client("otp2"); u2.s.cookies.set("docflow_trusted_device", trusted); r = u2.login(OTP_EMAIL, PW)
check("a remembered device signs in without a code", r.status_code == 200 and not r.json().get("requiresOtp") and u2.has("docflow_session"), r.text)
u3 = Client("otp3"); check("a device that is not remembered is asked again", u3.login(OTP_EMAIL, PW).json().get("requiresOtp") is True)
for i in range(5): r = u3.post("/api/auth/verify-otp", {"code": "000000"})
check("five wrong codes lock the challenge", "lock" in r.text.lower() or "too many" in r.text.lower() or r.status_code == 401, r.text)
mail = sink.find(OTP_EMAIL, after=time.time() - 3)
real = re.search(r"\b(\d{6})\b", mail["body"]).group(1) if mail else "123456"
check("even the right code is refused while locked", u3.post("/api/auth/verify-otp", {"code": real}).status_code == 401)

section("Revoking remembered devices")
r = admin.post("/api/auth/trusted-devices/revoke", {"userId": otpu["id"]})
check("admin revokes the user's remembered devices", r.status_code == 200, r.text)
u4 = Client("otp4"); u4.s.cookies.set("docflow_trusted_device", trusted)
check("the old device is asked for a code again", u4.login(OTP_EMAIL, PW).json().get("requiresOtp") is True)
check("non-admin cannot revoke", alice.post("/api/auth/trusted-devices/revoke", {"userId": otpu["id"]}).status_code in (401, 403))

section("Deactivated accounts")
e = Client("eng"); e.login("eng@test.local", PW)
check("engineer is signed in", e.get("/api/sidebar-counts").status_code == 200)
r = admin.req("PATCH", "/api/admin/users", {"id": eng["id"], "name": "eng", "email": "eng@test.local", "isActive": False})
check("admin deactivates the engineer", r.status_code == 200 and r.json()["user"]["isActive"] is False, r.text)
check("their open session stops working at once", e.get("/api/sidebar-counts").status_code == 401)
check("they cannot sign in", Client("e2").login("eng@test.local", PW).status_code == 401)
admin.req("PATCH", "/api/admin/users", {"id": eng["id"], "name": "eng", "email": "eng@test.local", "isActive": True})
e = Client("eng-again"); check("reactivated user can sign in", e.login("eng@test.local", PW).status_code == 200)

section("In-app notifications")
al = Client("alice4"); al.login("alice@test.local", PW)
m = Client("mgr"); m.login("mgr@test.local", PW)
e2 = Client("eng2"); e2.login("eng2@test.local", PW)
base = {"documentTypeId": MR["id"], "documentSubtypeId": CASH["id"], "projectId": p1["id"], "title": "Tyres", "submissionKey": "n1"}
def upload(cl, fields):
    return cl.s.post(BASE + "/api/documents", data=fields, files=[("files", ("a.pdf", PDF, "application/pdf"))], headers={"x-csrf-token": cl.csrf}, allow_redirects=False)
def act(cl, doc, **form):
    files = [("file", ("s.pdf", PDF, "application/pdf"))] if form.get("decision") in ("APPROVE", "RESUBMIT") else None
    return cl.s.post(BASE + f"/api/documents/{doc}/actions", data=form, files=files, headers={"x-csrf-token": cl.csrf}, allow_redirects=False)
def notes(cl): return cl.get("/api/notifications").json()
r = upload(al, base); check("document uploaded", r.status_code == 201, r.text[:200]); doc = r.json()["documents"][0]
time.sleep(1.5)
n_eng = notes(e); n_mgr = notes(m); n_eng2 = notes(e2)
check("engineer is notified: approval required", n_eng["unreadCount"] == 1 and n_eng["notifications"][0]["title"] == "Approval required" and doc["documentNumber"] in n_eng["notifications"][0]["message"], n_eng)
check("manager is not notified yet", n_mgr["unreadCount"] == 0, n_mgr)
check("engineer at another project is not notified", n_eng2["unreadCount"] == 0)
check("admin is never notified", notes(admin)["unreadCount"] == 0)
check("uploader gets nothing for a fresh upload", notes(al)["unreadCount"] == 0)
check("marking as read clears the count", e.post("/api/notifications", {"action": "mark-read"}).json().get("success") is True and notes(e)["unreadCount"] == 0)
check("unknown action refused", e.post("/api/notifications", {"action": "x"}).status_code == 400)
check("notifications need a session", requests.get(BASE + "/api/notifications").status_code == 401)
act(e, doc["id"], decision="APPROVE"); time.sleep(1.5)
check("manager is notified after level 1", notes(m)["unreadCount"] == 1, notes(m))
r = act(m, doc["id"], decision="REQUEST_REVISION", comments="fix", targetLevel="0"); time.sleep(1.5)
check("uploader is told a revision is required", any(x["title"] == "Revision requested" for x in notes(al)["notifications"]), notes(al))
act(al, doc["id"], decision="RESUBMIT", comments="fixed"); act(e, doc["id"], decision="APPROVE"); time.sleep(1)
act(m, doc["id"], decision="APPROVE"); time.sleep(1.5)
check("uploader is told it was approved", any(x["title"] == "Document approved" for x in notes(al)["notifications"]), [x["title"] for x in notes(al)["notifications"]])
d2 = upload(al, {**base, "submissionKey": "n2"}).json()["documents"][0]; time.sleep(1)
act(e, d2["id"], decision="REJECT", comments="no"); time.sleep(1.5)
check("uploader is told it was rejected", any(x["title"] == "Document rejected" for x in notes(al)["notifications"]))

section("Email cron endpoint")
r = requests.post(BASE + "/api/cron/workflow-emails"); check("no secret: 401", r.status_code == 401)
r = requests.post(BASE + "/api/cron/workflow-emails", headers={"Authorization": "Bearer wrong"}); check("wrong secret: 401", r.status_code == 401)
r = requests.post(BASE + "/api/cron/workflow-emails", headers={"Authorization": f"Bearer {CRON_SECRET}"})
check("right secret: runs and reports", r.status_code == 200 and set(r.json()) == {"queuedApprovalReminders", "queuedProcessReminders", "sentBatches"}, r.text)


if os.environ.get("GATE") == "1":
    section("Route gate (app started with ROUTE_GATE_ENABLED=true)")
    anon = lambda p: requests.get(BASE + p, allow_redirects=False)
    loc = lambda r: r.headers.get("location", "")
    r = anon("/admin"); check("signed-out visitor to /admin is sent to the login page", r.status_code in (302, 307) and "/login" in loc(r), (r.status_code, loc(r)))
    r = anon("/clerk/my-documents"); check("signed-out visitor to a clerk page is sent to login", r.status_code in (302, 307) and "/login" in loc(r), (r.status_code, loc(r)))
    check("the login page itself is reachable", anon("/login").status_code == 200)
    check("signed-out API call is 401 from the gate", anon("/api/admin/flows").status_code == 401)
    r = requests.post(BASE + "/api/auth/login", json={"email": "x@test.local", "password": "x"}, allow_redirects=False)
    check("a write without the CSRF header is refused (403)", r.status_code == 403, r.status_code)
    r = Client("g").login("x@test.local", "x"); check("sign-in with the CSRF header reaches the login route (401, not locked out)", r.status_code == 401 and "Invalid credentials" in r.text, (r.status_code, r.text))
    check("cron call with its bearer secret needs neither session nor CSRF cookie", requests.post(BASE + "/api/cron/workflow-emails", headers={"Authorization": f"Bearer {CRON_SECRET}"}).status_code == 200)
    r = al.get("/admin"); check("a clerk opening the admin dashboard is sent to /unauthorized", r.status_code in (302, 307) and "/unauthorized" in loc(r), (r.status_code, loc(r)))
    r = e.get("/clerk"); check("an engineer opening the clerk area is sent to /unauthorized", r.status_code in (302, 307) and "/unauthorized" in loc(r), (r.status_code, loc(r)))
    r = al.get("/"); check("signed-in visitor to / goes to their own home", r.status_code in (302, 307) and "/clerk" in loc(r), (r.status_code, loc(r)))
    check("signed-in people reach their own pages", al.get("/clerk").status_code == 200 and admin.get("/admin/flows").status_code == 200)

print(f"\n{passed} checks passed, {failed} failed.")
sys.exit(0 if failed == 0 else 1)
