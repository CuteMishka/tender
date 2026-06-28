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
	Priority      string    `gorm:"type:varchar(32);default:'normal'" json:"priority,omitempty"`
	RiskLevel     string    `gorm:"type:varchar(32);default:'medium'" json:"risk_level,omitempty"`
	NextStep      string    `gorm:"type:text" json:"next_step,omitempty"`
	Deadline      time.Time `json:"deadline"`
	StartDate     time.Time `json:"start_date"`
	EndDate       time.Time `json:"end_date"`
	PurchaseType  string    `gorm:"type:varchar(100)" json:"purchase_type"`
	OrganizerName string    `gorm:"type:text" json:"organizer_name"`
	PartnerLink   string    `gorm:"type:text" json:"partner_link"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type TenderActivity struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	SavedLotID uint      `gorm:"index;not null" json:"saved_lot_id"`
	Action     string    `gorm:"type:varchar(64);index" json:"action"`
	Status     string    `gorm:"type:varchar(64);index" json:"status,omitempty"`
	Actor      string    `gorm:"type:varchar(255)" json:"actor,omitempty"`
	Message    string    `gorm:"type:text" json:"message,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type TenderComment struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	SavedLotID uint      `gorm:"index;not null" json:"saved_lot_id"`
	Author     string    `gorm:"type:varchar(255)" json:"author"`
	Body       string    `gorm:"type:text;not null" json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

type TenderTask struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	SavedLotID uint       `gorm:"index;not null" json:"saved_lot_id"`
	Title      string     `gorm:"type:text;not null" json:"title"`
	Status     string     `gorm:"type:varchar(32);index;default:'open'" json:"status"`
	Assignee   string     `gorm:"type:varchar(255)" json:"assignee,omitempty"`
	Priority   string     `gorm:"type:varchar(32);default:'normal'" json:"priority,omitempty"`
	DueDate    *time.Time `json:"due_date,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
