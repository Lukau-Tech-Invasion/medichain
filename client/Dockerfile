# Builds both portals and bakes them into the nginx image that fronts the API.
#
# Before this existed, `docker compose up` gave you a bare nginx 404 at `/`:
# the compose stack ran the API and infrastructure but nothing served a
# frontend, so demonstrating the system meant telling someone to run two Vite
# dev servers by hand. A clinic demo cannot start that way.
#
# BUILD CONTEXT IS THE REPO ROOT, not client/ — the image needs nginx/ as well
# as client/, and COPY cannot escape the context. See docker-compose.yml.
#
# Both apps build from the client/ workspace root because they import
# ../shared/src through a Vite alias; building from either app directory alone
# would not resolve those imports.

FROM node:20-alpine AS build
WORKDIR /build

# Install once for the whole workspace. Manifests first so this layer stays
# cached until a dependency actually changes.
COPY client/package.json client/package-lock.json ./
COPY client/shared/package.json        shared/package.json
COPY client/doctor-portal/package.json doctor-portal/package.json
COPY client/patient-app/package.json   patient-app/package.json
RUN npm ci --no-audit --fund=false

COPY client/ .

# Docker's local presentation profile may explicitly bake the seeded-account
# buttons in. Production remains fail-closed unless its deployment opts in.
ARG VITE_DEMO_CREDENTIALS_ENABLED=false
ENV VITE_DEMO_CREDENTIALS_ENABLED=$VITE_DEMO_CREDENTIALS_ENABLED
# Presentation build: shows the labelled "Demo accounts" sign-in shortcut.
# Off unless docker-compose.demo.yml (or a deliberate override) sets it.
ARG VITE_EMERGENCY_NUMBER=112
ENV VITE_EMERGENCY_NUMBER=$VITE_EMERGENCY_NUMBER

ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

# VITE_BASE_PATH drives Vite's `base` AND (via import.meta.env.BASE_URL) the
# react-router basename, so each app's sub-path is defined in exactly one place.
RUN VITE_BASE_PATH=/doctor/  npm run build --workspace=doctor-portal \
 && VITE_BASE_PATH=/patient/ npm run build --workspace=patient-app

# The Content-Security-Policy names each inline script by the hash of the BUILT
# file (scripts/csp-header.mjs), so it always matches what is served.
RUN node scripts/csp-header.mjs /build/csp.conf \
      doctor-portal/dist/index.html patient-app/dist/index.html landing.html

FROM nginx:1.27-alpine AS runtime

# Portals are served from sub-paths of one origin so they share the `/api`
# proxy and same-origin cookies. `apiUrl()` resolves to window.location.origin
# in a production build, so no VITE_API_URL is needed.
COPY --from=build /build/doctor-portal/dist /usr/share/nginx/html/doctor
COPY --from=build /build/patient-app/dist   /usr/share/nginx/html/patient
COPY client/landing.html                    /usr/share/nginx/html/index.html

# Baked in rather than bind-mounted so the image is self-contained: `docker
# compose up` needs no host files to serve correctly.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/csp.conf /etc/nginx/snippets/csp.conf
# Fills the telehealth origin into the policy from JITSI_DOMAIN at start-up.
COPY --chmod=755 nginx/40-csp-telehealth.sh /docker-entrypoint.d/40-csp-telehealth.sh

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz > /dev/null 2>&1 || exit 1
