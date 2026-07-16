package tenderplus

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dauren/tender/internal/authctx"
)

func TestBuildSavedLotUsesCanonicalSourceAndServerAudit(t *testing.T) {
	request := httptest.NewRequest("POST", "/api/v1/lots/participate", strings.NewReader(`{
		"id": 42,
		"status": "participating",
		"assigned_to": "Alice",
		"title": "ATTACKER TITLE",
		"amount": 999999999,
		"reviewer": "Mallory",
		"action_history": "[{\"reviewer\":\"Mallory\"}]",
		"created_at": "2001-01-01T00:00:00Z",
		"updated_at": "2001-01-01T00:00:00Z"
	}`))
	recorder := httptest.NewRecorder()
	var input participateLotInput
	if err := decodeWorkspaceJSON(recorder, request, &input); err != nil {
		t.Fatalf("decode input: %v", err)
	}

	amount := 1250000.0
	purchaseType := "Открытый конкурс"
	organizer := "Canonical organizer"
	start := time.Date(2026, 7, 1, 8, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 31, 18, 0, 0, 0, time.UTC)
	now := time.Date(2026, 7, 16, 10, 30, 0, 0, time.UTC)
	identity := authctx.Identity{UserID: 17, Name: "Alice", Role: "tender_specialist"}
	saved, err := buildSavedLot(parserLotSnapshot{
		ID:            42,
		ExternalID:    "LOT-42",
		Source:        "tenderplus",
		Title:         "Canonical title",
		Description:   "Canonical description",
		Amount:        &amount,
		StartDate:     &start,
		EndDate:       &end,
		PurchaseType:  &purchaseType,
		OrganizerName: &organizer,
		URL:           "https://example.test/lots/42",
	}, input, identity, now)
	if err != nil {
		t.Fatalf("build saved lot: %v", err)
	}

	if saved.Title != "Canonical title" || saved.Amount != amount || saved.OrganizerName != organizer {
		t.Fatalf("client overwrote canonical fields: %#v", saved)
	}
	if saved.Reviewer != identity.Name || saved.CreatedByUserID != identity.UserID || saved.UpdatedByUserID != identity.UserID {
		t.Fatalf("audit identity was not server-derived: %#v", saved)
	}
	if !saved.CreatedAt.Equal(now) || !saved.UpdatedAt.Equal(now) {
		t.Fatalf("client overwrote timestamps: created=%v updated=%v", saved.CreatedAt, saved.UpdatedAt)
	}
	assertHistoryActors(t, saved.ActionHistory, []string{"Alice"})
}

func TestUpdateSavedLotIgnoresSpoofedHistoryReviewerAndTimestamps(t *testing.T) {
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	existing := SavedLot{
		ID:              7,
		Title:           "Immutable title",
		Amount:          55,
		Status:          "review",
		AssignedTo:      "Alice",
		Reviewer:        "Original reviewer",
		ActionHistory:   `[{"status":"review","reviewer":"Original reviewer"}]`,
		Priority:        "normal",
		RiskLevel:       "medium",
		CreatedByUserID: 17,
		CreatedAt:       createdAt,
		UpdatedAt:       createdAt,
	}
	request := httptest.NewRequest("POST", "/api/v1/lots/participate", strings.NewReader(`{
		"id": 7,
		"status": "submitted",
		"comment": "legitimate transition",
		"title": "ATTACKER TITLE",
		"reviewer": "Mallory",
		"action_history": "[{\"reviewer\":\"Mallory\",\"status\":\"won\"}]",
		"created_at": "2001-01-01T00:00:00Z",
		"updated_at": "2001-01-01T00:00:00Z"
	}`))
	var input participateLotInput
	if err := decodeWorkspaceJSON(httptest.NewRecorder(), request, &input); err != nil {
		t.Fatalf("decode input: %v", err)
	}

	now := time.Date(2026, 7, 16, 11, 0, 0, 0, time.UTC)
	identity := authctx.Identity{UserID: 17, Name: "Alice", Role: "tender_specialist"}
	updated, err := updateSavedLot(existing, input, identity, now)
	if err != nil {
		t.Fatalf("update lot: %v", err)
	}
	if updated.Title != existing.Title || updated.Amount != existing.Amount || !updated.CreatedAt.Equal(createdAt) {
		t.Fatalf("immutable fields changed: %#v", updated)
	}
	if updated.Reviewer != "Alice" || updated.UpdatedByUserID != 17 || !updated.UpdatedAt.Equal(now) {
		t.Fatalf("server actor was not applied: %#v", updated)
	}
	assertHistoryActors(t, updated.ActionHistory, []string{"Original reviewer", "Alice"})
	if strings.Contains(updated.ActionHistory, "Mallory") {
		t.Fatalf("spoofed history survived: %s", updated.ActionHistory)
	}
}

func TestCommentAuthorIsAlwaysAuthenticatedUser(t *testing.T) {
	request := httptest.NewRequest("POST", "/api/v1/lots/9/comments", strings.NewReader(`{
		"author": "Mallory",
		"author_user_id": 999,
		"created_at": "2001-01-01T00:00:00Z",
		"body": "  Проверено  "
	}`))
	var input createCommentInput
	if err := decodeWorkspaceJSON(httptest.NewRecorder(), request, &input); err != nil {
		t.Fatalf("decode comment: %v", err)
	}
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	identity := authctx.Identity{UserID: 21, Name: "Trusted user", Role: "director"}
	comment := buildTenderComment(9, input.Body, identity, now)
	if comment.Author != identity.Name || comment.AuthorUserID != identity.UserID {
		t.Fatalf("spoofed author accepted: %#v", comment)
	}
	if comment.Body != "Проверено" || !comment.CreatedAt.Equal(now) {
		t.Fatalf("unexpected comment fields: %#v", comment)
	}
}

func TestSpecialistCannotMutateOrAssignAnotherUsersLot(t *testing.T) {
	identity := authctx.Identity{UserID: 17, Name: "Alice", Role: "tender_specialist"}
	unrelated := SavedLot{ID: 1, CreatedByUserID: 22, AssignedTo: "Bob", Reviewer: "Bob"}
	if err := authorizeSavedLotMutation(unrelated, identity); err == nil {
		t.Fatal("specialist was allowed to mutate an unrelated lot")
	}
	requested := "Bob"
	owned := SavedLot{ID: 2, CreatedByUserID: 17}
	if _, err := requestedAssignee(identity, owned, &requested); err == nil {
		t.Fatal("specialist was allowed to assign another user")
	}
	spoofedReviewer := SavedLot{ID: 3, CreatedByUserID: 22, UpdatedByUserID: 22, Reviewer: "Alice"}
	if err := authorizeSavedLotMutation(spoofedReviewer, identity); err == nil {
		t.Fatal("reviewer display label overrode stable ownership IDs")
	}
	manager := authctx.Identity{UserID: 1, Name: "Director", Role: "director"}
	if assigned, err := requestedAssignee(manager, owned, &requested); err != nil || assigned != requested {
		t.Fatalf("manager assignment rejected: assigned=%q err=%v", assigned, err)
	}
}

func assertHistoryActors(t *testing.T, raw string, want []string) {
	t.Helper()
	var entries []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if len(entries) != len(want) {
		t.Fatalf("history length=%d want=%d: %s", len(entries), len(want), raw)
	}
	for i, actor := range want {
		if got := entries[i]["reviewer"]; got != actor {
			t.Fatalf("history[%d] reviewer=%v want=%q", i, got, actor)
		}
	}
}
