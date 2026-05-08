package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/dauren/tender/internal/domain"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// OpenGORM открывает пул к Postgres и проверяет соединение.
func OpenGORM(dsn string) (*gorm.DB, error) {
	gcfg := &gorm.Config{}
	if os.Getenv("GORM_DEBUG") == "1" {
		gcfg.Logger = logger.Default.LogMode(logger.Info)
	}

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true, // стабильнее для DDL (миграции), чем prepared statements pgx
	}), gcfg)
	if err != nil {
		return nil, fmt.Errorf("gorm open: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("gorm sql: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return db, nil
}

// Migrate создаёт/обновляет таблицы и проверяет, что users реально есть.
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.User{}); err != nil {
		return fmt.Errorf("automigrate: %w", err)
	}

	var dbName, schema string
	if err := db.Raw("SELECT current_database()").Scan(&dbName).Error; err != nil {
		return fmt.Errorf("current_database: %w", err)
	}
	if err := db.Raw("SELECT current_schema()").Scan(&schema).Error; err != nil {
		return fmt.Errorf("current_schema: %w", err)
	}

	// pg_tables — надёжнее information_schema + COUNT; Scan в int64 через GORM Raw иногда даёт 0.
	row := db.Raw(`
SELECT COUNT(*) FROM pg_catalog.pg_tables
WHERE schemaname = 'public' AND tablename = 'users'
`).Row()
	var n sql.NullInt64
	if err := row.Scan(&n); err != nil {
		return fmt.Errorf("verify users table: %w", err)
	}
	if !n.Valid || n.Int64 == 0 {
		return fmt.Errorf("after automigrate: table public.users missing (database=%q search_path schema=%q)", dbName, schema)
	}
	log.Printf("migrate: table users OK (current_database=%q — в клиенте открой именно эту БД, не служебную \"postgres\")", dbName)
	return nil
}
