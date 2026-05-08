package config

import (
	"log"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

// LoadDotEnv ищет .env от cwd вверх (go run из подпапки / IDE с другим cwd).
func LoadDotEnv() {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}
	dir := wd
	for range 10 {
		p := filepath.Join(dir, ".env")
		if _, err := os.Stat(p); err == nil {
			// Overload: значения из .env перекрывают уже заданные в окружении переменные
			// (иначе пустой DATABASE_URL из IDE/шела блокирует строку из файла).
			if err := godotenv.Overload(p); err != nil {
				log.Printf("godotenv: %s: %v", p, err)
			} else {
				log.Printf("loaded .env from %s", p)
			}
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	if err := godotenv.Overload(); err != nil {
		log.Printf("godotenv: %v (using process env only)", err)
	}
}
