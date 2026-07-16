package analytics

import "time"

const (
	defaultReportTopN = 15
	maxReportTopN     = 100
)

// ReportRequest contains the filters shared by the JSON preview and DOCX
// endpoints. OrganizationQuery is the query sent to TenderPlus; Organization
// is an optional, narrower filter over the returned customer/organizer rows.
type ReportRequest struct {
	OrganizationQuery string   `json:"organization_query"`
	Organization      string   `json:"organization,omitempty"`
	Platforms         []string `json:"platforms,omitempty"`
	DateFrom          string   `json:"date_from,omitempty"`
	DateTo            string   `json:"date_to,omitempty"`
	TopN              int      `json:"top_n,omitempty"`
}

// ReportBuildMeta makes BuildReport deterministic and independent from HTTP,
// clocks and external services.
type ReportBuildMeta struct {
	Source      string
	DataAsOf    time.Time
	GeneratedAt time.Time
	Matches     []CompanyMatch
	Warnings    []string
}

type ReportData struct {
	Header                 ReportHeader        `json:"header"`
	KPIs                   ReportKPIs          `json:"kpis"`
	ByPurchaseType         []ReportBreakdown   `json:"by_purchase_type"`
	ByServiceCategory      []ReportBreakdown   `json:"by_service_category"`
	TopTenders             []ReportTopTender   `json:"top_tenders"`
	RepeatedLots           []ReportRepeatedLot `json:"repeated_lots"`
	Conclusions            []string            `json:"conclusions"`
	Quality                ReportQuality       `json:"quality"`
	AvailablePlatforms     []string            `json:"available_platforms"`
	AvailableOrganizations []string            `json:"available_organizations"`
}

type ReportHeader struct {
	Title                 string    `json:"title"`
	OrganizationQuery     string    `json:"organization_query"`
	OrganizationFilter    string    `json:"organization_filter,omitempty"`
	Organizations         []string  `json:"organizations"`
	Platforms             []string  `json:"platforms"`
	DateFrom              string    `json:"date_from,omitempty"`
	DateTo                string    `json:"date_to,omitempty"`
	DataAsOf              time.Time `json:"data_as_of"`
	GeneratedAt           time.Time `json:"generated_at"`
	Source                string    `json:"source"`
	Timezone              string    `json:"timezone"`
	DateBasis             string    `json:"date_basis"`
	DeduplicationMethod   string    `json:"deduplication_method"`
	AmountCalculationNote string    `json:"amount_calculation_note"`
}

type ReportKPIs struct {
	TotalLots               int     `json:"total_lots"`
	CompletedLots           int     `json:"completed_lots"`
	CancelledLots           int     `json:"cancelled_lots"`
	FailedLots              int     `json:"failed_lots"`
	LotsWithoutAmount       int     `json:"lots_without_amount"`
	TotalAmount             float64 `json:"total_amount"`
	PossibleReannouncements int     `json:"possible_reannouncements"`
}

type ReportBreakdown struct {
	Name   string  `json:"name"`
	Count  int     `json:"count"`
	Amount float64 `json:"amount"`
}

type ReportTopTender struct {
	LotNumber              string       `json:"lot_number"`
	LotSource              string       `json:"lot_source,omitempty"`
	Title                  string       `json:"title"`
	Amount                 float64      `json:"amount"`
	AmountAvailable        bool         `json:"amount_available"`
	Deadline               *time.Time   `json:"deadline,omitempty"`
	Status                 string       `json:"status"`
	StatusGroup            ReportStatus `json:"status_group"`
	Platform               string       `json:"platform"`
	Organization           string       `json:"organization"`
	PossibleReannouncement bool         `json:"possible_reannouncement"`
}

type ReportRepeatedLot struct {
	LotNumber              string `json:"lot_number"`
	LotSource              string `json:"lot_source,omitempty"`
	Title                  string `json:"title"`
	Platform               string `json:"platform"`
	Occurrences            int    `json:"occurrences"`
	PublicationCount       int    `json:"publication_count"`
	StageTransition        bool   `json:"stage_transition"`
	PossibleReannouncement bool   `json:"possible_reannouncement"`
	Status                 string `json:"status"`
}

type ReportQuality struct {
	SourceRows                 int      `json:"source_rows"`
	FilteredRows               int      `json:"filtered_rows"`
	UniqueLots                 int      `json:"unique_lots"`
	RowsWithoutLotNumber       int      `json:"rows_without_lot_number"`
	RowsWithoutLotSource       int      `json:"rows_without_lot_source"`
	LotsWithUnknownStatus      int      `json:"lots_with_unknown_status"`
	LotsWithConflictingAmounts int      `json:"lots_with_conflicting_amounts"`
	LotsUsingAmountFallback    int      `json:"lots_using_amount_fallback"`
	PastDeadlineActiveLots     int      `json:"past_deadline_active_lots"`
	Warnings                   []string `json:"warnings,omitempty"`
}

type ReportStatus string

const (
	ReportStatusCancelled ReportStatus = "cancelled"
	ReportStatusFailed    ReportStatus = "failed"
	ReportStatusCompleted ReportStatus = "completed"
	ReportStatusActive    ReportStatus = "active"
	ReportStatusUnknown   ReportStatus = "unknown"
)
