package tenderplus

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	workingStatusesSQL       = "status IN ('review', 'assignment_requested', 'in_work', 'participating', 'submitted', 'waiting_result')"
	participationStatusesSQL = "status IN ('in_work', 'participating', 'submitted', 'waiting_result')"
)

func TestGetDashboardStatsCountsInWorkStages(t *testing.T) {
	db, fake := openDashboardStatsTestDB(t)

	stats, err := GetDashboardStats(db)
	if err != nil {
		t.Fatalf("GetDashboardStats returned an error: %v", err)
	}
	if stats.ActiveCount != 1 {
		t.Fatalf("active_count = %d, want an in_work lot to be counted", stats.ActiveCount)
	}
	if stats.ParticipatingCount != 1 {
		t.Fatalf("participating_count = %d, want an in_work lot to be counted", stats.ParticipatingCount)
	}
	if stats.ParticipatingAmount != 698275.86 {
		t.Fatalf("participating_amount = %v, want 698275.86", stats.ParticipatingAmount)
	}

	query := normalizeDashboardTestSQL(fake.query)
	if !strings.Contains(query, workingStatusesSQL) {
		t.Fatalf("working-status filter is missing from query: %s", query)
	}
	if strings.Count(query, participationStatusesSQL) < 2 {
		t.Fatalf("participation stages must be used for both count and amount: %s", query)
	}
}

func TestGetDashboardStatsUsesInitialAmountForBudget(t *testing.T) {
	db, fake := openDashboardStatsTestDB(t)

	stats, err := GetDashboardStats(db)
	if err != nil {
		t.Fatalf("GetDashboardStats returned an error: %v", err)
	}
	if stats.TotalAmount != 23690000000 {
		t.Fatalf("total_amount = %v, want the initial_amount-only fixture budget", stats.TotalAmount)
	}

	query := normalizeDashboardTestSQL(fake.query)
	if !strings.Contains(query, "SUM(initial_amount)") {
		t.Fatalf("dashboard budget must use initial_amount: %s", query)
	}
	if strings.Contains(query, "SUM(contract_amount)") {
		t.Fatalf("dashboard budget must not use contract_amount: %s", query)
	}
	if !strings.Contains(query, "COALESCE(excluded_from_analytics, false) = false") {
		t.Fatalf("analytics exclusions must be respected: %s", query)
	}
}

type dashboardStatsTestDriver struct {
	query string
}

func (d *dashboardStatsTestDriver) Open(string) (driver.Conn, error) {
	return &dashboardStatsTestConn{driver: d}, nil
}

type dashboardStatsTestConn struct {
	driver *dashboardStatsTestDriver
}

func (c *dashboardStatsTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not supported by dashboard test driver")
}

func (c *dashboardStatsTestConn) Close() error { return nil }

func (c *dashboardStatsTestConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not supported by dashboard test driver")
}

func (c *dashboardStatsTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.driver.query = query
	normalized := normalizeDashboardTestSQL(query)

	var activeCount, participatingCount int64
	var participatingAmount, totalAmount float64
	if strings.Contains(normalized, workingStatusesSQL) {
		activeCount = 1
	}
	if strings.Count(normalized, participationStatusesSQL) >= 2 {
		participatingCount = 1
		participatingAmount = 698275.86
	}
	if strings.Contains(normalized, "SUM(initial_amount)") &&
		!strings.Contains(normalized, "SUM(contract_amount)") &&
		strings.Contains(normalized, "COALESCE(excluded_from_analytics, false) = false") {
		totalAmount = 23690000000
	}

	return &dashboardStatsTestRows{
		values: []driver.Value{activeCount, participatingCount, totalAmount, participatingAmount},
	}, nil
}

type dashboardStatsTestRows struct {
	done   bool
	values []driver.Value
}

func (r *dashboardStatsTestRows) Columns() []string {
	return []string{"active_count", "participating_count", "total_amount", "participating_amount"}
}

func (r *dashboardStatsTestRows) Close() error { return nil }

func (r *dashboardStatsTestRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(dest, r.values)
	r.done = true
	return nil
}

func openDashboardStatsTestDB(t *testing.T) (*gorm.DB, *dashboardStatsTestDriver) {
	t.Helper()
	fake := &dashboardStatsTestDriver{}
	driverName := fmt.Sprintf("dashboard-stats-%p", fake)
	sql.Register(driverName, fake)
	sqlDB, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open gorm test database: %v", err)
	}
	return db, fake
}

func normalizeDashboardTestSQL(query string) string {
	return strings.Join(strings.Fields(query), " ")
}
