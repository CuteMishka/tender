package service

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"unicode"

	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/repository"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// UserService — бизнес-логика вокруг пользователей.
type UserService struct {
	repo repository.UserRepository
}

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrAccountAlreadyExists = errors.New("account or pending request already exists")
var ErrInvalidRegistration = errors.New("registration fields are invalid")
var ErrWeakPassword = errors.New("password does not meet policy")

var dummyPasswordHash = func() []byte {
	hash, _ := bcrypt.GenerateFromPassword([]byte("not-a-real-password-value"), bcrypt.DefaultCost)
	return hash
}()

func NewUserService(repo repository.UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) List(ctx context.Context) ([]domain.User, error) {
	return s.repo.List(ctx)
}

func CanonicalLoginEmail(email string) string {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "admin" {
		return "admin@tender.local"
	}
	return email
}

func (s *UserService) Login(ctx context.Context, email string, password string) (*domain.User, error) {
	email = CanonicalLoginEmail(email)
	if email == "" || len(email) > 254 || strings.TrimSpace(password) == "" || len([]byte(password)) > 72 {
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return nil, ErrInvalidCredentials
	}
	user, err := s.repo.GetByEmail(ctx, email)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	passwordErr := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if passwordErr != nil || (user.Status != "" && user.Status != "active") {
		return nil, ErrInvalidCredentials
	}
	return user, nil
}

func (s *UserService) CreateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	req.Company = strings.TrimSpace(req.Company)
	req.Position = strings.TrimSpace(req.Position)
	req.Comment = strings.TrimSpace(req.Comment)
	parsedEmail, emailErr := mail.ParseAddress(req.Email)
	if req.Email == "" || len(req.Email) > 254 || emailErr != nil || parsedEmail.Address != req.Email ||
		req.Name == "" || len([]rune(req.Name)) > 255 || len([]rune(req.Company)) > 255 ||
		len([]rune(req.Position)) > 255 || len([]rune(req.Comment)) > 5000 || strings.TrimSpace(req.Password) == "" {
		return ErrInvalidRegistration
	}
	if !isStrongPassword(req.Password) {
		return ErrWeakPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	req.Password = string(hash)
	req.Status = "pending"
	req.Role = ""
	created, err := s.repo.CreateRegistrationRequestExclusive(ctx, req)
	if err != nil {
		return err
	}
	if !created {
		return ErrAccountAlreadyExists
	}
	return nil
}

func isStrongPassword(password string) bool {
	var hasUpper, hasLower, hasDigit, hasSymbol bool
	if len([]rune(password)) < 12 || len([]byte(password)) > 72 {
		return false
	}
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		default:
			hasSymbol = true
		}
	}
	return hasUpper && hasLower && hasDigit && hasSymbol
}

func (s *UserService) ListRegistrationRequests(ctx context.Context, status string) ([]domain.RegistrationRequest, error) {
	return s.repo.ListRegistrationRequests(ctx, strings.TrimSpace(status))
}

func (s *UserService) ApproveRegistrationRequest(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error) {
	role = NormalizeRole(role)
	if role == "" {
		return nil, errors.New("invalid role")
	}
	return s.repo.ApproveRegistrationRequestAtomic(ctx, actorID, id, role)
}

func (s *UserService) RejectRegistrationRequest(ctx context.Context, actorID uint, id uint) error {
	return s.repo.RejectRegistrationRequestAtomic(ctx, actorID, id)
}

func (s *UserService) Delete(ctx context.Context, actorID uint, id uint) error {
	return s.repo.DeleteUserAtomic(ctx, actorID, id)
}

func (s *UserService) UpdateRole(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error) {
	role = NormalizeRole(role)
	if role == "" {
		return nil, errors.New("invalid role")
	}
	return s.repo.UpdateUserRoleAtomic(ctx, actorID, id, role)
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
