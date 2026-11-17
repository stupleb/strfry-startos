package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// blocklist reads the package's Blocked Public Keys from a JSON object keyed by hex key.
type blocklist struct {
	path string

	mu     sync.Mutex
	readAt time.Time
	keys   map[string]bool
}

func (b *blocklist) has(pk string) bool {
	if b.path == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if time.Since(b.readAt) > 2*time.Second {
		var keys map[string]bool
		raw, err := os.ReadFile(b.path)
		if err == nil {
			err = json.Unmarshal(raw, &keys)
		}
		switch {
		case errors.Is(err, fs.ErrNotExist):
			b.keys = nil
		case err != nil:
			log.Printf("reading %s: %v", b.path, err)
		default:
			b.keys = keys
		}
		b.readAt = time.Now()
	}
	return b.keys[pk]
}

func (s *server) adminMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("PUT /member/{pubkey}", s.setMember)
	mux.HandleFunc("DELETE /member/{pubkey}", s.removeMember)
	return mux
}

func (s *server) setMember(w http.ResponseWriter, r *http.Request) {
	pk, ok := parsePubkey(r.PathValue("pubkey"))
	if !ok {
		fail(w, http.StatusBadRequest, "invalid public key")
		return
	}
	var req map[string]*int64
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	until, ok := req["until"]
	if !ok {
		fail(w, http.StatusBadRequest, "until is required")
		return
	}
	s.st.mu.Lock()
	defer s.st.mu.Unlock()
	old, found := s.st.Members[pk]
	m := old
	if !found {
		m.Since = time.Now().Unix()
	}
	m.Until = until
	s.st.Members[pk] = m
	if err := s.st.save(); err != nil {
		if found {
			s.st.Members[pk] = old
		} else {
			delete(s.st.Members, pk)
		}
		log.Printf("saving state: %v", err)
		fail(w, http.StatusInternalServerError, "saving state failed")
		return
	}
	log.Printf("%s set by the operator", encodeNpub(pk))
	writeJSON(w, http.StatusOK, m)
}

func (s *server) removeMember(w http.ResponseWriter, r *http.Request) {
	pk, ok := parsePubkey(r.PathValue("pubkey"))
	if !ok {
		fail(w, http.StatusBadRequest, "invalid public key")
		return
	}
	s.st.mu.Lock()
	defer s.st.mu.Unlock()
	old, found := s.st.Members[pk]
	if !found {
		fail(w, http.StatusNotFound, "not a paid member")
		return
	}
	delete(s.st.Members, pk)
	if err := s.st.save(); err != nil {
		s.st.Members[pk] = old
		log.Printf("saving state: %v", err)
		fail(w, http.StatusInternalServerError, "saving state failed")
		return
	}
	log.Printf("%s removed by the operator", encodeNpub(pk))
	w.WriteHeader(http.StatusNoContent)
}
