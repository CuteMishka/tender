package api

import (
	"sync"
	"time"
)

// Документы тендеров на goszakup/tenderplus неизменяемы (ссылки вида
// /files/download_file/{id}/), поэтому скачанные байты можно безопасно
// кэшировать в памяти. Cloudy переотправляет выбранные документы на каждый
// вопрос диалога, и без кэша один и тот же PDF/DOCX качается заново каждый раз —
// это и есть главный источник 30-секундной задержки ответа.
//
// Кэш ограничен по СУММАРНОМУ размеру (а не только по числу записей), потому что
// один документ может быть до FETCH_DOCUMENT_MAX_BYTES (по умолчанию 50MB), а на
// VM мало свободной RAM. Превышение лимита вытесняет старые записи.

const (
	docCacheMaxTotalBytes = 200 * 1024 * 1024 // суммарный потолок кэша
	docCacheMaxEntryBytes = 25 * 1024 * 1024  // документы крупнее не кэшируем
)

type cachedDocument struct {
	data      []byte
	expiresAt time.Time
	insertSeq uint64
}

type documentCache struct {
	mu         sync.Mutex
	entries    map[string]cachedDocument
	ttl        time.Duration
	totalBytes int64
	seq        uint64
}

var docBytesCache = &documentCache{
	entries: make(map[string]cachedDocument),
	ttl:     2 * time.Hour,
}

func (c *documentCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		c.totalBytes -= int64(len(entry.data))
		delete(c.entries, key)
		return nil, false
	}
	return entry.data, true
}

func (c *documentCache) set(key string, data []byte) {
	if key == "" || len(data) == 0 || len(data) > docCacheMaxEntryBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.entries[key]; ok {
		c.totalBytes -= int64(len(existing.data))
		delete(c.entries, key)
	}

	c.evictExpiredLocked()
	c.evictUntilFitsLocked(int64(len(data)))

	c.seq++
	c.entries[key] = cachedDocument{
		data:      data,
		expiresAt: time.Now().Add(c.ttl),
		insertSeq: c.seq,
	}
	c.totalBytes += int64(len(data))
}

func (c *documentCache) evictExpiredLocked() {
	now := time.Now()
	for k, v := range c.entries {
		if now.After(v.expiresAt) {
			c.totalBytes -= int64(len(v.data))
			delete(c.entries, k)
		}
	}
}

// evictUntilFitsLocked вытесняет самые старые записи (по insertSeq), пока новая
// запись размером incoming не уместится в потолок.
func (c *documentCache) evictUntilFitsLocked(incoming int64) {
	for c.totalBytes+incoming > docCacheMaxTotalBytes && len(c.entries) > 0 {
		var oldestKey string
		var oldestSeq uint64 = ^uint64(0)
		for k, v := range c.entries {
			if v.insertSeq < oldestSeq {
				oldestSeq = v.insertSeq
				oldestKey = k
			}
		}
		if oldestKey == "" {
			break
		}
		c.totalBytes -= int64(len(c.entries[oldestKey].data))
		delete(c.entries, oldestKey)
	}
}
