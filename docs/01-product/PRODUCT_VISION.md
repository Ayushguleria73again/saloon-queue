# Product Vision — SalonFlow SaaS

## 1. Executive Summary

Independent neighborhood salons and multi-branch salon brands across India struggle with crowded waiting areas, unpredictable wait times, and manual paper token logs. Customers constantly interrupt staff to ask *"How many ahead?"*, while owners managing multiple stylists or branches have zero live operational visibility.

**SalonFlow** is a multi-tenant Software-as-a-Service (SaaS) platform that lets any salon onboard in minutes and operate branch-specific QR digital queues—with **zero app installation**, **strict FIFO fairness**, **real-time queue visibility**, and **Web Push notifications** for both salon teams and opt-in customers.

---

## 2. Vision Statement

> **For independent salons and multi-branch grooming brands**, SalonFlow is a unified multi-tenant SaaS queue platform where each branch receives an isolated QR intake page, strict FIFO token engine, live operations dashboard, and instant Web Push alerts—requiring **zero customer app downloads or customer accounts**, while delivering fast, reliable performance from a single modular monolithic deployment.

---

## 3. Core SaaS Pillars

1. **Instant Multi-Tenant Onboarding**:
   - Register a salon business (`Organization`), configure one or multiple branches (`Branch`), define services and staff permissions, and print branch QR posters immediately—without deploying separate instances.
2. **Strict Tenant & Branch Isolation**:
   - Every branch operates an independent queue, counter, QR URL (`/salon/{salon-slug}/{branch-slug}`), business hours, and service availability. Tenant boundaries are enforced across session resolution, composite keys, and PostgreSQL RLS.
3. **Zero-Friction Customer Journey (< 30 Seconds)**:
   - Scan QR -> Enter Name & 10-digit Indian Mobile -> Pick available Branch Services -> Submit -> Get atomic token (`A001`) and live status page with optional turn alerts.
4. **Native Web Push (Owner, Staff & Opt-In Customers)**:
   - Owners and branch staff receive instant multi-device browser/PWA push notifications on new walk-ins and queue alerts.
   - Customers explicitly opt in *only after* receiving their token to get notified when 3 ahead, 1 ahead, or called—gracefully degrading to live SSE/polling if declined or unsupported.
5. **Fast, Concurrency-Safe Operations**:
   - Atomic database counters, `FOR UPDATE SKIP LOCKED` queue calls, single-pass SSE updates, and transactional outbox background jobs guarantee reliability even during peak weekend rushes.

---

## 4. Platform Success Metrics

| Metric | Target |
| :--- | :--- |
| **Customer Token Creation Flow** | `< 30 seconds` median from QR scan to confirmation |
| **API Latency (Public Reads / Writes)** | `p95 < 80ms` reads; `p95 < 150ms` atomic token creation |
| **Token Collision Rate** | `0` duplicates under high concurrency |
| **Tenant Cross-Access Incidents** | `0` (verified via automated tenant-isolation suite + RLS) |
| **Notification Pipeline Reliability** | `0` tokens blocked or lost due to push provider errors |
