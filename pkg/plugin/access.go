package plugin

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/authlib/authz"
	authcache "github.com/grafana/authlib/cache"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	actionTemplatesRead       = pluginID + ".templates:read"
	actionTemplatesPublish    = pluginID + ".templates:publish"
	actionTemplatesReview     = pluginID + ".templates:review"
	actionTemplatesApprove    = pluginID + ".templates:approve"
	actionTemplatesDelete     = pluginID + ".templates:delete"
	actionTemplatesInitialize = pluginID + ".templates:initialize"
)

type grafanaPermissionMap map[string][]string

type userPermissionLookup func(req *http.Request) (grafanaPermissionMap, bool, error)

type rbacChecker func(action string) (bool, error)

type MarketplaceAccess struct {
	Read          bool   `json:"read"`
	Publish       bool   `json:"publish"`
	Review        bool   `json:"review"`
	Approve       bool   `json:"approve"`
	Delete        bool   `json:"delete"`
	Initialize    bool   `json:"initialize"`
	OrgRole       string `json:"orgRole"`
	Source        string `json:"source"`
	RBACAvailable bool   `json:"rbacAvailable"`
	RBACError     string `json:"rbacError,omitempty"`
}

func defaultMarketplaceAccess(pluginCtx backend.PluginContext) MarketplaceAccess {
	if pluginCtx.User == nil {
		return MarketplaceAccess{
			OrgRole: "Viewer",
			Source:  "basic-role-fallback",
		}
	}

	level := roleLevel(userRole(pluginCtx))

	return MarketplaceAccess{
		Read:       level >= accessViewer,
		Publish:    level >= accessEditor,
		Review:     level >= accessAdmin,
		Approve:    level >= accessAdmin,
		Delete:     level >= accessAdmin,
		Initialize: level >= accessAdmin,
		OrgRole:    roleName(level),
		Source:     "basic-role-fallback",
	}
}

func userRole(pluginCtx backend.PluginContext) string {
	if pluginCtx.User == nil {
		return ""
	}

	return pluginCtx.User.Role
}

func (p *Plugin) handleGetAccess(rw http.ResponseWriter, req *http.Request, pluginCtx backend.PluginContext) {
	jsonResponse(rw, p.resolveMarketplaceAccess(req, pluginCtx), http.StatusOK)
}

func (p *Plugin) resolveMarketplaceAccess(req *http.Request, pluginCtx backend.PluginContext) MarketplaceAccess {
	access := defaultMarketplaceAccess(pluginCtx)

	if req == nil {
		return access
	}

	checker, available, err := p.getRBACChecker(req)
	if err != nil {
		access.RBACError = err.Error()
	}
	if !available || checker == nil {
		return access
	}

	access.RBACAvailable = true
	access.Source = "plugin-rbac+basic-role"
	access.Read = access.Read || p.checkRBACPermission(checker, actionTemplatesRead)
	access.Publish = access.Publish || p.checkRBACPermission(checker, actionTemplatesPublish)
	access.Review = access.Review || p.checkRBACPermission(checker, actionTemplatesReview)
	access.Approve = access.Approve || p.checkRBACPermission(checker, actionTemplatesApprove)
	access.Delete = access.Delete || p.checkRBACPermission(checker, actionTemplatesDelete)
	access.Initialize = access.Initialize || p.checkRBACPermission(checker, actionTemplatesInitialize)

	return access
}

func (p *Plugin) checkRBACPermission(checker rbacChecker, action string) bool {
	allowed, err := checker(action)
	if err != nil {
		p.logger.Warn("RBAC action check failed", "action", action, "error", err)
		return false
	}

	return allowed
}

func (p *Plugin) getRBACChecker(req *http.Request) (rbacChecker, bool, error) {
	if p.permissionLookup != nil {
		permissions, available, err := p.permissionLookup(req)
		if err != nil || !available {
			return nil, available, err
		}

		return func(action string) (bool, error) {
			_, exists := permissions[action]
			return exists, nil
		}, true, nil
	}

	idToken := req.Header.Get("X-Grafana-Id")
	if strings.TrimSpace(idToken) == "" {
		return nil, false, errors.New("Grafana ID token forwarding is unavailable")
	}

	authzClient, err := p.getAuthZClient(req)
	if err != nil {
		return nil, false, err
	}

	return func(action string) (bool, error) {
		return authzClient.HasAccess(req.Context(), idToken, action)
	}, true, nil
}

func (p *Plugin) getAuthZClient(req *http.Request) (authz.EnforcementClient, error) {
	ctx := req.Context()
	cfg := backend.GrafanaConfigFromContext(ctx)
	if cfg == nil {
		return nil, errors.New("Grafana config is unavailable in plugin context")
	}

	saToken, err := cfg.PluginAppClientSecret()
	if err != nil || saToken == "" {
		if err == nil {
			err = errors.New("managed service account token not found")
		}
		return nil, err
	}

	p.authzMu.Lock()
	defer p.authzMu.Unlock()

	if p.authzClient != nil && saToken == p.saToken {
		return p.authzClient, nil
	}

	grafanaURL, err := cfg.AppURL()
	if err != nil {
		return nil, fmt.Errorf("resolving Grafana app URL failed: %w", err)
	}

	client, err := authz.NewEnforcementClient(
		authz.Config{
			APIURL:  grafanaURL,
			Token:   saToken,
			JWKsURL: strings.TrimRight(grafanaURL, "/") + "/api/signing-keys/keys",
		},
		authz.WithSearchByPrefix(pluginID),
		authz.WithCache(authcache.NewLocalCache(authcache.Config{
			Expiry:          10 * time.Second,
			CleanupInterval: 5 * time.Second,
		})),
	)
	if err != nil {
		return nil, fmt.Errorf("initializing Grafana authz client failed: %w", err)
	}

	p.saToken = saToken
	p.authzClient = client

	return client, nil
}

func (p *Plugin) requireMarketplaceAccess(req *http.Request, pluginCtx backend.PluginContext, action, actionDescription string) error {
	if pluginCtx.User == nil {
		return &authorizationError{
			status:  http.StatusUnauthorized,
			message: fmt.Sprintf("authentication is required to %s", actionDescription),
		}
	}

	fallbackAccess := defaultMarketplaceAccess(pluginCtx)
	if hasMarketplaceAccess(fallbackAccess, action) {
		return nil
	}

	checker, available, err := p.getRBACChecker(req)
	if available && err == nil && checker != nil {
		allowed, checkErr := checker(action)
		if checkErr == nil && allowed {
			return nil
		}
		if checkErr != nil {
			err = checkErr
		}
	}

	if err != nil {
		p.logger.Warn("RBAC fallback to basic roles", "action", action, "error", err)
	}

	return &authorizationError{
		status:  http.StatusForbidden,
		message: fmt.Sprintf("%s role or the %q permission is required to %s", requiredRoleLabel(action), action, actionDescription),
	}
}

func hasMarketplaceAccess(access MarketplaceAccess, action string) bool {
	switch action {
	case actionTemplatesRead:
		return access.Read
	case actionTemplatesPublish:
		return access.Publish
	case actionTemplatesReview:
		return access.Review
	case actionTemplatesApprove:
		return access.Approve
	case actionTemplatesDelete:
		return access.Delete
	case actionTemplatesInitialize:
		return access.Initialize
	default:
		return false
	}
}

func requiredRoleLabel(action string) string {
	switch action {
	case actionTemplatesPublish:
		return "Editor"
	case actionTemplatesReview, actionTemplatesApprove, actionTemplatesDelete, actionTemplatesInitialize:
		return "Admin"
	default:
		return "Viewer"
	}
}
