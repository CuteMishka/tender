package domain

import "time"

// User — сущность пользователя (таблица users).
type User struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Email        string    `gorm:"size:255;uniqueIndex;not null" json:"email"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	Name         string    `gorm:"size:255" json:"name,omitempty"`
	Role         string    `gorm:"size:64;not null;default:tender_specialist" json:"role"`
	Company      string    `gorm:"size:255" json:"company,omitempty"`
	Position     string    `gorm:"size:255" json:"position,omitempty"`
	Status       string    `gorm:"size:32;not null;default:active" json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// TableName явное имя таблицы (без зависимости от pluralizer).
func (User) TableName() string { return "users" }

type RegistrationRequest struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Email     string    `gorm:"size:255;index;not null" json:"email"`
	Name      string    `gorm:"size:255;not null" json:"name"`
	Company   string    `gorm:"size:255" json:"company,omitempty"`
	Position  string    `gorm:"size:255" json:"position,omitempty"`
	Comment   string    `gorm:"type:text" json:"comment,omitempty"`
	Password  string    `gorm:"size:255;not null" json:"-"`
	Status    string    `gorm:"size:32;index;not null;default:pending" json:"status"`
	Role      string    `gorm:"size:64" json:"role,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (RegistrationRequest) TableName() string { return "registration_requests" }
