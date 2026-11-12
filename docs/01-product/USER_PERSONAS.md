# User Personas

## 1. Platform Administrator — *Vikram Mehta (SaaS Operations Lead)*
- **Role**: Manages the SalonFlow SaaS platform health, tenant onboarding checks, and operational support.
- **Goals**: View active/suspended organizations, track daily platform token throughput, inspect failed background job queues, suspend abusive spam tenants.
- **Constraints**: Respects customer PII privacy boundaries (sees aggregated tenant metrics and masked/non-PII operational diagnostics).

## 2. Salon Owner — *Neha Kapoor (Founder, "Aura Grooming Co." — 3 Branches)*
- **Role**: Owns 3 branches across Bengaluru (Indiranagar, Koramangala, HSR Layout).
- **Goals**: Register once, create all 3 branches with independent operating hours and branch-specific pricing, invite branch managers/stylists with least-privilege permissions, compare branch performance (wait time, completion rate, popular services), and get mobile Web Push notifications when queues surge.

## 3. Salon Staff / Receptionist — *Suresh Reddy (Lead Stylist, Koramangala Branch)*
- **Role**: Operates the Koramangala branch desk and styling chairs.
- **Goals**: Needs an uncluttered live queue screen on his phone/tablet to tap **"Call Next"**, **"Start Service"**, **"Complete"**, or **"Skip"**, plus Web Push alerts when a customer scans the branch QR.
- **Boundaries**: Restricted solely to Koramangala branch queue; cannot view Indiranagar financials, edit organization billing/settings, or manage other staff accounts.

## 4. Walk-In Customer — *Rahul Sharma (Walk-In Patron)*
- **Role**: Unregistered customer scanning the QR poster at Koramangala branch.
- **Goals**: Join the queue in `< 30 seconds` without downloading an app, monitor his turn live on his phone, and optionally tap *"Notify me when my turn is near"* to get browser push alerts at `3 ahead`, `1 ahead`, and when called.
- **Constraints**: Might be on iPhone Safari (requires Home Screen PWA guidance for push) or budget Android Chrome, and might decline notification permission entirely while still relying on the live status URL.
