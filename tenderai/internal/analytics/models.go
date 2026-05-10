package analytics

import "time"

// HistoricalLot — исторические данные лота, синхронизируемые из TenderPlus.
type HistoricalLot struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	LotID          int        `gorm:"uniqueIndex;not null" json:"lot_id"`
	Title          string     `gorm:"type:text;not null" json:"title"`
	Description    string     `gorm:"type:text" json:"description"`
	InitialAmount  float64    `json:"initial_amount"`
	ContractAmount float64    `json:"contract_amount"`
	Status         string     `gorm:"index;default:'active'" json:"status"`
	CustomerName   string     `gorm:"index;type:text" json:"customer_name"`
	CustomerID     string     `gorm:"index" json:"customer_id"`
	OrganizerName  string     `gorm:"type:text" json:"organizer_name"`
	Region         string     `gorm:"index" json:"region"`
	PurchaseType   string     `gorm:"index" json:"purchase_type"`
	WinnerName     string     `gorm:"index;type:text" json:"winner_name"`
	WinnerID       string     `gorm:"index" json:"winner_id"`
	PartnerLink    string     `json:"partner_link"`
	LotSource      string     `json:"lot_source"`
	StartDate      *time.Time `gorm:"index" json:"start_date"`
	EndDate        *time.Time `gorm:"index" json:"end_date"`
	PublishDate    *time.Time `json:"publish_date"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// TrackedCustomer — заказчик под мониторингом.
type TrackedCustomer struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	CustomerName  string     `gorm:"uniqueIndex;type:text;not null" json:"customer_name"`
	CustomerID    string     `json:"customer_id"`
	NotifyEmail   string     `json:"notify_email"`
	Notes         string     `gorm:"type:text" json:"notes"`
	IsFavorite    bool       `gorm:"default:true;index" json:"is_favorite"`
	LastCheckedAt *time.Time `json:"last_checked_at"`
	TenderCount   int        `json:"tender_count,omitempty" gorm:"-"`
	LastTenderAt  *time.Time `json:"last_tender_at,omitempty" gorm:"-"`
	TotalBudget   float64    `json:"total_budget,omitempty" gorm:"-"`
	CreatedAt     time.Time  `json:"created_at"`
}

type CustomerCandidate struct {
	CustomerName string     `json:"customer_name"`
	CustomerID   string     `json:"customer_id"`
	TenderCount  int64      `json:"tender_count"`
	LastTenderAt *time.Time `json:"last_tender_at"`
	TotalBudget  float64    `json:"total_budget"`
	IsTracked    bool       `json:"is_tracked"`
	IsFavorite   bool       `json:"is_favorite"`
}

// Stats — агрегированная статистика.
type Stats struct {
	TotalLots    int64   `json:"total_lots"`
	TotalBudget  float64 `json:"total_budget"`
	AvgAmount    float64 `json:"avg_amount"`
	AvgDiscount  float64 `json:"avg_discount"`
	WithWinner   int64   `json:"with_winner"`
	WithContract int64   `json:"with_contract"`
}

// DynamicsPoint — одна точка динамики (месяц).
type DynamicsPoint struct {
	Period string  `json:"period"`
	Count  int64   `json:"count"`
	Budget float64 `json:"budget"`
}

// WinnerRow — строка рейтинга победителей.
type WinnerRow struct {
	WinnerName     string  `json:"winner_name"`
	Wins           int64   `json:"wins"`
	TotalAmount    float64 `json:"total_amount"`
	AvgAmount      float64 `json:"avg_amount"`
	MaxAmount      float64 `json:"max_amount"`
	MarketSharePct float64 `json:"market_share_pct"`
}

// PriceRow — строка анализа цен.
type PriceRow struct {
	LotID          int     `json:"lot_id"`
	Title          string  `json:"title"`
	InitialAmount  float64 `json:"initial_amount"`
	ContractAmount float64 `json:"contract_amount"`
	DiscountAbs    float64 `json:"discount_abs"`
	DiscountPct    float64 `json:"discount_pct"`
	PurchaseType   string  `json:"purchase_type"`
	CustomerName   string  `json:"customer_name"`
	WinnerName     string  `json:"winner_name"`
}

// PriceStats — агрегированная ценовая статистика.
type PriceStats struct {
	AvgInitial     float64 `json:"avg_initial"`
	AvgContract    float64 `json:"avg_contract"`
	AvgDiscountPct float64 `json:"avg_discount_pct"`
	MaxDiscountPct float64 `json:"max_discount_pct"`
	MinDiscountPct float64 `json:"min_discount_pct"`
	AnomalyCount   int64   `json:"anomaly_count"`
	TotalSavings   float64 `json:"total_savings"`
}

// UpdateLotInput — поля, доступные для ручного обновления лота.
type UpdateLotInput struct {
	WinnerName     string  `json:"winner_name"`
	WinnerID       string  `json:"winner_id"`
	ContractAmount float64 `json:"contract_amount"`
	Status         string  `json:"status"`
	Region         string  `json:"region"`
}
