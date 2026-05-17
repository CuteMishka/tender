package tenderplus

import "time"

// SavedLot описывает структуру таблицы сохраненных тендеров в базе данных Go.
// Здесь есть поля статуса и дедлайна для твоих фич.
type SavedLot struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ExternalID    string    `gorm:"type:varchar(128);index" json:"external_id,omitempty"`
	Source        string    `gorm:"type:varchar(64);index" json:"source,omitempty"`
	Title         string    `gorm:"type:text" json:"title"`
	Description   string    `gorm:"type:text" json:"description"`
	Amount        float64   `json:"amount"`
	Status        string    `gorm:"index;default:'active'" json:"status"`
	Comment       string    `gorm:"type:text" json:"comment,omitempty"`
	AssignedTo    string    `gorm:"type:varchar(255)" json:"assigned_to,omitempty"`
	Reviewer      string    `gorm:"type:varchar(255)" json:"reviewer,omitempty"`
	ActionHistory string    `gorm:"type:text" json:"action_history,omitempty"`
	Deadline      time.Time `json:"deadline"`
	StartDate     time.Time `json:"start_date"`
	EndDate       time.Time `json:"end_date"`
	PurchaseType  string    `gorm:"type:varchar(100)" json:"purchase_type"`
	OrganizerName string    `gorm:"type:text" json:"organizer_name"`
	PartnerLink   string    `gorm:"type:text" json:"partner_link"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
