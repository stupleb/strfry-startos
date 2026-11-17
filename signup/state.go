package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type member struct {
	// nil: access never expires
	Until *int64 `json:"until"`
	Since int64  `json:"since"`
}

type invoice struct {
	Pubkey     string   `json:"pubkey"`
	Bolt11     string   `json:"bolt11,omitempty"`
	Address    string   `json:"address,omitempty"`
	OnchainURI string   `json:"onchainUri,omitempty"`
	Created    int64    `json:"created"`
	ExpiresAt  int64    `json:"expiresAt"`
	Status     payState `json:"status"`
	Sats       int64    `json:"sats,omitempty"`
	PeriodDays *int64   `json:"periodDays,omitempty"`
	// BTC-CHAIN is offered but not yet activated
	OnchainAvailable bool `json:"onchainAvailable,omitempty"`
	// what the payment bought, once credited
	Until *int64 `json:"until,omitempty"`

	nextCheck time.Time
}

// One file, so a payment and the membership it buys are written together.
type stateFile struct {
	Members  map[string]member   `json:"members"`
	Invoices map[string]*invoice `json:"invoices"`
}

type state struct {
	mu   sync.Mutex
	path string
	stateFile
}

func loadState(dir string) (*state, error) {
	s := &state{path: filepath.Join(dir, "state.json")}
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(raw, &s.stateFile); err != nil {
			return nil, err
		}
	}
	if s.Members == nil {
		s.Members = map[string]member{}
	}
	if s.Invoices == nil {
		s.Invoices = map[string]*invoice{}
	}
	return s, nil
}

// save must be called with mu held.
func (s *state) save() error {
	raw, err := json.MarshalIndent(s.stateFile, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(raw)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// credit must be called with mu held; periodDays applies to invoices that predate their own.
func (s *state) credit(inv *invoice, periodDays int64, now time.Time) {
	if inv.PeriodDays != nil {
		periodDays = *inv.PeriodDays
	}
	m, ok := s.Members[inv.Pubkey]
	if !ok {
		m.Since = now.Unix()
	}
	switch {
	case periodDays == 0 || (ok && m.Until == nil):
		m.Until = nil
	default:
		from := now.Unix()
		if m.Until != nil && *m.Until > from {
			from = *m.Until
		}
		until := from + periodDays*86400
		m.Until = &until
	}
	s.Members[inv.Pubkey] = m
	inv.Status = statePaid
	inv.Until = m.Until
}

// prune must be called with mu held.
func (s *state) prune(now time.Time) bool {
	changed := false
	for id, inv := range s.Invoices {
		done := inv.Status == statePaid || inv.Status == stateExpired
		if done && now.Unix() > inv.ExpiresAt+86400 {
			delete(s.Invoices, id)
			changed = true
		}
	}
	return changed
}
