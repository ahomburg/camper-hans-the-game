FROM node:20-alpine

WORKDIR /app

COPY index.html serve.mjs ./
COPY src/ ./src/
COPY vendor/ ./vendor/
COPY *.glb *.mp3 ./

ENV PORT=9999
EXPOSE 9999

CMD ["node", "serve.mjs"]
