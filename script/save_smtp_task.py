#!/usr/bin/env python3
"""
Save the client's per-shop SMTP details out of the tracker, into a gitignored file.

Written as a file rather than typed into a shell because the first attempt was a
python -c inside a zsh command substitution: zsh ate the string concatenation and
wrote a six line file with zero credentials in it, and reported success. A
credentials file that is silently empty is worse than none, because the next
person reads "saved" and stops looking.

Nothing here prints a credential. It prints which shops are covered and what is
missing, which is the only part worth reading aloud.
"""

import html
import json
import os
import re
import sys
import urllib.request

URL = os.environ["ACTIVECOLLAB_URL"]
TOKEN = os.environ["ACTIVECOLLAB_TOKEN"]
TASK = sys.argv[1] if len(sys.argv) > 1 else "4455"
OUT = sys.argv[2] if len(sys.argv) > 2 else "tmp/smtp-per-shop.md"

req = urllib.request.Request(
    f"{URL}/api/v1/projects/264/tasks/{TASK}",
    headers={"X-Angie-AuthApiToken": TOKEN},
)
with urllib.request.urlopen(req, timeout=60) as r:
    data = json.load(r)

task = data.get("single") or data
body = task.get("body") or ""
body = re.sub(r"<br ?/?>|</p>|</li>|</div>|</h\d>", "\n", html.unescape(body))
body = re.sub(r"<[^>]+>", "", body)
body = re.sub(r"\n{3,}", "\n\n", body).strip()

if not body:
    sys.exit(f"task {TASK} has an empty body: nothing saved")

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
with open(OUT, "w", encoding="utf8") as f:
    f.write(f"# {task.get('name')} — ActiveCollab task {TASK}\n\n")
    f.write(
        "**Gitignored on purpose.** These are the client's live mail credentials.\n"
        "They sit in plain text in the tracker body, which keeps its history after\n"
        "an edit, and he has been asked to rotate them there.\n\n"
    )
    f.write("```\n" + body + "\n```\n")
os.chmod(OUT, 0o600)

users = re.findall(r"(?i)SMTP_USERNAME\s*=\s*(\S+)", body)
passwords = re.findall(r"(?i)SMTP_PASSWORD\s*=\s*(\S+)", body)
hosts = set(re.findall(r"(?i)SMTP_SERVER\s*=\s*(\S+)", body))
ports = set(re.findall(r"(?i)port:?\s*(\d{2,5})", body))

# The shops come from .estate, which is gitignored because it names them. This
# repository is public, so no shop, brand or domain may be written here: an
# earlier version listed all eight and was caught by check_no_client_data before
# it was committed.
def expected_shops():
    rows = []
    try:
        with open(".estate", encoding="utf8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" in line.split("|")[0]:
                    continue
                cols = line.split("|")
                if len(cols) >= 8 and cols[7].startswith("http"):
                    rows.append(cols[7].split("//", 1)[1].rstrip("/"))
    except FileNotFoundError:
        pass
    return rows


EXPECTED = expected_shops()
if not EXPECTED:
    print("  .estate not readable: reporting what the task contains, not what is missing")
named = [s for s in EXPECTED if re.search(rf"(?m)^\s*{re.escape(s)}\s*$", body)]
missing = [s for s in EXPECTED if s not in named]

print(f"  saved {OUT} ({os.path.getsize(OUT)} bytes, mode 600)")
print(f"  usernames: {len(users)}   passwords: {len(passwords)}")
print(f"  hosts: {', '.join(sorted(hosts))}   ports: {', '.join(sorted(ports))}")
print(f"  shops named: {len(named)}/{len(EXPECTED)}")
for s in named:
    print(f"    ok      {s}")
for s in missing:
    print(f"    MISSING {s}")

# Every sender on its own send. subdomain matters: on the other estate the store
# subdomain carried no SPF record, so mail from it sent fine and failed SPF, and
# a p=quarantine DMARC policy put it in spam with nothing in any log to say why.
not_send = [u for u in users if "@send." not in u]
if not_send:
    print(f"  {len(not_send)} sender(s) NOT on a send. subdomain — check the SPF record for those")
else:
    print("  every sender is on its own send. subdomain")

if len(users) != len(passwords) or len(users) != len(named):
    sys.exit("  counts disagree: read the file, one shop's block is malformed")
