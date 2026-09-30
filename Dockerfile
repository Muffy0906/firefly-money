# Money: a modern frontend for Firefly III.
# nginx fills in FIREFLY_URL / FIREFLY_TOKEN / DASH_PASSWORD from the environment at startup.
FROM nginx:1.27-alpine

# Which build this is, e.g. "c78fd51 · 2026-09-30" (set by the GitHub workflow). Shown in Settings → About.
ARG MONEY_VERSION=""
ENV MONEY_VERSION="${MONEY_VERSION}"
ENV NGINX_ENVSUBST_FILTER="^(FIREFLY_URL|FIREFLY_TOKEN|DASH_PASSWORD|MONEY_VERSION)$"

COPY app/default.conf.template /etc/nginx/templates/default.conf.template
COPY app/index.html /etc/nginx/templates/index.html.template
# Stylesheet and scripts: plain files, served as they are from /assets/
COPY app/assets /usr/share/nginx/html/assets

LABEL org.opencontainers.image.title="Money" \
      org.opencontainers.image.description="A modern, mobile-friendly frontend for Firefly III" \
      org.opencontainers.image.licenses="PolyForm-Strict-1.0.0"

EXPOSE 80
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
