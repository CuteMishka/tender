package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/dauren/tender/internal/api"
	"github.com/dauren/tender/internal/config"
	"github.com/dauren/tender/internal/tenderplus"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	config.LoadDotEnv()
	cfg, err := config.FromEnv()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	var tp *tenderplus.Client
	if cfg.HasTenderPlus() {
		tp = tenderplus.NewClient(cfg.TenderPlusURL, cfg.TenderPlusToken)
	} else {
		log.Print("warning: TENDERPLUS_TOKEN is empty; GET /api/v1/tenders will return 503")
	}

	fd := api.NewFetchDocumentProxy(cfg.FetchDocument)
	srv := api.NewRouter(&api.Handler{
		TP:              tp,
		TendersKeywords: cfg.TendersKeywords,
		// DB-часть временно отключена: /api/v1/users не регистрируется.
		Users:    nil,
		FetchDoc: fd,
	}, cfg.CORSAllowedOrigins)

	log.Printf("listening on %s (GET /health, GET /api/v1/tenders?keywords=IaaS&limit=10, POST /api/v1/fetch-document)", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
