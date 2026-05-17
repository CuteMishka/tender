package domain

import "time"

type ParserRunRequest struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	RequestedAt time.Time  `gorm:"not null;autoCreateTime" json:"requestedAt"`
	RequestedBy string     `gorm:"size:255;not null;default:admin" json:"requestedBy"`
	Status      string     `gorm:"size:32;not null;default:pending;index" json:"status"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	Message     string     `gorm:"type:text" json:"message,omitempty"`
}

func (ParserRunRequest) TableName() string {
	return "parser_run_requests"
}
