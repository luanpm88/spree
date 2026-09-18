#!/usr/bin/env node
//
// A cart with a free item in it must reach the payment step.
//
//   node script/check_free_checkout.mjs                 every shop in the table
//   node script/check_free_checkout.mjs au              one shop
//
// ── the fault this exists for ────────────────────────────────────────────────
//
// The client reported twice that a customer could not buy a free product. The
// checkout showed Express Checkout when `cart.total` was positive, and postage
// is inside that total, while Stripe was handed the sum of the line items,
// which excludes postage because the Element quotes it itself. A cart of only
// free items with postage charged made the two disagree: the button mounted,
// Stripe got `amount: 0` and threw inside a render, and the error boundary
// replaced the checkout with "Something went wrong".
//
// Every gate in this repo was green through both reports. check_storefront_e2e
// adds to cart and stops at the cart. The failure is two steps further on, and
// only after a shipping address exists, because before that the total is 0 and
// nothing mounts at all.
//
// So this walks the whole way: product, cart, checkout, address, shipping
// method, payment. It STOPS at Pay Now. These are the client's live shops and a
// real payment terminal.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Two tables, both gitignored, both read rather than typed here.
//
//   .estate                          which shops exist and their live urls
//   config/checkout_probe_addresses  an address each shop's country accepts
//
// They are not in this file because they name the client and this repository is
// public: check_no_client_data refused the file twice while they were, once for
// the hostnames and once for a shop key.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const readTable = (name) => {
  const rows = [];
  for (const line of readFileSync(join(ROOT, name), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#") || !line.includes("|")) continue;
    rows.push(line.split("|").map((f) => f.trim()));
  }
  return rows;
};

const dash = (v) => (v && v !== "-" ? v : null);

// Which product to walk with.
//
// Asked of the shop rather than written down anywhere. A slug in a config file
// is a slug that is wrong the first time he renames a product, and this check
// then reports a shop that cannot sell when the truth is that a file is stale.
// The shop is the only thing that knows what it is currently selling for
// nothing, so the shop is asked. Same ssh settings as every other check here.
const ssh = (() => {
  if (!existsSync(join(ROOT, ".estate.env"))) return null;
  const env = {};
  for (const line of readFileSync(join(ROOT, ".estate.env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    // The file is meant for `set -a; . ./.estate.env`, so the values are shell:
    // quoted, and the key path is written with $HOME in it. Reading them as
    // plain text gave ssh the literal string $HOME and a port with quotes round
    // it, and every shop then came back as having no free product.
    env[m[1]] = m[2]
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^\$HOME|^~/, homedir());
  }
  if (!env.SSH_KEY || !env.SSH_HOST) return null;
  return (command) =>
    execFileSync(
      "ssh",
      ["-n", "-i", env.SSH_KEY, "-p", env.SSH_PORT || "22",
       "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", env.SSH_HOST, command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
})();

// Three answers, and the difference between the last two is the whole point:
// a slug, "this shop sells nothing for nothing", or "I could not ask". The
// first version returned null for the last two alike and printed a green run
// with six shops skipped while the ssh command was failing on every one of
// them. A check that cannot tell those apart is worse than no check.
const freeProductOn = (shop) => {
  const fromEnv = process.env[`FREE_SLUG_${shop.toUpperCase()}`];
  if (fromEnv) return { slug: fromEnv };
  if (!ssh) return { unknown: "there is no .estate.env on this machine" };
  // status active and the product not deleted, because a free variant on a
  // draft product is not something a customer can reach.
  const ruby =
    "v = Spree::Variant.joins(:prices).where(spree_prices: { amount: 0 })" +
    ".where(deleted_at: nil).detect { |x| x.product && x.product.deleted_at.nil?" +
    " && x.product.status == %q{active} }; " +
    "print %q{<<S:} + (v ? v.product.slug : %q{}) + %q{:S>>}";
  try {
    const out = ssh(`docker exec ${shop}_web bin/rails runner '${ruby}' 2>/dev/null`);
    const found = out.match(/<<S:(.*):S>>/);
    if (!found) return { unknown: "the shop answered nothing at all" };
    return found[1] ? { slug: found[1] } : { none: true };
  } catch (e) {
    return { unknown: String(e.message).split("\n")[0].slice(0, 80) };
  }
};

const ADDRESSES = {};
for (const [shop, opensOn, pick, city, state, postal, phone] of readTable(
  "config/checkout_probe_addresses",
)) {
  ADDRESSES[shop] = {
    country: dash(opensOn),
    pick: dash(pick) ?? dash(opensOn),
    city,
    state: dash(state),
    postal,
    phone,
  };
}

// shop|database|directory|port|storefront port|review host|admin host|live url|code
const SHOPS = {};
for (const f of readTable(".estate")) {
  const site = f[7] || "";
  if (!ADDRESSES[f[0]] || !site.startsWith("https://")) continue;
  SHOPS[f[0]] = { site: site.replace(/\/$/, ""), ...ADDRESSES[f[0]] };
}

// A shop in .estate with no address row is not walked, and saying nothing about
// it is the same silence this check exists to remove. The wholesale shop is the
// one: every page of it needs an account, so a guest walk cannot reach its
// checkout at all.
const unwalked = readTable(".estate")
  .map((f) => f[0])
  .filter((name) => name && !SHOPS[name]);

const only = process.argv[2];
const names = only ? [only] : Object.keys(SHOPS);
let failed = 0;
let skipped = 0;

for (const name of names) {
  const shop = SHOPS[name];
  if (!shop) {
    console.log(`${name}: not in the table`);
    failed++;
    continue;
  }
  // Two of the seven shops carry no free product at all, which is a fact about
  // the catalogue and not a fault. Counting it as a failure made a green run
  // impossible and would have trained somebody to ignore the last line.
  const found = freeProductOn(name);
  if (found.unknown) {
    console.log(`${name.padEnd(8)} FAILED   could not ask what it sells: ${found.unknown}`);
    failed++;
    continue;
  }
  if (found.none) {
    console.log(`${name.padEnd(8)} skipped  the shop says it sells nothing for nothing`);
    skipped++;
    continue;
  }
  const slug = found.slug;

  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  ).newPage();
  const stripeErrors = [];
  page.on("console", (m) => {
    if (/amount.*greater than 0|IntegrationError/i.test(m.text()))
      stripeErrors.push(m.text().slice(0, 120));
  });

  const problems = [];
  const crashed = () =>
    page.evaluate(() => /Something went wrong/i.test(document.body.innerText));

  try {
    await page.goto(`${shop.site}/products/${slug}`, {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    await page
      .getByRole("button", { name: /add to cart/i })
      .first()
      .click();
    await page.waitForTimeout(3000);

    await page.goto(`${shop.site}/cart`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);
    if (await crashed()) problems.push("the cart page crashed");

    await page
      .getByRole("link", { name: /proceed to checkout/i })
      .first()
      .click();
    await page.waitForTimeout(6000);
    if (await crashed()) problems.push("the checkout crashed on opening");

    const fill = async (sel, value) => {
      const l = page.locator(sel);
      if (await l.count()) {
        await l.first().click();
        await l.first().fill(value);
      }
    };
    // What the shop offers BEFORE anything is typed. On the us shop this came
    // back as American Samoa, which rejects a US zipcode and quotes no postage.
    const preselected = await page
      .locator("#ship-country")
      .first()
      .evaluate((el) => el.options[el.selectedIndex]?.text ?? "")
      .catch(() => "");
    if (shop.country) {
      if (preselected && preselected !== shop.country)
        problems.push(`the country box opens on ${preselected}, not ${shop.country}`);
    } else if (preselected && !/^select a country$/i.test(preselected)) {
      problems.push(
        `the country box opens on ${preselected}, and this shop sells to too many for any of them to be right`,
      );
    }

    // Chosen explicitly, because the point of this walk is the free item and a
    // wrong country turns every later step into noise.
    const carryOn = shop.pick ?? shop.country;
    const countrySel = page.locator("#ship-country").first();
    if ((await countrySel.count()) && carryOn)
      await countrySel.selectOption({ label: carryOn }).catch(() => {});
    await page.waitForTimeout(1500);

    await fill("#email", "probe@example.test");
    await fill("#ship-first_name", "Probe");
    await fill("#ship-last_name", "Test");
    await fill("#ship-address1", "1 Queen Street");
    await fill("#ship-city", shop.city);
    // Every shop here asks for a state or region, including the New Zealand
    // ones. Leaving it blank gives "Shipping address state can't be blank" and
    // no shipping quote, which this check first read as the shop being broken.
    const st = page.locator("#ship-state");
    if (await st.count()) {
      if (shop.state)
        await st
          .first()
          .selectOption({ label: shop.state })
          .catch(() => {});
      else
        await st
          .first()
          .evaluate((el) => {
            const real = [...el.options].find((o) => o.value);
            if (real) {
              el.value = real.value;
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          })
          .catch(() => {});
    }
    await fill("#ship-postal_code", shop.postal);
    await fill("#ship-phone", shop.phone);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(14000);

    // This is the step both reports died on.
    if (await crashed()) problems.push("the checkout crashed after the address");
    if (stripeErrors.length) problems.push(`stripe: ${stripeErrors[0]}`);

    // The shipping options are Radix radios: a <button role="radio">, not an
    // <input type=radio>. Counting inputs returns 0 on a checkout that is
    // working, and this check called the ca shop broken for exactly that
    // reason while the screenshot showed Standard Postage selected at $6.30.
    const shipping = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("h1,h2,h3,h4,legend")].find(
        (e) => /^shipping method$/i.test(e.textContent.trim()),
      );
      if (!heading) return { found: false };
      const block = heading.parentElement;
      const options = [...block.querySelectorAll('[role="radio"]')];
      const chosen = options.find((o) => o.getAttribute("aria-checked") === "true");
      return {
        found: true,
        count: options.length,
        chosen: Boolean(chosen),
        priced: /[$€£]\s?\d/.test(block.textContent),
      };
    });
    if (!shipping.found) problems.push("no Shipping Method section");
    else if (!shipping.count) problems.push("no shipping method offered");
    else if (!shipping.chosen) problems.push("a shipping method is offered but none is selected");
    else if (!shipping.priced) problems.push("the shipping method carries no price");

    // A shop that also ships the free item for nothing has a zero total, and
    // then there is no card to fill: the checkout says so and offers Place
    // Order. That is a working checkout, not a missing card field.
    const noPaymentNeeded = /no payment required/i.test(
      await page.locator("body").innerText(),
    );

    // Present is not the same as usable: the card field is an iframe from
    // Stripe and an empty one renders as a grey box that errors nowhere.
    let typed = false;
    try {
      const frame = page
        .frameLocator("iframe[title*='payment'], iframe[name*='__privateStripeFrame']")
        .first();
      await frame
        .locator("input[name='number'], input#Field-numberInput")
        .first()
        .fill("4242424242424242", { timeout: 20000 });
      typed = true;
    } catch (_) {}
    if (!typed && !noPaymentNeeded)
      problems.push("the card field would not take a number");

    const pay = page.getByRole("button", { name: /pay now|place order/i }).first();
    if (!(await pay.count())) problems.push("no pay button");
    else if (!(await pay.isEnabled())) problems.push("the pay button is disabled");

    await page.screenshot({
      path: `tmp/probe/free_checkout_${name}.png`,
      fullPage: true,
    });
  } catch (e) {
    problems.push(`threw: ${String(e.message).slice(0, 100)}`);
  }
  await browser.close();

  if (problems.length) {
    failed++;
    console.log(`${name.padEnd(8)} FAILED  ${problems.join("; ")}`);
  } else {
    console.log(`${name.padEnd(8)} ok      free item reaches Pay Now, card field takes a number`);
  }
}

for (const name of only ? [] : unwalked) {
  console.log(`${name.padEnd(8)} skipped  no address for it in config/checkout_probe_addresses`);
  skipped++;
}

const tail = skipped ? `, ${skipped} skipped` : "";
console.log(
  failed
    ? `\n${failed} shop(s) cannot sell a free product${tail}`
    : `\nevery shop with a free product can sell it${tail}`,
);
process.exit(failed ? 1 : 0);
