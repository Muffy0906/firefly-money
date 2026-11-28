# Money: a modern frontend for Firefly III.
# nginx fills in FIREFLY_URL / FIREFLY_TOKEN from the environment at startup; app/session.js reads DASH_PASSWORD.

# Build stage: bundles the TypeScript in app/src into app/assets/js. Only its output goes into the image.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json build.mjs ./
COPY app/src app/src
RUN npm run check && npm run build

FROM nginx:1.31-alpine

# Which build this is, e.g. "c78fd51 · 2026-09-30" (set by the GitHub workflow). Shown in Settings → About.
ARG MONEY_VERSION=""
ENV MONEY_VERSION="${MONEY_VERSION}"
# Port nginx listens on inside the container. Change it when running as a non-root user on a host
# that doesn't let such users bind ports below 1024.
ENV LISTEN_PORT=80
# Where the most-used pages are kept (a few bytes). Mount a volume here to keep them across updates.
ENV MONEY_DATA=/data
# The nginx entrypoint reads the container's DNS servers into NGINX_LOCAL_RESOLVERS (for the /api/ proxy).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV NGINX_ENVSUBST_FILTER="^(FIREFLY_URL|FIREFLY_TOKEN|MONEY_VERSION|LISTEN_PORT|NGINX_LOCAL_RESOLVERS)$"

COPY app/nginx.conf /etc/nginx/nginx.conf
COPY app/session.js /etc/nginx/money/session.js
COPY app/ingest.js /etc/nginx/money/ingest.js
COPY app/pages.js /etc/nginx/money/pages.js
COPY app/default.conf.template /etc/nginx/templates/default.conf.template
COPY app/index.html /etc/nginx/templates/index.html.template
COPY app/404.html /etc/nginx/templates/404.html.template
COPY app/privacy.html /etc/nginx/templates/privacy.html.template
# Stylesheet as it is, and the bundled scripts from the build stage, served from /assets/
COPY app/assets /usr/share/nginx/html/assets
COPY --from=build /src/app/assets/js /usr/share/nginx/html/assets/js

# Also runs as any non-root user (e.g. `user: "568:568"`): app/nginx.conf puts the pid file in /tmp, and the
# folders nginx writes to at startup (the filled-in config and page, its cache) are writable by everyone.
RUN rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /data && chmod 1777 /etc/nginx/conf.d /var/cache/nginx /data
VOLUME /data

LABEL org.opencontainers.image.title="Money" \
      org.opencontainers.image.description="A modern, mobile-friendly frontend for Firefly III" \
      org.opencontainers.image.licenses="MIT"

EXPOSE 80
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:${LISTEN_PORT}/ || exit 1
