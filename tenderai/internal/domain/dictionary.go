package domain

import "time"

type DictionaryItem struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Kind      string    `gorm:"size:64;not null;index:idx_dictionary_kind_value,unique" json:"kind"`
	Value     string    `gorm:"size:512;not null;index:idx_dictionary_kind_value,unique" json:"value"`
	Active    bool      `gorm:"not null;default:true" json:"active"`
	MinAmount *float64  `gorm:"type:numeric(18,2)" json:"minAmount,omitempty"`
	LastLot   string    `gorm:"size:255" json:"lastLot,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (DictionaryItem) TableName() string {
	return "dictionary_items"
}
