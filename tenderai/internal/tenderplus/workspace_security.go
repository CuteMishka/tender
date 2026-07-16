package tenderplus

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/dauren/tender/internal/authctx"
)

const maxWorkspaceRequestBytes int64 = 128 << 10

type workspaceRequestError struct {
	Status  int
	Message string
}

func (e *workspaceRequestError) Error() string { return e.Message }

func newWorkspaceRequestError(status int, message string) error {
	return &workspaceRequestError{Status: status, Message: message}
}

func workspaceIdentity(r *http.Request) (authctx.Identity, error) {
	identity, ok := authctx.IdentityFromContext(r.Context())
	identity.Name = strings.TrimSpace(identity.Name)
	identity.Role = strings.TrimSpace(identity.Role)
	if !ok || identity.Service || identity.UserID == 0 || identity.Name == "" {
		return authctx.Identity{}, newWorkspaceRequestError(http.StatusUnauthorized, "Требуется аутентификация")
	}
	switch identity.Role {
	case "admin", "director", "tender_specialist":
		return identity, nil
	default:
		return authctx.Identity{}, newWorkspaceRequestError(http.StatusForbidden, "Доступ запрещен")
	}
}

func isManagementIdentity(identity authctx.Identity) bool {
	return identity.Role == "admin" || identity.Role == "director"
}

func authorizeSavedLotMutation(lot SavedLot, identity authctx.Identity) error {
	if isManagementIdentity(identity) {
		return nil
	}
	if identity.Role != "tender_specialist" {
		return newWorkspaceRequestError(http.StatusForbidden, "Недостаточно прав")
	}
	if lot.CreatedByUserID != 0 && lot.CreatedByUserID == identity.UserID {
		return nil
	}
	if lot.UpdatedByUserID != 0 && lot.UpdatedByUserID == identity.UserID {
		return nil
	}
	if sameWorkspaceName(lot.AssignedTo, identity.Name) {
		return nil
	}
	// Before stable actor IDs were introduced, assignment/reviewer labels were
	// the only ownership information available. Keep that compatibility path
	// strictly limited to rows that have never received a server actor ID.
	if lot.CreatedByUserID == 0 && lot.UpdatedByUserID == 0 && sameWorkspaceName(lot.Reviewer, identity.Name) {
		return nil
	}
	return newWorkspaceRequestError(http.StatusForbidden, "Лот назначен другому пользователю")
}

func requestedAssignee(identity authctx.Identity, lot SavedLot, requested *string) (string, error) {
	if requested == nil {
		return strings.TrimSpace(lot.AssignedTo), nil
	}
	assignee := strings.TrimSpace(*requested)
	if isManagementIdentity(identity) || assignee == "" || sameWorkspaceName(assignee, identity.Name) {
		return assignee, nil
	}
	// Specialists may leave an existing assignment unchanged, but cannot
	// delegate the lot to an arbitrary person through a crafted request.
	if sameWorkspaceName(assignee, lot.AssignedTo) {
		return assignee, nil
	}
	return "", newWorkspaceRequestError(http.StatusForbidden, "Назначать другого ответственного может только руководитель")
}

func requestedTaskAssignee(identity authctx.Identity, lot SavedLot, current, requested string) (string, error) {
	assignee := strings.TrimSpace(requested)
	if isManagementIdentity(identity) || assignee == "" || sameWorkspaceName(assignee, identity.Name) ||
		sameWorkspaceName(assignee, lot.AssignedTo) || sameWorkspaceName(assignee, current) {
		return assignee, nil
	}
	return "", newWorkspaceRequestError(http.StatusForbidden, "Назначать задачу другому пользователю может только руководитель")
}

func sameWorkspaceName(left, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right)) && strings.TrimSpace(left) != ""
}

func decodeWorkspaceJSON(w http.ResponseWriter, r *http.Request, target interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkspaceRequestBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("request must contain one JSON value")
	}
	return nil
}

func writeWorkspaceRequestError(w http.ResponseWriter, err error, fallback string) {
	var requestErr *workspaceRequestError
	if errors.As(err, &requestErr) {
		writeWorkspaceError(w, requestErr.Status, requestErr.Message)
		return
	}
	writeWorkspaceError(w, http.StatusInternalServerError, fallback)
}
