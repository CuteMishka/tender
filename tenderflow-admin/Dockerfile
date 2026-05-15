FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_BACK_API=http://localhost:8082
ARG VITE_LOCAL_API=http://localhost:8082
ARG VITE_RAG_API=http://localhost:8083
ARG VITE_FETCH_DOCUMENT_PROXY_URL=http://localhost:8082/api/v1/fetch-document

ENV VITE_BACK_API=$VITE_BACK_API \
    VITE_LOCAL_API=$VITE_LOCAL_API \
    VITE_RAG_API=$VITE_RAG_API \
    VITE_FETCH_DOCUMENT_PROXY_URL=$VITE_FETCH_DOCUMENT_PROXY_URL

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
