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
