# Responsive Design Specification

## 1. Breakpoints (Mobile-First Tailwind)

- **Mobile Base (`360px`–`639px`)**: Primary target for all Customer screens and pocket-mode Staff queue usage.
- **`sm` (`640px+`)**: 2-column ServiceCard grid on customer intake; side-by-side KPI metrics.
- **`md` (`768px+`)**: Tablet landscape/portrait (salon counter iPad); collapsible left sidebar replaces mobile bottom navigation.
- **`lg` (`1024px+`) / `xl` (`1280px+`)**: Desktop management views, multi-column queue lanes, analytics comparison tables.

---

## 2. Adaptive Shell Behavior

### Customer Pages (`/salon/[salonSlug]/[branchSlug]...`)
- Centered `max-w-xl` single-column shell (`px-4`), sticky bottom CTA bar with `env(safe-area-inset-bottom)` padding for modern iOS/Android gesture bars.

### Owner / Staff Workspace (`/owner/*`)
- **Mobile (`< md`)**: Compact top bar with **Branch Switcher** + fixed bottom navigation bar (`Dashboard`, `Queue`, `Services`, `QR`, `Settings`) ensuring 1-thumb operation at the styling chair.
- **Tablet & Desktop (`>= md`)**: Persistent `240px` sidebar with organization badge, branch switcher, role-filtered navigation items, and full-width workspace.

### Print Layout (`/owner/qr`)
- `@media print` hides sidebar/header/buttons and renders a crisp centered A4/A5 salon standee poster featuring Salon Name, Branch Name, high-res QR code, and scan instructions.
