package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
	_ "time/tzdata"

	"github.com/dauren/tender/internal/analytics"
	"github.com/dauren/tender/internal/api"
	"github.com/dauren/tender/internal/config"
	"github.com/dauren/tender/internal/database"
	"github.com/dauren/tender/internal/repository"
	"github.com/dauren/tender/internal/service"
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

	tp := tenderplus.NewClient(cfg.TenderPlusURL, cfg.TenderPlusToken)
	if !cfg.HasTenderPlus() {
		log.Print("warning: TENDERPLUS_TOKEN is empty; TenderPlus GraphQL is disabled, public attached files fallback remains available")
	}

	fd := api.NewFetchDocumentProxy(cfg.FetchDocument)
	db := database.InitDB()
	users := service.NewUserService(repository.NewUserRepository(db))
	auth, err := api.NewAuthManager(api.NewGormSessionStore(db), cfg.Auth)
	if err != nil {
		return fmt.Errorf("authentication: %w", err)
	}
	srv := api.NewRouter(&api.Handler{
		DB:                      db,
		Users:                   users,
		FetchDoc:                fd,
		TP:                      tp,
		RagAPIBase:              cfg.RagAPIBase,
		Auth:                    auth,
		RAGInternalServiceToken: cfg.RAGInternalServiceToken,
	}, cfg.CORSAllowedOrigins)

	// Подключаем локальную БД и добавляем новые эндпоинты
	if r, ok := srv.(chi.Router); ok {
		r.Get("/api/v1/dashboard", tenderplus.DashboardHandler(db))
		r.Get("/api/v1/dashboard/dynamics", tenderplus.DashboardDynamicsHandler(db))
		r.Post("/api/v1/lots/participate", tenderplus.ParticipateLotHandler(db))
		r.Get("/api/v1/lots/saved", tenderplus.GetSavedLotsHandler(db))
		r.Delete("/api/v1/lots/saved/{id}", tenderplus.DeleteSavedLotHandler(db))
		r.Get("/api/v1/lots/{id}/activity", tenderplus.ListLotActivityHandler(db))
		r.Get("/api/v1/lots/{id}/comments", tenderplus.ListLotCommentsHandler(db))
		r.Post("/api/v1/lots/{id}/comments", tenderplus.CreateLotCommentHandler(db))
		r.Get("/api/v1/lots/{id}/tasks", tenderplus.ListLotTasksHandler(db))
		r.Post("/api/v1/lots/{id}/tasks", tenderplus.CreateLotTaskHandler(db))
		r.Patch("/api/v1/lots/{id}/tasks/{taskId}", tenderplus.UpdateLotTaskHandler(db))

		// Company intelligence and historical tender endpoints.
		ah := &analytics.Handler{DB: db, TP: tp, Keywords: cfg.TendersKeywords}
		r.Route("/api/v1/analytics", func(s chi.Router) {
			s.Post("/sync", ah.Sync)
			s.Get("/lots", ah.ListLots)
			s.Put("/lots/{id}", ah.UpdateLot)
			s.Get("/stats", ah.GetStats)
			s.Get("/dynamics", ah.GetDynamics)
			s.Get("/filters", ah.GetFilters)
			s.Get("/export", ah.Export)
			s.Get("/company-tenders", ah.GetCompanyTenderIntelligence)
			s.Post("/reports/preview", ah.ReportPreview)
			s.Post("/reports/docx", ah.ReportDOCX)
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
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
