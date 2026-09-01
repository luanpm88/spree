# syntax=docker/dockerfile:1.7

# Multi-stage build for Next.js 16 (standalone output) on Node.js 22 (Alpine).
#
# Build (Spree env required: pages are prerendered against the Spree API at build time):
#   docker build \
#     --build-arg SPREE_API_URL=https://your-spree.example.com \
#     --build-arg SPREE_PUBLISHABLE_KEY=your_publishable_key \
#     -t storefront .
#
# Run:
#   docker run -p 3001:3001 --env-file .env.local storefront
#
# Optional Sentry source map upload at build time (skipped when SENTRY_DSN is unset).
# SENTRY_AUTH_TOKEN is read via a BuildKit secret so it never lands in image
# layers, history, or shared builder caches.
#   SENTRY_AUTH_TOKEN=... docker build \
#     --build-arg SPREE_API_URL=... \
#     --build-arg SPREE_PUBLISHABLE_KEY=... \
#     --build-arg SENTRY_DSN=... \
#     --build-arg SENTRY_ORG=... \
#     --build-arg SENTRY_PROJECT=... \
#     --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
#     -t storefront .

ARG NODE_VERSION=22-alpine


# ---- base: Node with pnpm (same version as package.json's `packageManager`) ----
FROM node:${NODE_VERSION} AS base
RUN npm install -g pnpm@10.33.4


# ---- deps: install production+dev dependencies for the build ----
FROM base AS deps
WORKDIR /app

# libc6-compat keeps a few native modules happy on Alpine (musl).
RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store


# ---- sharp: the image optimizer's native library, for the RUNTIME ----
#
# Next resizes images in a request handler, and it needs sharp to do it. The
# standalone output does not carry it: pnpm links sharp as a symlink into
# .pnpm/, and the build's dependency tracer does not follow that into the
# bundle. So the runner shipped without it and nothing said so.
#
# What that cost, measured on 25 August on the running shops:
#
#   every /_next/image response returned the ORIGINAL file at every requested
#   width. hero-au.jpg at w=256, w=384 and w=640 all came back as the same
#   263,993 bytes and decoded at 648 x 756. A phone drawing that picture 390px
#   wide downloaded all of it, and so did every visitor to all seven shops.
#
#   worse, a first request for an uncached size could hang and never answer.
#   Two of them were stuck when this was found: about.jpg at w=640 on one shop
#   and w=1080 on another, both 504 after 120 seconds, both fine again the
#   moment the container was restarted. Next dedupes concurrent requests for a
#   size, so once one hangs every later request for that same size hangs with
#   it, and the About photograph simply never appears at that width.
#
# Installed with npm rather than pnpm on purpose: npm writes a flat
# node_modules with real directories, which COPY can take. pnpm's symlink farm
# cannot be copied out of a build stage.
#
# The version is pinned to the one already in pnpm-lock.yaml, so this does not
# quietly introduce a second version of the same library.
FROM base AS sharp
WORKDIR /sharp
RUN apk add --no-cache libc6-compat \
 && npm install --no-package-lock --no-save sharp@0.35.3


# ---- builder: compile the Next.js app ----
FROM base AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Spree API config — required at build time because the app prerenders pages
# that fetch from Spree (categories, products, etc.).
ARG SPREE_API_URL
ARG SPREE_PUBLISHABLE_KEY
ENV SPREE_API_URL=$SPREE_API_URL \
    SPREE_PUBLISHABLE_KEY=$SPREE_PUBLISHABLE_KEY

# NEXT_PUBLIC_* is inlined into the bundle at BUILD time, not read at runtime.
# Passing these only in the compose `environment:` block does nothing at all, and
# does it silently, which is the sort of setting that looks configured and is not.
ARG NEXT_PUBLIC_LOGO_URL=""
ARG NEXT_PUBLIC_STORE_NAME=""
ARG NEXT_PUBLIC_SITE_URL=""
# Contact page wording and form. Docker silently ignores a build arg the Dockerfile
# does not declare, so compose passed these three correctly, the build ignored them,
# and the page shipped with its neutral defaults and no form. Nothing failed.
ARG NEXT_PUBLIC_CONTACT_FORM_URL=""
ARG NEXT_PUBLIC_CONTACT_TITLE=""
ARG NEXT_PUBLIC_CONTACT_INTRO=""
# The same omission again, found while building a second shop. The code reads
# sixteen NEXT_PUBLIC_ names and this file declared six, so the ten below were
# accepted on the command line and dropped. DEFAULT_COUNTRY is the one that
# showed it: the Canada storefront redirected / to /us/en, because "us" is the
# fallback in src/lib/store.ts and the build never saw the ca that was passed.
#
# script/check_storefront_args.sh compares this list against what the source
# actually reads, so the next missing one fails a check instead of shipping.
ARG NEXT_PUBLIC_DEFAULT_COUNTRY=""
ARG NEXT_PUBLIC_DEFAULT_LOCALE=""
ARG NEXT_PUBLIC_STORE_DESCRIPTION=""
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID=""
ARG NEXT_PUBLIC_ADYEN_CLIENT_KEY=""
ARG NEXT_PUBLIC_ADYEN_ENVIRONMENT=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=""
ARG NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=""
# The category ids behind the home page product rows. Per shop, so they cannot
# be constants in the source, and NEXT_PUBLIC_ because the block list is built
# during the render. Declared here for the same reason as everything above: an
# undeclared build arg is accepted on the command line and dropped in silence.
ARG NEXT_PUBLIC_CATEGORY_STANDOUTS=""
ARG NEXT_PUBLIC_CATEGORY_COMBOS=""
ARG NEXT_PUBLIC_CATEGORY_NEW=""
# The wholesale shop is closed to anyone without an account: a URL forwarded to
# someone outside must show them nothing. Empty for the retail shops, which are
# open, so this changes nothing for them. If the arg were dropped here the gate
# would build as "off" and the shop would look correct while being open, which
# is the failure that is hardest to notice by looking at it.
ARG NEXT_PUBLIC_REQUIRE_ACCOUNT=""
ARG NEXT_PUBLIC_CLEAN_URLS=""
ARG NEXT_PUBLIC_PUBLIC_PATHS=""
ENV NEXT_PUBLIC_LOGO_URL=$NEXT_PUBLIC_LOGO_URL \
    NEXT_PUBLIC_STORE_NAME=$NEXT_PUBLIC_STORE_NAME \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CONTACT_FORM_URL=$NEXT_PUBLIC_CONTACT_FORM_URL \
    NEXT_PUBLIC_CONTACT_TITLE=$NEXT_PUBLIC_CONTACT_TITLE \
    NEXT_PUBLIC_CONTACT_INTRO=$NEXT_PUBLIC_CONTACT_INTRO \
    NEXT_PUBLIC_DEFAULT_COUNTRY=$NEXT_PUBLIC_DEFAULT_COUNTRY \
    NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE \
    NEXT_PUBLIC_STORE_DESCRIPTION=$NEXT_PUBLIC_STORE_DESCRIPTION \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID \
    NEXT_PUBLIC_ADYEN_CLIENT_KEY=$NEXT_PUBLIC_ADYEN_CLIENT_KEY \
    NEXT_PUBLIC_ADYEN_ENVIRONMENT=$NEXT_PUBLIC_ADYEN_ENVIRONMENT \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=$NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII \
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=$NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL \
    NEXT_PUBLIC_CATEGORY_STANDOUTS=$NEXT_PUBLIC_CATEGORY_STANDOUTS \
    NEXT_PUBLIC_CATEGORY_COMBOS=$NEXT_PUBLIC_CATEGORY_COMBOS \
    NEXT_PUBLIC_CATEGORY_NEW=$NEXT_PUBLIC_CATEGORY_NEW \
    NEXT_PUBLIC_REQUIRE_ACCOUNT=$NEXT_PUBLIC_REQUIRE_ACCOUNT \
    NEXT_PUBLIC_CLEAN_URLS=$NEXT_PUBLIC_CLEAN_URLS \
    NEXT_PUBLIC_PUBLIC_PATHS=$NEXT_PUBLIC_PUBLIC_PATHS

# Optional Sentry release/source-map upload. When SENTRY_DSN is empty,
# next.config.ts skips withSentryConfig entirely, so the build still works.
# SENTRY_AUTH_TOKEN is intentionally not declared as ARG/ENV — it's mounted
# only for the build step via --mount=type=secret below, so it never persists
# in image layers or build cache.
ARG SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV SENTRY_DSN=$SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm run build


# ---- runner: minimal runtime image ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Static assets and the standalone server bundle.
# The standalone output ships its own minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# sharp last, so it merges into the node_modules the standalone output brought
# with it. That directory does not contain sharp, so nothing is overwritten.
# Alpine is musl, so libc6-compat has to be here too and not only in the stage
# that installed the package.
RUN apk add --no-cache libc6-compat
COPY --from=sharp --chown=nextjs:nodejs /sharp/node_modules ./node_modules

# Proven at build time, not hoped for at request time.
#
# A missing sharp does not crash the server and does not log: it degrades to
# handing back the original file, which looks entirely correct in a browser and
# in a screenshot. The only way it shows is by measuring the bytes, and it went
# unnoticed on seven shops until an unrelated check timed out on an image.
#
# It RESIZES something rather than merely resolving. require() alone passes
# while the native musl binary is missing or built for the wrong architecture,
# and that failure appears at the first request rather than here.
RUN node -e "const s=require('sharp'); \
  s({create:{width:64,height:64,channels:3,background:'#ffffff'}}) \
    .resize(32).jpeg().toBuffer() \
    .then(b=>{ if(!b||b.length<100) throw new Error('sharp returned nothing'); \
               console.log('sharp '+s.versions.sharp+' resized a test image in the runtime, '+b.length+' bytes'); }) \
    .catch(e=>{ console.error('sharp cannot resize in the runtime image:', e.message); process.exit(1); })"

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
