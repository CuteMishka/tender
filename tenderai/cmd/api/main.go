package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/dauren/tender/internal/analytics"
	"github.com/dauren/tender/internal/api"
	"github.com/dauren/tender/internal/config"
	"github.com/dauren/tender/internal/database"
	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
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

	// Подключаем локальную БД, сидируем данные и добавляем новые эндпоинты
	if r, ok := srv.(chi.Router); ok {
		db := database.InitDB()
		tenderplus.SeedTestData(db)
		analytics.SeedHistoricalDemoData(db)

		r.Get("/api/v1/dashboard", tenderplus.DashboardHandler(db))
		r.Post("/api/v1/lots/participate", tenderplus.ParticipateLotHandler(db))
		r.Get("/api/v1/lots/saved", tenderplus.GetSavedLotsHandler(db))
		r.Delete("/api/v1/lots/saved/{id}", tenderplus.DeleteSavedLotHandler(db))

		// Аналитика
		ah := &analytics.Handler{DB: db, TP: tp, Keywords: cfg.TendersKeywords}
		r.Route("/api/v1/analytics", func(s chi.Router) {
			s.Post("/sync", ah.Sync)
			s.Get("/lots", ah.ListLots)
			s.Put("/lots/{id}", ah.UpdateLot)
			s.Get("/stats", ah.GetStats)
			s.Get("/dynamics", ah.GetDynamics)
			s.Get("/filters", ah.GetFilters)
			s.Get("/export", ah.Export)
			s.Get("/customers/candidates", ah.ListCustomerCandidates)
			s.Get("/customers", ah.ListCustomers)
			s.Post("/customers", ah.AddCustomer)
			s.Put("/customers/{id}", ah.UpdateCustomer)
			s.Delete("/customers/{id}", ah.DeleteCustomer)
			s.Get("/customers/{id}/lots", ah.GetCustomerLots)
			s.Get("/winners", ah.GetWinners)
			s.Get("/prices", ah.GetPrices)
		})
	}

	log.Printf("listening on %s (GET /health, GET /api/v1/tenders?keywords=IaaS&limit=10, POST /api/v1/fetch-document)", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
