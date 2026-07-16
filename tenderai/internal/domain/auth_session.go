package domain

import "time"

// AuthSession is a revocable server-side login session. TokenHash and
// CSRFTokenHash are one-way SHA-256 hashes; plaintext tokens are never stored.
type AuthSession struct {
	ID            uint       `gorm:"primaryKey" json:"-"`
	UserID        uint       `gorm:"index;not null" json:"-"`
	User          User       `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	TokenHash     string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	CSRFTokenHash string     `gorm:"size:64;not null" json:"-"`
	ExpiresAt     time.Time  `gorm:"index;not null" json:"-"`
	LastSeenAt    time.Time  `gorm:"index;not null" json:"-"`
	RevokedAt     *time.Time `gorm:"index" json:"-"`
	CreatedAt     time.Time  `json:"-"`
	UpdatedAt     time.Time  `json:"-"`
}

func (AuthSession) TableName() string { return "auth_sessions" }
