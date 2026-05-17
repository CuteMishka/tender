package service

import (
	"context"
	"errors"
	"strings"

	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/repository"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// UserService — бизнес-логика вокруг пользователей.
type UserService struct {
	repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) List(ctx context.Context) ([]domain.User, error) {
	return s.repo.List(ctx)
}

func (s *UserService) Login(ctx context.Context, email string, password string) (*domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "admin" {
		email = "admin@tender.local"
	}
	if email == "" || strings.TrimSpace(password) == "" {
		return nil, errors.New("email and password are required")
	}
	user, err := s.repo.GetByEmail(ctx, email)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("invalid credentials")
	}
	if err != nil {
		return nil, err
	}
	if user.Status != "" && user.Status != "active" {
		return nil, errors.New("user is not active")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, errors.New("invalid credentials")
	}
	return user, nil
}

func (s *UserService) CreateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if req.Email == "" || req.Name == "" || strings.TrimSpace(req.Password) == "" {
		return errors.New("name, email and password are required")
	}
	if _, err := s.repo.GetByEmail(ctx, req.Email); err == nil {
		return errors.New("user already exists")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	req.Password = string(hash)
	req.Status = "pending"
	req.Role = ""
	return s.repo.CreateRegistrationRequest(ctx, req)
}

func (s *UserService) ListRegistrationRequests(ctx context.Context, status string) ([]domain.RegistrationRequest, error) {
	return s.repo.ListRegistrationRequests(ctx, strings.TrimSpace(status))
}

func (s *UserService) ApproveRegistrationRequest(ctx context.Context, id uint, role string) (*domain.User, error) {
	role = NormalizeRole(role)
	if role == "" {
		return nil, errors.New("invalid role")
	}
	req, err := s.repo.GetRegistrationRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Status != "pending" {
		return nil, errors.New("request is already processed")
	}
	user := &domain.User{
		Email:        req.Email,
		PasswordHash: req.Password,
		Name:         req.Name,
		Role:         role,
		Company:      req.Company,
		Position:     req.Position,
		Status:       "active",
	}
	if err := s.repo.Create(ctx, user); err != nil {
		return nil, err
	}
	req.Status = "approved"
	req.Role = role
	if err := s.repo.UpdateRegistrationRequest(ctx, req); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *UserService) RejectRegistrationRequest(ctx context.Context, id uint) error {
	req, err := s.repo.GetRegistrationRequest(ctx, id)
	if err != nil {
		return err
	}
	if req.Status != "pending" {
		return errors.New("request is already processed")
	}
	req.Status = "rejected"
	return s.repo.UpdateRegistrationRequest(ctx, req)
}

func (s *UserService) Delete(ctx context.Context, id uint) error {
	return s.repo.Delete(ctx, id)
}

func (s *UserService) UpdateRole(ctx context.Context, id uint, role string) (*domain.User, error) {
	role = NormalizeRole(role)
	if role == "" {
		return nil, errors.New("invalid role")
	}
	users, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range users {
		if users[i].ID == id {
			users[i].Role = role
			if users[i].Status == "" {
				users[i].Status = "active"
			}
			if err := s.repo.Update(ctx, &users[i]); err != nil {
				return nil, err
			}
			return &users[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func NormalizeRole(role string) string {
	switch strings.TrimSpace(role) {
	case "admin":
		return "admin"
	case "director":
		return "director"
	case "tender_specialist":
		return "tender_specialist"
	default:
		return ""
	}
}
