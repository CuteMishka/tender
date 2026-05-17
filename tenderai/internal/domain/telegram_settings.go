package domain

import "time"

type TelegramSettings struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Enabled   bool      `gorm:"not null;default:false" json:"enabled"`
	BotToken  string    `gorm:"type:text" json:"-"`
	ChatID    string    `gorm:"size:128" json:"chatId"`
	Username  string    `gorm:"size:128" json:"username"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (TelegramSettings) TableName() string {
	return "telegram_settings"
}
