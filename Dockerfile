FROM node:20-alpine

WORKDIR /app

# Stabile Assets zuerst, damit Code-Aenderungen die Asset-Layer im Build-Cache lassen
COPY assets/ ./assets/
COPY *.mp3 ./
COPY vendor/ ./vendor/
COPY src/ ./src/
COPY index.html serve.mjs ./

ENV PORT=9999
EXPOSE 9999

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:9999/ >/dev/null || exit 1

CMD ["node", "serve.mjs"]
