package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/dauren/tender/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrRegistrationAlreadyProcessed = errors.New("registration request is already processed")
var ErrLastActiveAdmin = errors.New("cannot remove the last active administrator")
var ErrAdminMutationForbidden = errors.New("only an active administrator can modify administrator access")
var ErrUserManagementForbidden = errors.New("user management permission required")
var ErrSelfMutation = errors.New("cannot delete or change your own access")

// UserRepository — доступ к данным пользователей.
type UserRepository interface {
	List(ctx context.Context) ([]domain.User, error)
	Create(ctx context.Context, u *domain.User) error
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	Delete(ctx context.Context, id uint) error
	DeleteUserAtomic(ctx context.Context, actorID uint, id uint) error
	Update(ctx context.Context, u *domain.User) error
	UpdateUserRoleAtomic(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error)
	ListRegistrationRequests(ctx context.Context, status string) ([]domain.RegistrationRequest, error)
	CreateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error
	CreateRegistrationRequestExclusive(ctx context.Context, req *domain.RegistrationRequest) (bool, error)
	GetRegistrationRequest(ctx context.Context, id uint) (*domain.RegistrationRequest, error)
	UpdateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error
	ApproveRegistrationRequestAtomic(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error)
	RejectRegistrationRequestAtomic(ctx context.Context, actorID uint, id uint) error
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

func (r *userRepository) DeleteUserAtomic(ctx context.Context, actorID uint, id uint) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAdminInvariant(tx); err != nil {
			return err
		}
		actor, err := loadActiveUserManager(tx, actorID)
		if err != nil {
			return err
		}
		if actor.ID == id {
			return ErrSelfMutation
		}
		var user domain.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, id).Error; err != nil {
			return err
		}
		if user.Role == "admin" && actor.Role != "admin" {
			return ErrAdminMutationForbidden
		}
		if isActiveAdmin(user) {
			last, err := isLastActiveAdmin(tx)
			if err != nil {
				return err
			}
			if last {
				return ErrLastActiveAdmin
			}
		}
		return tx.Delete(&user).Error
	})
}

func (r *userRepository) UpdateUserRoleAtomic(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error) {
	var updated *domain.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAdminInvariant(tx); err != nil {
			return err
		}
		actor, err := loadActiveUserManager(tx, actorID)
		if err != nil {
			return err
		}
		if actor.ID == id {
			return ErrSelfMutation
		}
		var user domain.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, id).Error; err != nil {
			return err
		}
		if (user.Role == "admin" || role == "admin") && actor.Role != "admin" {
			return ErrAdminMutationForbidden
		}
		if isActiveAdmin(user) && role != "admin" {
			last, err := isLastActiveAdmin(tx)
			if err != nil {
				return err
			}
			if last {
				return ErrLastActiveAdmin
			}
		}
		user.Role = role
		if user.Status == "" {
			user.Status = "active"
		}
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		updated = &user
		return nil
	})
	return updated, err
}

func lockAdminInvariant(tx *gorm.DB) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext('tender-active-admin-invariant'))").Error
}

func loadActiveUserManager(tx *gorm.DB, actorID uint) (domain.User, error) {
	var actor domain.User
	if actorID == 0 {
		return actor, ErrUserManagementForbidden
	}
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).First(&actor, actorID).Error; err != nil {
		return actor, err
	}
	if actor.Status != "" && actor.Status != "active" {
		return actor, ErrUserManagementForbidden
	}
	if actor.Role != "admin" && actor.Role != "director" {
		return actor, ErrUserManagementForbidden
	}
	return actor, nil
}

func isActiveAdmin(user domain.User) bool {
	return user.Role == "admin" && (user.Status == "" || user.Status == "active")
}

func isLastActiveAdmin(tx *gorm.DB) (bool, error) {
	var count int64
	err := tx.Model(&domain.User{}).Where("role = ? AND (status = ? OR status = '')", "admin", "active").Count(&count).Error
	return count <= 1, err
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

func (r *userRepository) CreateRegistrationRequestExclusive(ctx context.Context, req *domain.RegistrationRequest) (bool, error) {
	created := false
	email := strings.ToLower(strings.TrimSpace(req.Email))
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize requests for the same normalized email without retaining plaintext secrets.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", email).Error; err != nil {
			return err
		}
		var userCount int64
		if err := tx.Model(&domain.User{}).Where("LOWER(email) = ?", email).Count(&userCount).Error; err != nil {
			return err
		}
		var pendingCount int64
		if err := tx.Model(&domain.RegistrationRequest{}).Where("LOWER(email) = ? AND status = ?", email, "pending").Count(&pendingCount).Error; err != nil {
			return err
		}
		if userCount > 0 || pendingCount > 0 {
			return nil
		}
		if err := tx.Create(req).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	return created, err
}

func (r *userRepository) GetRegistrationRequest(ctx context.Context, id uint) (*domain.RegistrationRequest, error) {
	var out domain.RegistrationRequest
	err := r.db.WithContext(ctx).First(&out, id).Error
	return &out, err
}

func (r *userRepository) UpdateRegistrationRequest(ctx context.Context, req *domain.RegistrationRequest) error {
	return r.db.WithContext(ctx).Save(req).Error
}

func (r *userRepository) ApproveRegistrationRequestAtomic(ctx context.Context, actorID uint, id uint, role string) (*domain.User, error) {
	var user *domain.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actor, err := loadActiveUserManager(tx, actorID)
		if err != nil {
			return err
		}
		if role == "admin" && actor.Role != "admin" {
			return ErrAdminMutationForbidden
		}
		var req domain.RegistrationRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&req, id).Error; err != nil {
			return err
		}
		if req.Status != "pending" {
			return ErrRegistrationAlreadyProcessed
		}
		created := &domain.User{
			Email:        req.Email,
			PasswordHash: req.Password,
			Name:         req.Name,
			Role:         role,
			Company:      req.Company,
			Position:     req.Position,
			Status:       "active",
		}
		if err := tx.Create(created).Error; err != nil {
			return err
		}
		if err := tx.Model(&req).Updates(map[string]interface{}{
			"status":   "approved",
			"role":     role,
			"password": "",
		}).Error; err != nil {
			return err
		}
		user = created
		return nil
	})
	return user, err
}

func (r *userRepository) RejectRegistrationRequestAtomic(ctx context.Context, actorID uint, id uint) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := loadActiveUserManager(tx, actorID); err != nil {
			return err
		}
		var req domain.RegistrationRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&req, id).Error; err != nil {
			return err
		}
		if req.Status != "pending" {
			return ErrRegistrationAlreadyProcessed
		}
		return tx.Model(&req).Updates(map[string]interface{}{
			"status":   "rejected",
			"password": "",
		}).Error
	})
}
