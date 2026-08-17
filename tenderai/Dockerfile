FROM golang:1.26.6-alpine AS builder
WORKDIR /app
ARG GOPROXY=https://goproxy.io,https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/api

FROM alpine:3.22
WORKDIR /app
RUN addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder --chown=app:app /app/server .
USER 10001:10001
EXPOSE 8082
CMD ["./server"]
