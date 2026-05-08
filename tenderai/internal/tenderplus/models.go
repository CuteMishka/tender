package tenderplus

import "time"

// SavedLot описывает структуру таблицы сохраненных тендеров в базе данных Go.
// Здесь есть поля статуса и дедлайна для твоих фич.
type SavedLot struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Title       string    `gorm:"type:text" json:"title"`
	Description string    `gorm:"type:text" json:"description"`
	Amount      float64   `json:"amount"`                               // Объём контрактов = всего сумма
	Status      string    `gorm:"index;default:'active'" json:"status"` // active, participating, rejected
	Deadline    time.Time `json:"deadline"`                             // Дедлайн
	StartDate   time.Time `json:"start_date"`                           // Дата начала
	EndDate     time.Time `json:"end_date"`                             // Дата окончания
	PurchaseType string   `gorm:"type:varchar(100)" json:"purchase_type"` // Вид закупа
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}