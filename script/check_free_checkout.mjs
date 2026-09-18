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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// An address each shop's own country accepts. Postcodes are validated per
// country, so one address for all of them does not work: a Canadian shop
// rejects "4000" and quotes no postage.
//
// The hostnames are NOT here. They name the client and this repository is
// public, so they are read from .estate, which is gitignored for that reason.
// script/check_no_client_data refused this file until they were.
const ADDRESSES = {
  au: {
    country: "Australia",
    city: "Brisbane",
    state: "Queensland",
    postal: "4000",
    phone: "0400000000",
  },
  ca: {
    country: "Canada",
    city: "Toronto",
    state: "Ontario",
    postal: "M5H 2N2",
    phone: "4160000000",
  },
  us: {
    country: "United States",
    city: "New York",
    state: "New York",
    postal: "10001",
    phone: "2120000000",
  },
  nz: {
    country: "New Zealand",
    city: "Auckland",
    state: null,
    postal: "1010",
    phone: "0210000000",
  },
  nolocal: {
    country: null, // sells to many, so the customer chooses
    city: "Auckland",
    state: null,
    postal: "1010",
    phone: "0210000000",
  },
};

// shop|database|directory|port|storefront port|review host|admin host|live url|code
const ESTATE = join(dirname(fileURLToPath(import.meta.url)), "..", ".estate");
const SHOPS = {};
for (const line of readFileSync(ESTATE, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#") || !line.includes("|")) continue;
  const f = line.split("|");
  const site = (f[7] || "").trim();
  if (!ADDRESSES[f[0]] || !site.startsWith("https://")) continue;
  SHOPS[f[0]] = { site: site.replace(/\/$/, ""), ...ADDRESSES[f[0]] };
}

const only = process.argv[2];
const names = only ? [only] : Object.keys(SHOPS);
let failed = 0;

for (const name of names) {
  const shop = SHOPS[name];
  if (!shop) {
    console.log(`${name}: not in the table`);
    failed++;
    continue;
  }
  const slug = process.env[`FREE_SLUG_${name.toUpperCase()}`];
  if (!slug) {
    console.log(`${name}: no free product given. Set FREE_SLUG_${name.toUpperCase()}`);
    failed++;
    continue;
  }

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
    if (preselected && shop.country && preselected !== shop.country)
      problems.push(`the country box opens on ${preselected}, not ${shop.country}`);

    // Chosen explicitly, because the point of this walk is the free item and a
    // wrong country turns every later step into noise.
    const countrySel = page.locator("#ship-country").first();
    if ((await countrySel.count()) && shop.country)
      await countrySel.selectOption({ label: shop.country }).catch(() => {});
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

console.log(
  failed
    ? `\n${failed} shop(s) cannot sell a free product`
    : `\nevery shop checked can sell a free product`,
);
process.exit(failed ? 1 : 0);
