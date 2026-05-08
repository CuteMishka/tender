package service

import (
	"context"

	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/repository"
)

// UserService — бизнес-логика вокруг пользователей.
type UserService struct {
	repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) *UserService {
	return &UserService{repo: repo}
}

// List возвращает всех пользователей (для админки / отладки; позже добавьте пагинацию и фильтры).
func (s *UserService) List(ctx context.Context) ([]domain.User, error) {
	return s.repo.List(ctx)
}
