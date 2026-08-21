FROM node:26-alpine AS builder
WORKDIR /app

ARG VITE_BACK_API=http://localhost:8082
ARG VITE_LOCAL_API=http://localhost:8082
ARG VITE_RAG_API=http://localhost:8083
ARG VITE_FETCH_DOCUMENT_PROXY_URL=/api/v1/fetch-document

ENV VITE_BACK_API=$VITE_BACK_API \
    VITE_LOCAL_API=$VITE_LOCAL_API \
    VITE_RAG_API=$VITE_RAG_API \
    VITE_FETCH_DOCUMENT_PROXY_URL=$VITE_FETCH_DOCUMENT_PROXY_URL

COPY package*.json ./
COPY scripts/patch-brace-expansion.cjs ./scripts/patch-brace-expansion.cjs
RUN npm config set registry https://registry.npmjs.org/ \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production
COPY --from=builder --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
