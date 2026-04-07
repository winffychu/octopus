package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 3,
		Up:      ensureChannelKeyAdvancedColumns,
	})
}

// 003: 兼容历史库的 channel_keys 高级字段。
// 目标是确保 rpm_limit、concurrency_limit、cooldown_on_429_sec 三列都存在且列名正确。
func ensureChannelKeyAdvancedColumns(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	if !db.Migrator().HasTable("channel_keys") {
		return nil
	}

	if err := ensureChannelKeyColumn(db, "rpm_limit", "rpm_limit", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureChannelKeyColumn(db, "concurrency_limit", "concurrency_limit", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureChannelKeyColumn(db, "cooldown_on429_sec", "cooldown_on_429_sec", "INTEGER NOT NULL DEFAULT 30"); err != nil {
		return err
	}
	return nil
}

func ensureChannelKeyColumn(db *gorm.DB, legacyColumn, targetColumn, columnDDL string) error {
	if db.Migrator().HasColumn("channel_keys", legacyColumn) && !db.Migrator().HasColumn("channel_keys", targetColumn) {
		if err := db.Migrator().RenameColumn("channel_keys", legacyColumn, targetColumn); err != nil {
			return fmt.Errorf("failed to rename channel_keys.%s to %s: %w", legacyColumn, targetColumn, err)
		}
	}
	if db.Migrator().HasColumn("channel_keys", targetColumn) {
		return nil
	}
	if err := db.Exec(fmt.Sprintf("ALTER TABLE channel_keys ADD COLUMN %s %s", targetColumn, columnDDL)).Error; err != nil {
		return fmt.Errorf("failed to add channel_keys.%s: %w", targetColumn, err)
	}
	return nil
}
