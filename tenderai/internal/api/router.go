package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter(h *Handler, allowedOrigins []string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)

	r.Use(cors.New(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}).Handler)

	r.Get("/health", h.Health)
	r.Route("/api/v1", func(s chi.Router) {
		s.Get("/tenders", h.ListTenders)
		s.Get("/tenders/{tenderId}", h.GetTender)
		s.Get("/dictionaries", h.ListDictionaries)
		s.Post("/dictionaries", h.CreateDictionaryItem)
		s.Get("/dictionaries/{id}", h.GetDictionaryItem)
		s.Put("/dictionaries/{id}", h.UpdateDictionaryItem)
		s.Delete("/dictionaries/{id}", h.DeleteDictionaryItem)
		s.Get("/parser/status", h.GetParserStatus)
		s.Post("/parser/run", h.RunParserNow)
		if h.FetchDoc != nil {
			s.Post("/fetch-document", h.FetchDocument)
		}
		if h.Users != nil {
			s.Post("/auth/login", h.Login)
			s.Post("/auth/register-request", h.CreateRegistrationRequest)
			s.Get("/users", h.ListUsers)
			s.Patch("/users/{id}/role", h.UpdateUserRole)
			s.Delete("/users/{id}", h.DeleteUser)
			s.Get("/registration-requests", h.ListRegistrationRequests)
			s.Post("/registration-requests/{id}/approve", h.ApproveRegistrationRequest)
			s.Post("/registration-requests/{id}/reject", h.RejectRegistrationRequest)
		}
	})

	return r
}
