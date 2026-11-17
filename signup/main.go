// strfry-signup serves a relay's public sign-up page: it sells write access to a
// Nostr public key for a payment through LNbits or BTCPay Server, and records
// members in state.json, which the package turns into strfry's write policy.
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"rsc.io/qr"
)

//go:embed web
var webFS embed.FS

const (
	maxPending      = 100
	ipWindow        = 10 * time.Minute
	invoicesPerIP   = 10
	reuseMinimum    = 2 * time.Minute
	processingLimit = 48 * time.Hour
	// how long a payment keeps being checked while the backend errors
	unreachableLimit = 24 * time.Hour
	blockedMsg       = "This public key may not publish to this relay."
)

type relayInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	URL         string `json:"url"`
	Terms       string `json:"terms"`
	Privacy     string `json:"privacy"`
	Contact     string `json:"contact"`
}

type server struct {
	accepting  bool
	priceSats  int64
	periodDays int64
	relay      relayInfo
	backend    backend
	st         *state
	blocked    blocklist
	// invoices being created, counted toward maxPending; guarded by st.mu
	reserved int
	page     *template.Template

	limitMu sync.Mutex
	byIP    map[string][]time.Time

	healthMu  sync.Mutex
	healthAt  time.Time
	healthErr error
}

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok {
		return v
	}
	return def
}

func envInt(k string) int64 {
	n, err := strconv.ParseInt(os.Getenv(k), 10, 64)
	if err != nil {
		log.Fatalf("%s must be an integer: %v", k, err)
	}
	return n
}

func main() {
	s := &server{
		accepting:  env("SIGNUP_ACCEPTING", "true") == "true",
		priceSats:  envInt("SIGNUP_PRICE_SATS"),
		periodDays: envInt("SIGNUP_PERIOD_DAYS"),
		relay: relayInfo{
			Name:        env("RELAY_NAME", ""),
			Description: env("RELAY_DESCRIPTION", ""),
			Icon:        httpsOnly(env("RELAY_ICON", "")),
			URL:         env("RELAY_URL", ""),
			Terms:       httpsOnly(env("RELAY_TERMS", "")),
			Privacy:     httpsOnly(env("RELAY_PRIVACY", "")),
			Contact:     env("RELAY_CONTACT", ""),
		},
		byIP:    map[string][]time.Time{},
		blocked: blocklist{path: os.Getenv("SIGNUP_BLOCKED_FILE")},
	}
	if s.priceSats < 1 || s.periodDays < 0 {
		log.Fatal("SIGNUP_PRICE_SATS must be at least 1 and SIGNUP_PERIOD_DAYS at least 0")
	}
	if ca := os.Getenv("SIGNUP_ROOT_CA"); ca != "" {
		if err := trustRootCA(ca); err != nil {
			log.Fatal(err)
		}
	}
	base := strings.TrimRight(os.Getenv("SIGNUP_BACKEND_URL"), "/")
	switch kind := os.Getenv("SIGNUP_BACKEND"); {
	case base == "":
		log.Printf("no address for the %s payment backend: payments are unavailable", kind)
	case kind == "lnbits":
		s.backend = lnbits{base: base, key: os.Getenv("SIGNUP_LNBITS_KEY")}
	case kind == "btcpay":
		s.backend = btcpay{base: base, store: os.Getenv("SIGNUP_BTCPAY_STORE"), key: os.Getenv("SIGNUP_BTCPAY_KEY")}
	default:
		log.Fatalf("unknown SIGNUP_BACKEND %q", kind)
	}

	var err error
	if s.st, err = loadState(env("SIGNUP_DATA", "/var/lib/signup")); err != nil {
		log.Fatalf("reading state: %v", err)
	}
	if s.page, err = template.New("index.html").Funcs(template.FuncMap{"sats": groupThousands}).ParseFS(webFS, "web/index.html"); err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go s.poll(ctx)

	static, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.index)
	mux.Handle("GET /app.js", http.FileServerFS(static))
	mux.Handle("GET /app.css", http.FileServerFS(static))
	mux.HandleFunc("GET /api/member/{pubkey}", s.memberStatus)
	mux.HandleFunc("POST /api/invoice", s.createInvoice)
	mux.HandleFunc("GET /api/invoice/{id}", s.invoiceStatus)
	mux.HandleFunc("POST /api/invoice/{id}/onchain", s.onchain)
	mux.HandleFunc("GET /healthz", s.healthz)

	srv := &http.Server{
		Addr:              env("SIGNUP_LISTEN", ":8080"),
		Handler:           headers(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	// the operator's member edits; bound to loopback, which only the package's own processes share
	admin := &http.Server{
		Addr:              env("SIGNUP_ADMIN_LISTEN", "127.0.0.1:8081"),
		Handler:           s.adminMux(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := admin.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		admin.Shutdown(shutdown)
		srv.Shutdown(shutdown)
	}()
	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func groupThousands(n int64) string {
	d := strconv.FormatInt(n, 10)
	for i := len(d) - 3; i > 0; i -= 3 {
		d = d[:i] + "," + d[i:]
	}
	return d
}

func httpsOnly(u string) string {
	if strings.HasPrefix(u, "https://") {
		return u
	}
	return ""
}

func headers(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		hd.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		hd.Set("X-Content-Type-Options", "nosniff")
		hd.Set("Referrer-Policy", "no-referrer")
		hd.Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) available() bool { return s.accepting && s.backend != nil }

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	s.page.Execute(w, map[string]any{
		"Relay":       s.relay,
		"PriceSats":   s.priceSats,
		"PeriodDays":  s.periodDays,
		"Accepting":   s.accepting,
		"Available":   s.available(),
		"ContactHref": contactHref(s.relay.Contact),
		"ContactText": contactText(s.relay.Contact),
	})
}

func contactText(c string) string {
	for _, scheme := range []string{"mailto:", "https://"} {
		if t, ok := strings.CutPrefix(c, scheme); ok {
			return strings.TrimSuffix(t, "/")
		}
	}
	return c
}

func contactHref(c string) string {
	if strings.HasPrefix(c, "mailto:") || strings.HasPrefix(c, "https://") {
		return c
	}
	local, domain, ok := strings.Cut(c, "@")
	if ok && local != "" && strings.Contains(domain, ".") && !strings.ContainsAny(domain, "@ :/<>") && !strings.ContainsAny(local, " :/<>") {
		return "mailto:" + c
	}
	return ""
}

func (s *server) memberStatus(w http.ResponseWriter, r *http.Request) {
	pk, ok := parsePubkey(r.PathValue("pubkey"))
	if !ok {
		fail(w, http.StatusBadRequest, "That is not a valid npub or hex public key.")
		return
	}
	s.st.mu.Lock()
	m, found := s.st.Members[pk]
	s.st.mu.Unlock()
	active := found && (m.Until == nil || *m.Until > time.Now().Unix())
	writeJSON(w, http.StatusOK, map[string]any{"pubkey": pk, "npub": encodeNpub(pk), "member": found, "active": active, "until": m.Until, "blocked": s.blocked.has(pk)})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

// rateKey groups an IPv6 client by its /64, the block one subscriber controls.
func rateKey(ip string) string {
	a := net.ParseIP(ip)
	if a == nil || a.To4() != nil {
		return ip
	}
	return a.Mask(net.CIDRMask(64, 128)).String()
}

func (s *server) allow(ip string, now time.Time) bool {
	s.limitMu.Lock()
	defer s.limitMu.Unlock()
	recent := s.byIP[ip][:0]
	for _, t := range s.byIP[ip] {
		if now.Sub(t) < ipWindow {
			recent = append(recent, t)
		}
	}
	if len(recent) >= invoicesPerIP {
		s.byIP[ip] = recent
		return false
	}
	s.byIP[ip] = append(recent, now)
	for k, ts := range s.byIP {
		if len(ts) == 0 || now.Sub(ts[len(ts)-1]) >= ipWindow {
			delete(s.byIP, k)
		}
	}
	return true
}

type invoiceView struct {
	ID               string   `json:"id"`
	Status           payState `json:"status"`
	AmountSats       int64    `json:"amountSats"`
	ExpiresAt        int64    `json:"expiresAt"`
	Until            *int64   `json:"until,omitempty"`
	Bolt11           string   `json:"bolt11,omitempty"`
	LightningQR      string   `json:"lightningQr,omitempty"`
	Address          string   `json:"address,omitempty"`
	OnchainURI       string   `json:"onchainUri,omitempty"`
	OnchainQR        string   `json:"onchainQr,omitempty"`
	OnchainAvailable bool     `json:"onchainAvailable,omitempty"`
}

func qrDataURL(text string) string {
	if text == "" {
		return ""
	}
	c, err := qr.Encode(text, qr.M)
	if err != nil {
		return ""
	}
	c.Scale = 5
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(c.PNG())
}

func (s *server) view(id string, inv *invoice, withQR bool) invoiceView {
	v := invoiceView{ID: id, Status: inv.Status, AmountSats: inv.Sats, ExpiresAt: inv.ExpiresAt, Until: inv.Until}
	if v.AmountSats == 0 {
		v.AmountSats = s.priceSats
	}
	if inv.Status == statePending {
		v.Bolt11, v.Address, v.OnchainURI = inv.Bolt11, inv.Address, inv.OnchainURI
		v.OnchainAvailable = inv.OnchainAvailable && inv.Address == ""
		if withQR {
			if inv.Bolt11 != "" {
				v.LightningQR = qrDataURL("lightning:" + strings.ToUpper(inv.Bolt11))
			}
			v.OnchainQR = qrDataURL(inv.OnchainURI)
		}
	}
	return v
}

func (s *server) createInvoice(w http.ResponseWriter, r *http.Request) {
	if !s.available() {
		fail(w, http.StatusServiceUnavailable, "This relay is not taking payments right now.")
		return
	}
	var req struct {
		Pubkey string `json:"pubkey"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "Bad request.")
		return
	}
	pk, ok := parsePubkey(req.Pubkey)
	if !ok {
		fail(w, http.StatusBadRequest, "That is not a valid npub or hex public key.")
		return
	}
	if s.blocked.has(pk) {
		fail(w, http.StatusForbidden, blockedMsg)
		return
	}
	now := time.Now()
	if !s.allow(rateKey(clientIP(r)), now) {
		fail(w, http.StatusTooManyRequests, "Too many invoices from your address. Try again in a few minutes.")
		return
	}

	s.st.mu.Lock()
	if m, found := s.st.Members[pk]; found && m.Until == nil {
		s.st.mu.Unlock()
		fail(w, http.StatusConflict, "This public key already has permanent write access.")
		return
	}
	pending := s.reserved
	var reuseID string
	var reuse invoice
	for id, inv := range s.st.Invoices {
		if inv.Status != statePending || inv.ExpiresAt <= now.Unix() {
			continue
		}
		pending++
		if inv.Pubkey == pk && time.Unix(inv.ExpiresAt, 0).Sub(now) > reuseMinimum {
			reuseID, reuse = id, *inv
		}
	}
	full := reuseID == "" && pending >= maxPending
	if reuseID == "" && !full {
		s.reserved++
	}
	s.st.mu.Unlock()
	if reuseID != "" {
		writeJSON(w, http.StatusOK, s.view(reuseID, &reuse, true))
		return
	}
	if full {
		fail(w, http.StatusTooManyRequests, "Too many sign-ups are waiting for payment. Try again in a few minutes.")
		return
	}
	defer func() {
		s.st.mu.Lock()
		s.reserved--
		s.st.mu.Unlock()
	}()

	npub := encodeNpub(pk)
	memo := "Write access to " + s.relay.Name + " for " + npub[:12] + "…" + npub[len(npub)-6:]
	if s.relay.Name == "" {
		memo = "Relay write access for " + npub[:12] + "…" + npub[len(npub)-6:]
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	ni, err := s.backend.create(ctx, s.priceSats, memo, pk)
	if err != nil {
		log.Printf("creating invoice: %v", err)
		fail(w, http.StatusBadGateway, "Payments are unavailable right now. Try again later.")
		return
	}
	period := s.periodDays
	inv := &invoice{
		Pubkey: pk, Bolt11: ni.bolt11, Address: ni.address, OnchainURI: ni.onchainURI,
		Created: now.Unix(), ExpiresAt: ni.expiresAt, Status: statePending,
		Sats: s.priceSats, PeriodDays: &period, OnchainAvailable: ni.onchain,
		nextCheck: now,
	}
	s.st.mu.Lock()
	s.st.Invoices[ni.id] = inv
	err = s.st.save()
	stored := *inv
	s.st.mu.Unlock()
	if err != nil {
		log.Printf("saving state: %v", err)
		fail(w, http.StatusInternalServerError, "Something went wrong. Try again.")
		return
	}
	log.Printf("invoice %s created for %s", ni.id, npub)
	writeJSON(w, http.StatusCreated, s.view(ni.id, &stored, true))
}

type onchainBackend interface {
	onchainAddress(ctx context.Context, id string) (address, uri string, err error)
}

func (s *server) onchain(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ob, supported := s.backend.(onchainBackend)
	s.st.mu.Lock()
	inv, found := s.st.Invoices[id]
	if !found {
		s.st.mu.Unlock()
		fail(w, http.StatusNotFound, "Unknown invoice.")
		return
	}
	current := *inv
	s.st.mu.Unlock()
	if current.Address != "" || current.Status != statePending {
		writeJSON(w, http.StatusOK, s.view(id, &current, true))
		return
	}
	if !supported || !current.OnchainAvailable {
		fail(w, http.StatusConflict, "This invoice can't be paid on-chain.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	address, uri, err := ob.onchainAddress(ctx, id)
	if err != nil {
		log.Printf("activating on-chain payment for invoice %s: %v", id, err)
		fail(w, http.StatusBadGateway, "On-chain payment is unavailable right now. Pay with Lightning, or try again later.")
		return
	}
	s.st.mu.Lock()
	if inv, found = s.st.Invoices[id]; found && inv.Address == "" {
		inv.Address, inv.OnchainURI = address, uri
		if err := s.st.save(); err != nil {
			log.Printf("saving state: %v", err)
		}
	}
	if found {
		current = *inv
	}
	s.st.mu.Unlock()
	writeJSON(w, http.StatusOK, s.view(id, &current, true))
}

func (s *server) invoiceStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.st.mu.Lock()
	defer s.st.mu.Unlock()
	inv, ok := s.st.Invoices[id]
	if !ok {
		fail(w, http.StatusNotFound, "Unknown invoice.")
		return
	}
	writeJSON(w, http.StatusOK, s.view(id, inv, false))
}

func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	if host, _, _ := net.SplitHostPort(r.RemoteAddr); !net.ParseIP(host).IsLoopback() || r.Header.Get("X-Forwarded-For") != "" {
		http.NotFound(w, r)
		return
	}
	if s.backend == nil {
		fail(w, http.StatusServiceUnavailable, "no payment backend address")
		return
	}
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	if time.Since(s.healthAt) > 30*time.Second {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		s.healthErr = s.backend.check(ctx)
		cancel()
		s.healthAt = time.Now()
	}
	if s.healthErr != nil {
		fail(w, http.StatusServiceUnavailable, s.healthErr.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) poll(ctx context.Context) {
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if s.backend == nil {
			continue
		}
		now := time.Now()
		type due struct {
			id  string
			inv invoice
		}
		var work []due
		s.st.mu.Lock()
		changed := s.st.prune(now)
		for id, inv := range s.st.Invoices {
			if (inv.Status == statePending || inv.Status == stateProcessing) && !now.Before(inv.nextCheck) {
				work = append(work, due{id, *inv})
			}
		}
		if changed {
			if err := s.st.save(); err != nil {
				log.Printf("saving state: %v", err)
			}
		}
		s.st.mu.Unlock()

		for _, d := range work {
			cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			st, err := s.backend.status(cctx, d.id)
			cancel()
			now := time.Now()
			if err != nil {
				log.Printf("checking invoice %s: %v", d.id, err)
				st = d.inv.Status
			}
			limit := d.inv.ExpiresAt + 600
			if st == stateProcessing {
				limit = d.inv.Created + int64(processingLimit.Seconds())
			}
			if err != nil {
				limit = max(limit, d.inv.ExpiresAt+int64(unreachableLimit.Seconds()))
			}
			expired := now.Unix() > limit
			if st != statePaid && expired {
				st = stateExpired
			}

			s.st.mu.Lock()
			inv, ok := s.st.Invoices[d.id]
			if !ok || inv.Status == statePaid || inv.Status == stateExpired {
				s.st.mu.Unlock()
				continue
			}
			before := inv.Status
			switch st {
			case statePaid:
				s.st.credit(inv, s.periodDays, now)
			default:
				inv.Status = st
			}
			inv.nextCheck = now.Add(checkInterval(inv, now))
			if inv.Status != before {
				if err := s.st.save(); err != nil {
					log.Printf("saving state: %v", err)
				}
			}
			s.st.mu.Unlock()
			if st == statePaid {
				log.Printf("invoice %s paid: %s is a member", d.id, encodeNpub(inv.Pubkey))
			}
		}
	}
}

func checkInterval(inv *invoice, now time.Time) time.Duration {
	if inv.Status == stateProcessing || now.Unix() > inv.ExpiresAt {
		return time.Minute
	}
	return 3 * time.Second
}

func parsePubkey(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) == 64 {
		if _, err := hex.DecodeString(s); err == nil {
			return s, true
		}
		return "", false
	}
	b, ok := bech32Decode(s, "npub")
	if !ok || len(b) != 32 {
		return "", false
	}
	return hex.EncodeToString(b), true
}
