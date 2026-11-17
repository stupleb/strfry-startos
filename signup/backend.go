package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type payState string

const (
	statePending    payState = "pending"
	stateProcessing payState = "processing"
	statePaid       payState = "paid"
	stateExpired    payState = "expired"
)

type newInvoice struct {
	id         string
	bolt11     string
	address    string
	onchainURI string
	expiresAt  int64
	onchain    bool
}

type backend interface {
	create(ctx context.Context, sats int64, memo, pubkey string) (newInvoice, error)
	status(ctx context.Context, id string) (payState, error)
	check(ctx context.Context) error
}

const invoiceLifetime = 15 * time.Minute

func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

var httpClient = &http.Client{Timeout: 20 * time.Second, CheckRedirect: noRedirect}

func trustRootCA(pem string) error {
	pool, err := x509.SystemCertPool()
	if err != nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM([]byte(pem)) {
		return errors.New("SIGNUP_ROOT_CA holds no PEM certificate")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{RootCAs: pool}
	httpClient = &http.Client{Timeout: 20 * time.Second, Transport: tr, CheckRedirect: noRedirect}
	return nil
}

func call(ctx context.Context, method, endpoint string, header http.Header, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, rd)
	if err != nil {
		return err
	}
	for k, v := range header {
		req.Header[k] = v
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 300 {
			msg = strings.ToValidUTF8(msg[:300], "") + "…"
		}
		return fmt.Errorf("%s %s: HTTP %d: %s", method, endpoint, res.StatusCode, msg)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

type lnbits struct {
	base string
	key  string
}

func (l lnbits) header() http.Header { return http.Header{"X-Api-Key": {l.key}} }

func (l lnbits) create(ctx context.Context, sats int64, memo, _ string) (newInvoice, error) {
	var res struct {
		PaymentHash string `json:"payment_hash"`
		Bolt11      string `json:"bolt11"`
	}
	err := call(ctx, http.MethodPost, l.base+"/api/v1/payments", l.header(), map[string]any{
		"out":    false,
		"amount": sats,
		"unit":   "sat",
		"memo":   memo,
		"expiry": int(invoiceLifetime.Seconds()),
	}, &res)
	if err != nil {
		return newInvoice{}, err
	}
	if res.PaymentHash == "" || res.Bolt11 == "" {
		return newInvoice{}, errors.New("LNbits returned no invoice")
	}
	return newInvoice{id: res.PaymentHash, bolt11: res.Bolt11, expiresAt: time.Now().Add(invoiceLifetime).Unix()}, nil
}

func (l lnbits) status(ctx context.Context, id string) (payState, error) {
	var res struct {
		Paid   bool   `json:"paid"`
		Status string `json:"status"`
	}
	if err := call(ctx, http.MethodGet, l.base+"/api/v1/payments/"+url.PathEscape(id), l.header(), nil, &res); err != nil {
		return "", err
	}
	switch {
	case res.Paid:
		return statePaid, nil
	case res.Status == "failed":
		return stateExpired, nil
	}
	return statePending, nil
}

func (l lnbits) check(ctx context.Context) error {
	return call(ctx, http.MethodGet, l.base+"/api/v1/wallet", l.header(), nil, nil)
}

type btcpay struct {
	base  string
	store string
	key   string
}

func (b btcpay) header() http.Header { return http.Header{"Authorization": {"token " + b.key}} }

func (b btcpay) invoices() string {
	return b.base + "/api/v1/stores/" + url.PathEscape(b.store) + "/invoices"
}

type btcpayMethod struct {
	ID          string `json:"paymentMethodId"`
	Activated   bool   `json:"activated"`
	Destination string `json:"destination"`
	PaymentLink string `json:"paymentLink"`
}

func (b btcpay) methods(ctx context.Context, id string) ([]btcpayMethod, error) {
	var ms []btcpayMethod
	err := call(ctx, http.MethodGet, b.invoices()+"/"+url.PathEscape(id)+"/payment-methods", b.header(), nil, &ms)
	return ms, err
}

func (b btcpay) create(ctx context.Context, sats int64, memo, pubkey string) (newInvoice, error) {
	var res struct {
		ID             string `json:"id"`
		ExpirationTime int64  `json:"expirationTime"`
	}
	err := call(ctx, http.MethodPost, b.invoices(), b.header(), map[string]any{
		"amount":   strconv.FormatInt(sats, 10),
		"currency": "SATS",
		"metadata": map[string]any{"itemDesc": memo, "nostrPubkey": pubkey},
		"checkout": map[string]any{"expirationMinutes": int(invoiceLifetime.Minutes())},
	}, &res)
	if err != nil {
		return newInvoice{}, err
	}
	inv := newInvoice{id: res.ID, expiresAt: res.ExpirationTime}
	if inv.expiresAt == 0 {
		inv.expiresAt = time.Now().Add(invoiceLifetime).Unix()
	}
	ms, err := b.methods(ctx, res.ID)
	if err != nil {
		return newInvoice{}, err
	}
	// BTC-CHAIN waits for the visitor: each activation derives a new wallet address.
	first := "BTC-LN"
	if !hasMethod(ms, first) {
		first = "BTC-CHAIN"
	}
	for _, m := range ms {
		if m.ID == first && !m.Activated {
			if err := b.activate(ctx, res.ID, m.ID); err != nil {
				return newInvoice{}, err
			}
			if ms, err = b.methods(ctx, res.ID); err != nil {
				return newInvoice{}, err
			}
			break
		}
	}
	for _, m := range ms {
		if !m.Activated {
			continue
		}
		switch m.ID {
		case "BTC-LN":
			inv.bolt11 = m.Destination
		case "BTC-CHAIN":
			inv.address, inv.onchainURI = m.Destination, bitcoinURI(m.PaymentLink, m.Destination)
		}
	}
	inv.onchain = inv.address == "" && hasMethod(ms, "BTC-CHAIN")
	if inv.bolt11 == "" && inv.address == "" {
		return newInvoice{}, errors.New("the BTCPay store offers neither Lightning nor on-chain Bitcoin")
	}
	return inv, nil
}

func hasMethod(ms []btcpayMethod, id string) bool {
	for _, m := range ms {
		if m.ID == id {
			return true
		}
	}
	return false
}

func bitcoinURI(link, address string) string {
	if strings.HasPrefix(strings.ToLower(link), "bitcoin:") {
		return link
	}
	return "bitcoin:" + address
}

func (b btcpay) activate(ctx context.Context, id, method string) error {
	return call(ctx, http.MethodPost, b.invoices()+"/"+url.PathEscape(id)+"/payment-methods/"+url.PathEscape(method)+"/activate", b.header(), nil, nil)
}

func (b btcpay) onchainAddress(ctx context.Context, id string) (address, uri string, err error) {
	for attempt := 0; attempt < 2; attempt++ {
		ms, err := b.methods(ctx, id)
		if err != nil {
			return "", "", err
		}
		for _, m := range ms {
			switch {
			case m.ID != "BTC-CHAIN":
			case m.Activated && m.Destination != "":
				return m.Destination, bitcoinURI(m.PaymentLink, m.Destination), nil
			case attempt == 0:
				if err := b.activate(ctx, id, m.ID); err != nil {
					return "", "", err
				}
			}
		}
	}
	return "", "", errors.New("the BTCPay invoice has no on-chain address")
}

func (b btcpay) status(ctx context.Context, id string) (payState, error) {
	var res struct {
		Status string `json:"status"`
	}
	if err := call(ctx, http.MethodGet, b.invoices()+"/"+url.PathEscape(id), b.header(), nil, &res); err != nil {
		return "", err
	}
	switch res.Status {
	case "Settled":
		return statePaid, nil
	case "Processing":
		return stateProcessing, nil
	case "Expired", "Invalid":
		return stateExpired, nil
	}
	return statePending, nil
}

func (b btcpay) check(ctx context.Context) error {
	return call(ctx, http.MethodGet, b.invoices()+"?take=1", b.header(), nil, nil)
}
