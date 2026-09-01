#!/usr/bin/env python3
"""
Does every shop's SMTP account actually authenticate.

Proves the credential and NOTHING ELSE. It opens the connection, upgrades to TLS,
logs in, and quits. No message is composed, no recipient is named, no DATA is
sent. That matters: these are the client's live sending accounts and every shop on
the new server still points at a catcher on purpose, because a copy of a live shop
that can send mail will eventually send a real order confirmation to a real
customer from a test box.

Why do it before cutover rather than during: mail switches per shop at each move,
at his quiet hour. A password that turns out to be wrong at 2am is a shop that
takes orders and tells nobody. A password that is wrong now is a message to him
over lunch.

Reads the gitignored file written by script/save_smtp_task.py. Prints no
credential, only which shop authenticated.

  python3 script/check_smtp_credentials.py tmp/smtp-per-shop-2026-08-27.md
"""

import re
import smtplib
import ssl
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "tmp/smtp-per-shop.md"
text = open(path, encoding="utf8").read()

# Parse the shop blocks. A block is a hostname on its own line followed by its
# settings, which is the shape he writes them in.
blocks = []
current = None
for raw in text.splitlines():
    line = raw.strip()
    if re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.(shop|nz|com|au|ca|us|com\.au)", line):
        current = {"shop": line}
        blocks.append(current)
        continue
    if current is None:
        continue
    m = re.match(r"(?i)(SMTP_USERNAME|SMTP_PASSWORD|SMTP_SERVER|SMTP_DOMAIN)\s*=\s*(\S+)", line)
    if m:
        current[m.group(1).upper()] = m.group(2)
        continue
    m = re.match(r"(?i)port:?\s*(\d{2,5})", line)
    if m:
        current["PORT"] = int(m.group(1))

blocks = [b for b in blocks if b.get("SMTP_USERNAME") and b.get("SMTP_PASSWORD")]
if not blocks:
    sys.exit(f"no shop blocks with a username and password found in {path}")

print(f"  {len(blocks)} shop account(s) to check, no mail will be sent\n")

ctx = ssl.create_default_context()
failed = 0

for b in blocks:
    shop = b["shop"]
    host = b.get("SMTP_SERVER", "smtp.maileroo.com")
    port = b.get("PORT", 587)
    try:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
            s.login(b["SMTP_USERNAME"], b["SMTP_PASSWORD"])
            # Quit without ever calling sendmail. Nothing is delivered.
            status = "ok"
    except smtplib.SMTPAuthenticationError as e:
        status = f"AUTH REFUSED  {e.smtp_code}"
        failed += 1
    except Exception as e:  # noqa: BLE001 - the reason is what we want to print
        status = f"FAILED  {type(e).__name__}: {str(e)[:60]}"
        failed += 1
    # The username is printed only as its local part and domain, which is the
    # part he already publishes as the from address. The password never appears.
    print(f"    {status:<28} {shop:<24} as {b['SMTP_USERNAME']}")

print()
if failed:
    print(f"  {failed} of {len(blocks)} did not authenticate")
    sys.exit(1)
print(f"  all {len(blocks)} authenticate")
