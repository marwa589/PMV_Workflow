"""
End-to-end HTTP test of the dynamic workflow, run against a RUNNING app and an EMPTY, freshly seeded test database.

Setup (never use a database with real data):
  1. Apply the schema, then:  SEED_ADMIN_EMAIL=admin@test.local SEED_ADMIN_PASSWORD='Adm1n!Passw0rd#' node prisma/seed.mjs
  2. Start the app (npm run build && npm run start, or npm run dev) with UPLOAD_PATH set.
  3. pip install requests
  4. BASE_URL=http://localhost:3000 python3 scripts/e2e-http-test.py
Optional: ADMIN_EMAIL / ADMIN_PASSWORD if you seeded a different admin.

It signs in as admin, clerk, engineers and a manager, sets up flows and roles through the admin APIs,
uploads and approves documents, runs a process, and loads every page, checking who is let in and kept out.
"""
import base64, json, os, re, sys
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@test.local")
PDF = base64.b64decode("JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCA4MAo+PgpzdHJlYW0KeJwr5HIK4TJQAMGidC59j9ScstSSzOREXXMDSwsTCwNzC0sFIxOFkDQuEOnDZQhWCiFDcrlszE3MTM2NzU3sFEKyuEK0uFxDuAK5AFdUEtYKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvT2JqU3RtCi9OIDUKL0ZpcnN0IDI2Ci9MZW5ndGggMzU5Cj4+CnN0cmVhbQp4nNVS30vDMBB+z19xj/ogSdP0l4zBtrYKMpRNUBQfujaMykikzWT+996lnWMP4rOUj+Tuvku+9L4ABEhQCkJIUlAQhRIiSIIAJhPGH78+NPCHaqt7xu/apodX5AhYwRvjC7s3DgI2nbITd1G5ame3bGiCgMhHxkNnm32tO5iURVkKkQghYoWIhZA5rgtEhpAYY02muEckagTmklCIcIa1ckCcDD1U99xo7C9wRW5MnHzgqnSIf+6lu4rhDPmXnmzK+NI2eeU0XOTXUsg4oJZMqSh7ucTf0enK2f/7OK+/tebXF57NmcZLQ+40ecBPma90b/ddjWMnXmmxQptbvfvUrq2rKzwrRZ1JmqHHRmPw5/vNu649lcLi4G7WjjQMCcotddNWc3tA9wn88OUe6MGZMdaRK70fjUM1FMWjR88kkyDG1/uN8yElA8bnVa+91JNOFGFq27RmC/ypNTPTt8cEnfgNNpHF7QplbmRzdHJlYW0KZW5kb2JqCgo4IDAgb2JqCjw8Ci9TaXplIDkKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCA0MAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA5IF0KPj4Kc3RyZWFtCnicFcSxEQAgDAOxt8MdLcuyE1smWIWAbrMhKTlVWuKAeD9fGGBBA2gKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjYyOQolJUVPRg==")
passed = failed = 0

def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1
        print("  FAIL ", name, str(detail)[:300])

def section(t): print("\n==", t)

class Client:
    def __init__(self, label):
        self.s = requests.Session(); self.label = label
        self.csrf = "csrf-" + label
        self.s.cookies.set("docflow_csrf", self.csrf)
        # A browser sends the token with every request it makes; do the same.
        self.s.headers["x-csrf-token"] = self.csrf
    def login(self, email, password):
        r = self.s.post(BASE + "/api/auth/login", json={"email": email, "password": password}, headers={"x-csrf-token": self.csrf})
        # The session cookie is marked Secure in production mode; browsers allow it on localhost, requests does not.
        m = re.search(r"docflow_session=([^;]+)", r.headers.get("set-cookie", ""))
        if m: self.s.cookies.set("docflow_session", m.group(1))
        return r
    def get(self, path, **kw): return self.s.get(BASE + path, allow_redirects=False, **kw)
    def call(self, method, path, body=None):
        return self.s.request(method, BASE + path, json=body, headers={"x-csrf-token": self.csrf}, allow_redirects=False)
    def upload(self, fields, files=None, path="/api/documents"):
        files = files or [("files", ("test.pdf", PDF, "application/pdf"))]
        return self.s.post(BASE + path, data=fields, files=files, headers={"x-csrf-token": self.csrf}, allow_redirects=False)

try:
    requests.get(BASE + "/login", timeout=5)
except Exception:
    print(f"Cannot reach the app at {BASE}. Start it first."); sys.exit(2)

if True:
    PW = os.environ.get("ADMIN_PASSWORD", "Adm1n!Passw0rd#")
    section("Sign in")
    admin = Client("admin")
    r = admin.login(ADMIN_EMAIL, PW)
    check("admin can sign in", r.status_code == 200 and r.json().get("redirectTo") == "/admin", (r.status_code, r.text[:200]))
    check("wrong password is refused", Client("x").login(ADMIN_EMAIL, "nope").status_code == 401)

    section("Admin sets everything up through the admin APIs")
    ut = {t["code"]: t["id"] for t in admin.call("GET", "/api/admin/users").json()["userTypes"]}
    loc = admin.call("POST", "/api/admin/locations", {"name": "Kuwait"}).json()["location"]
    p1 = admin.call("POST", "/api/admin/projects", {"code": "P1", "name": "Project One", "locationId": loc["id"]}).json()["project"]
    p2 = admin.call("POST", "/api/admin/projects", {"code": "P2", "name": "Project Two", "locationId": loc["id"]}).json()["project"]
    check("project created", bool(p1["id"]))
    check("duplicate project code refused", admin.call("POST", "/api/admin/projects", {"code": "P1", "name": "Again"}).status_code == 409)
    def mkuser(name, t):
        r = admin.call("POST", "/api/admin/users", {"name": name, "email": f"{name}@test.local", "password": PW, "userTypeId": ut[t]})
        check(f"user {name} created", r.status_code == 201, r.text[:200]); return r.json()["user"]
    clerk, eng, mgr, eng2 = mkuser("clerk", "clerk"), mkuser("eng", "eng"), mkuser("mgr", "manager"), mkuser("eng2", "eng")
    check("weak password refused", admin.call("POST", "/api/admin/users", {"name": "w", "email": "w@test.local", "password": "short", "userTypeId": ut["clerk"]}).status_code == 400)
    check("user type cannot be changed", admin.call("PATCH", "/api/admin/users", {"id": clerk["id"], "name": "clerk", "email": "clerk@test.local", "userTypeId": ut["admin"]}).status_code == 400)

    roles = {r["name"]: r["id"] for r in admin.call("GET", "/api/admin/roles").json()["roles"]}
    check("seeded roles exist", "Approver" in roles and "Editor" in roles)
    for u in (clerk, eng):
        r = admin.call("POST", "/api/admin/assignments", {"userId": u["id"], "roleId": roles["Approver"], "projectId": p1["id"]})
        check("assignment created", r.status_code == 201, r.text[:200])
    check("duplicate assignment refused", admin.call("POST", "/api/admin/assignments", {"userId": eng["id"], "roleId": roles["Approver"], "projectId": p1["id"]}).status_code == 409)

    types = {t["code"]: t for t in admin.call("GET", "/api/admin/document-types").json()["documentTypes"]}
    MR = types["MR"]; CASH = next(s for s in MR["subtypes"] if s["code"] == "CASH")
    fr = admin.call("POST", "/api/admin/flows", {"code": "F1", "name": "MR flow", "steps": [
        {"stepNumber": 0, "name": "Uploader", "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["clerk"]}]},
        {"stepNumber": 1, "name": "PMV Engineer", "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["eng"]}]},
        {"stepNumber": 2, "name": "PMV Manager", "approvers": [{"approverType": "USER", "userId": mgr["id"]}]}]})
    check("flow created", fr.status_code == 201, fr.text[:300])
    flow = fr.json()["flow"]
    check("flow with a gap is refused", admin.call("POST", "/api/admin/flows", {"code": "BAD", "name": "bad", "steps": [
        {"stepNumber": 0, "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["clerk"]}]},
        {"stepNumber": 2, "approvers": [{"approverType": "USER_TYPE", "userTypeId": ut["eng"]}]}]}).status_code == 400)
    fa = admin.call("POST", "/api/admin/flow-assignments", {"documentTypeId": MR["id"], "documentSubtypeId": CASH["id"], "templateId": flow["id"]})
    check("flow assigned to MR / Cash", fa.status_code == 201, fa.text[:200])
    check("flow in use cannot be deleted", admin.call("DELETE", "/api/admin/flows", {"id": flow["id"]}).status_code == 409)
    bad_pattern = admin.call("POST", "/api/admin/document-types", {"code": "ZZ", "name": "Zed", "namingPattern": "{TYPE}-{SEQ:4}"})
    check("naming pattern without project/year refused", bad_pattern.status_code == 400)
    ff = admin.call("POST", "/api/admin/field-definitions", {"documentTypeId": MR["id"], "fieldKey": "mr_number", "label": "MR number", "dataType": "TEXT", "isRequired": True})
    check("custom field created", ff.status_code == 201, ff.text[:200])

    section("Clerk uploads")
    c = Client("clerk"); r = c.login("clerk@test.local", PW)
    check("clerk signs in and lands on /clerk", r.status_code == 200 and r.json().get("redirectTo") == "/clerk")
    sc = c.get("/api/sidebar-counts").json()
    check("sidebar: can upload, lists document types, no admin screens", sc["canUpload"] is True and len(sc["documentTypes"]) >= 10 and not any(sc["manage"].values()), sc)
    base = {"documentTypeId": MR["id"], "documentSubtypeId": CASH["id"], "projectId": p1["id"], "title": "Tyres", "submissionKey": "k1"}
    r = c.upload(base)
    check("missing required custom field refused", r.status_code == 400 and "MR number" in r.text, r.text[:200])
    r = c.upload({**base, "fieldValues": json.dumps({"mr_number": "MR-77"})}, files=[("files", ("test.pdf", PDF, "application/pdf"))])
    check("upload accepted (201, pending)", r.status_code == 201 and r.json()["documents"][0]["status"] == "PENDING", r.text[:300])
    doc = r.json()["documents"][0]
    check("document number from the pattern", re.fullmatch(r"MR-P1-\d{4}-0001", doc["documentNumber"]) is not None, doc["documentNumber"])
    again = c.upload({**base, "fieldValues": json.dumps({"mr_number": "MR-77"})})
    check("same submission key returns the existing document (200)", again.status_code == 200 and again.json()["documents"][0]["id"] == doc["id"], again.text[:200])
    check("clerk without access to project P2 cannot upload there", c.upload({**base, "projectId": p2["id"], "submissionKey": "k2", "fieldValues": json.dumps({"mr_number": "x"})}).status_code == 403)
    check("clerk can download own file", c.get(f"/api/documents/{doc['id']}/download").status_code == 200)

    section("Engineer and manager approve")
    e = Client("eng"); e.login("eng@test.local", PW)
    e2 = Client("eng2"); e2.login("eng2@test.local", PW)
    m = Client("mgr"); m.login("mgr@test.local", PW)
    page = e.get("/approver/pending-approvals")
    check("engineer's pending page lists the document", page.status_code == 200 and doc["documentNumber"] in page.text, page.status_code)
    check("engineer with no assignment sees no task", doc["documentNumber"] not in e2.get("/approver/pending-approvals").text)
    check("engineer opens the review screen", e.get(f"/approver/review/{doc['id']}").status_code == 200)
    r = e2.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "APPROVE"}, files=[("file", ("signed.pdf", PDF, "application/pdf"))])
    check("engineer without assignment cannot approve (403)", r.status_code == 403, (r.status_code, r.text[:200]))
    r = e.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "APPROVE"})
    check("approve without the signed file refused", r.status_code == 400)
    r = e.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "APPROVE", "comments": "ok"}, files=[("file", ("signed.pdf", PDF, "application/pdf"))])
    check("engineer approves level 1", r.status_code == 200 and r.json()["result"]["currentWorkflowStep"] == 2, r.text[:300])
    r = m.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "REQUEST_REVISION", "comments": "fix", "targetLevel": "1"})
    check("manager sends it back to level 1", r.status_code == 200 and r.json()["result"]["currentWorkflowStep"] == 1, r.text[:300])
    r = e.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "REQUEST_REVISION", "comments": "to uploader", "targetLevel": "0"})
    check("engineer sends it to the uploader (status revision)", r.status_code == 200 and r.json()["result"]["status"] == "REVISION_REQUIRED", r.text[:300])
    check("clerk's revision screen renders", c.get(f"/approver/review/{doc['id']}").status_code == 200)
    r = c.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "RESUBMIT", "comments": "fixed"}, files=[("file", ("v2.pdf", PDF, "application/pdf"))])
    check("clerk resubmits", r.status_code == 200 and r.json()["result"]["status"] == "PENDING", r.text[:300])
    for who, name in ((e, "engineer"), (m, "manager")):
        r = who.s.post(BASE + f"/api/documents/{doc['id']}/actions", data={"decision": "APPROVE"}, files=[("file", ("s.pdf", PDF, "application/pdf"))])
        check(f"{name} approves second pass", r.status_code == 200, r.text[:200])
    check("document is approved", r.json()["result"]["status"] == "APPROVED", r.text[:200])
    check("approved document detail page renders for the clerk", c.get(f"/documents/{doc['id']}").status_code == 200)

    section("Pages render for every user type")
    for path in ["/clerk", "/clerk/my-documents", "/clerk/my-documents?documentType=MR", "/new-document", "/processes", "/clerk/settings"]:
        check(f"clerk {path}", c.get(path).status_code == 200, c.get(path).status_code)
    for path in ["/approver", "/approver/my-documents", "/approver/approved-documents", "/approver/rejected-documents", "/approver/archive", "/approver/settings"]:
        check(f"engineer {path}", e.get(path).status_code == 200, e.get(path).status_code)
    for path in ["/admin", "/admin/all-documents", "/admin/pending-approvals", "/admin/approved-documents", "/admin/rejected-documents", "/admin/archive", "/admin/users", "/admin/document-types", "/admin/flows", "/admin/flow-assignments", "/admin/processes", "/admin/roles", "/admin/delegations", "/admin/projects", "/admin/settings", f"/documents/{doc['id']}", "/processes", "/new-document"]:
        rr = admin.get(path); check(f"admin {path}", rr.status_code == 200, rr.status_code)
    allp = admin.get(f"/admin/all-documents?documentType=MR&documentSubtype=CASH")
    check("admin list shows the document with its project", doc["documentNumber"] in allp.text and "P1 - Project One" in allp.text)

    section("Who is kept out")
    check("clerk cannot open the flow builder", c.get("/admin/flows").status_code in (302, 307))
    check("clerk cannot call the flow API", c.call("GET", "/api/admin/flows").status_code == 403)
    check("clerk cannot open admin dashboard", c.get("/admin").status_code in (302, 307))
    check("anonymous gets 401 from the API", requests.get(BASE + "/api/sidebar-counts").status_code == 401)
    check("write without CSRF header is refused", admin.s.post(BASE + "/api/admin/locations", json={"name": "X"}, headers={"x-csrf-token": None}).status_code == 403)

    section("Receipt, archive, deletion request")
    check("nobody has receipt permission yet (403)", c.call("POST", f"/api/documents/{doc['id']}/received").status_code == 403)
    rc = roles["Receiving Clerk"]
    admin.call("POST", "/api/admin/assignments", {"userId": clerk["id"], "roleId": rc, "documentTypeId": MR["id"]})
    r = c.call("POST", f"/api/documents/{doc['id']}/received")
    check("clerk with the Receiving Clerk role confirms receipt", r.status_code == 200 and r.json().get("receivedByName") == "clerk", r.text[:200])
    check("archive needs the permission (403)", c.call("POST", f"/api/documents/{doc['id']}/archive", {"archived": True}).status_code == 403)
    r = admin.call("POST", f"/api/documents/{doc['id']}/archive", {"archived": True})
    check("admin archives the approved document", r.status_code == 200 and r.json()["status"] == "ARCHIVED", r.text[:200])
    check("archive list shows it", doc["documentNumber"] in admin.get("/admin/archive").text)
    admin.call("POST", f"/api/documents/{doc['id']}/archive", {"archived": False})
    r = c.call("POST", "/api/documents/deletion-requests", {"ids": [doc["id"]]})
    check("clerk without delete permission cannot request deletion", r.status_code == 403, r.text[:200])

    section("Process run end to end")
    COMP = types["COMP"]
    pr = admin.call("POST", "/api/admin/processes", {"name": "Procurement", "steps": [{"name": "Comp sheet", "documentTypeId": COMP["id"]}, {"name": "Material req", "documentTypeId": MR["id"], "documentSubtypeId": CASH["id"]}]})
    check("process created", pr.status_code == 201, pr.text[:200])
    proc = pr.json()["process"]
    check("clerk cannot start it without the permission", c.call("POST", "/api/processes", {"processDefinitionId": proc["id"], "projectId": p1["id"]}).status_code == 403)
    run = admin.call("POST", "/api/processes", {"processDefinitionId": proc["id"], "projectId": p1["id"], "reference": "Tyres"})
    check("admin starts a run", run.status_code == 201, run.text[:200])
    rid = run.json()["run"]["id"]
    admin.call("POST", "/api/admin/assignments", {"userId": clerk["id"], "roleId": roles["Editor"], "projectId": p1["id"]})
    compdoc = c.upload({"documentTypeId": COMP["id"], "projectId": p1["id"], "title": "Comp", "processInstanceId": rid, "documentSubtypeId": next(s for s in COMP["subtypes"] if s["code"] == "SPARE_PARTS")["id"]})
    check("comp sheet uploaded into step 1 (auto-approved)", compdoc.status_code == 201 and compdoc.json()["documents"][0]["status"] == "APPROVED", compdoc.text[:300])
    detail = admin.call("GET", f"/api/processes/{rid}").json()["run"]
    check("run advanced to step 2", detail["currentStepNumber"] == 2 and detail["steps"][0]["currentDocument"]["status"] == "APPROVED", detail["currentStepNumber"])
    check("run page renders", admin.get(f"/processes/{rid}").status_code == 200)
    pk = admin.s.get(BASE + f"/api/processes/{rid}/package-download")
    check("package downloads as a PDF", pk.status_code == 200 and pk.headers.get("content-type") == "application/pdf", (pk.status_code, pk.text[:100]))
    lk = admin.call("GET", f"/api/documents/linkable?documentTypeId={MR['id']}&documentSubtypeId={CASH['id']}&search=MR-P1").json()
    check("existing documents can be found for a step", any(x["id"] == doc["id"] for x in lk["documents"]), lk)
    check("existing approved MR fills step 2 and completes the run", admin.call("POST", f"/api/processes/{rid}/link", {"documentId": doc["id"]}).status_code == 201)
    check("run is completed", admin.call("GET", f"/api/processes/{rid}").json()["run"]["status"] == "COMPLETED")
    check("document detail now shows the process run", "Procurement" in admin.get(f"/documents/{doc['id']}").text)

    section("Delegation")
    admin.call("POST", "/api/admin/delegations", {"delegatorUserId": mgr["id"], "delegateUserId": eng2["id"], "reason": "leave"})
    d2 = c.upload({**base, "submissionKey": "k9", "fieldValues": json.dumps({"mr_number": "MR-88"})}).json()["documents"][0]
    e.s.post(BASE + f"/api/documents/{d2['id']}/actions", data={"decision": "APPROVE"}, files=[("file", ("s.pdf", PDF, "application/pdf"))])
    r = e2.s.post(BASE + f"/api/documents/{d2['id']}/actions", data={"decision": "APPROVE"}, files=[("file", ("s.pdf", PDF, "application/pdf"))])
    check("delegate approves for the manager", r.status_code == 200 and r.json()["result"]["status"] == "APPROVED", r.text[:200])
    hist = admin.get(f"/documents/{d2['id']}").text
    check("history says on behalf of the manager", "on behalf of mgr" in hist, "")

print(f"\n{passed} checks passed, {failed} failed.")
sys.exit(0 if failed == 0 else 1)
