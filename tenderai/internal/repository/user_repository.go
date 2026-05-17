package repository

import (
	"context"

	"github.com/dauren/tender/internal/domain"
	"gorm.io/gorm"
)

// UserRepository — доступ к данным пользователей.
type UserRepository interface {
	List(ctx context.Context) ([]domain.User, error)
	Create(ctx context.Context, u *domain.User) error
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	Delete(ctx context.Context, id uint) error
	Update(ctx context.Context, u *domain.User) error
	ListRegistrationRequests(ctx context.Context, status string) ([]domain.RegistrationRequest, error)
	CreateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error
	GetRegistrationRequest(ctx context.Context, id uint) (*domain.RegistrationRequest, error)
	UpdateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error
}

type userRepository struct {
	db *gorm.DB
}

// NewUserRepository создаёт репозиторий поверх GORM.
func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) List(ctx context.Context) ([]domain.User, error) {
	var out []domain.User
	err := r.db.WithContext(ctx).Order("id ASC").Find(&out).Error
	return out, err
}

func (r *userRepository) Create(ctx context.Context, u *domain.User) error {
	return r.db.WithContext(ctx).Create(u).Error
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	var out domain.User
	err := r.db.WithContext(ctx).Where("LOWER(email) = LOWER(?)", email).First(&out).Error
	return &out, err
}

func (r *userRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&domain.User{}, id).Error
}

func (r *userRepository) Update(ctx context.Context, u *domain.User) error {
	return r.db.WithContext(ctx).Save(u).Error
}

func (r *userRepository) ListRegistrationRequests(ctx context.Context, status string) ([]domain.RegistrationRequest, error) {
	var out []domain.RegistrationRequest
	q := r.db.WithContext(ctx).Order("created_at DESC")
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Find(&out).Error
	return out, err
}

func (r *userRepository) CreateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error {
	return r.db.WithContext(ctx).Create(req).Error
}

func (r *userRepository) GetRegistrationRequest(ctx context.Context, id uint) (*domain.RegistrationRequest, error) {
	var out domain.RegistrationRequest
	err := r.db.WithContext(ctx).First(&out, id).Error
	return &out, err
}

func (r *userRepository) UpdateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error {
	return r.db.WithContext(ctx).Save(req).Error
}
