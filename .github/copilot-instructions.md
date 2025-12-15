# Journals KE AI Guide

## Quick Project Map
- `server/` is a Django 5.2 project configured for MySQL; settings live in `server/settings.py` and assume credentials provided by `my_secrets.py`.
- `api/` is the sole Django app and is registered with `rest_framework`; expect new endpoints to go here using DRF serializers/viewsets.
- `client/` hosts an Angular 21 standalone SSR project (Angular CLI) with entrypoints in `src/main.ts` and `src/server.ts`.

## Environment & Secrets
- Create `my_secrets.py` from `my_secrets.example.py`; the Django settings import `directory_secrets` (note the spelling) so keep that dict name exact.
- The committed `my_secrets.py` currently defines `derectory_secrets`; fix or mirror that key before relying on it to avoid `NameError`.
- Backend assumes `mysqlclient` (or another MySQL driver) is installed and reachable; no `requirements.txt` is present, so document added dependencies.

## Backend Conventions
- Use Django REST Framework patterns: add serializers, viewsets, and URL routing under `api/`; keep URLs unified through `server/urls.py`.
- Migrations should live in `api/migrations/`; run `python manage.py makemigrations api` then `python manage.py migrate` after schema edits.
- `corsheaders` is already wired in middleware; keep it listed before `CommonMiddleware` when modifying middleware stacks.
- Default CORS whitelist covers the Angular dev server (`http://localhost:4200`); extend it if additional frontends appear.
- Custom auth lives in `api/models.py` (`User` + `UserToken`) with email-only login; keep `AUTH_USER_MODEL` as `api.User` when adding related models.
- JWT auth uses `rest_framework_simplejwt`; refresh tokens rotate (`SIMPLE_JWT` in `server/settings.py`). Stub access endpoints under `/api/auth/*`.
- Always prefer using class-based views (CBVs) with DRF generics/viewsets; use function-based views (FBVs) only for very simple or unique cases.
- Email sending uses Django's templated email system; templates are in `api/templates/emails/`. Default backend is console for dev.

## Backend Workflows
- Activate a virtualenv, install Django + DRF + MySQL connector, then run `python manage.py runserver` from the repo root.
- Run automated checks with `python manage.py test`; add app-specific tests in `api/tests.py`.
- Admin panel is enabled at `/admin/`; create a superuser via `python manage.py createsuperuser` when needed.
- New dependencies (install when setting up): `djangorestframework-simplejwt`, `mysqlclient`, `django-cors-headers` (already configured), and any email backend you swap in for production.
- Image uploads for researcher profiles rely on `Pillow`; ensure it is installed in the backend environment.
- Email templates live in `api/templates/emails/`; console email backend is enabled by default. Point `FRONTEND_BASE_URL` in settings when wiring real links.
## Frontend Conventions
- Angular app uses standalone components (`imports` array on components) and signals; follow that pattern when scaffolding features.
- Routes are declared in `app.routes.ts`; server-side catch-all routes live in `app.routes.server.ts` for SSR prerender.
- Keep shared configuration in `app.config.ts` and merge server overrides in `app.config.server.ts`.
- The UI will be styled using bootstrap 5 (imported in `styles.scss`); add custom styles there or create new SCSS files as needed.
- Use Angular's `HttpClient` for API calls; avoid direct `fetch` usage to leverage interceptors and Angular's DI system.
- Avoid using deprecated Angular directives like ngFor and ngIf, instead use the modern syntax that leverages Angular's standalone components and signals.

## Frontend Workflows
- From `client/`, install deps with `npm install` (npm 10 per `package.json`), then run `npm start` for the dev server on port 4200.
- Build SSR bundles via `npm run build`; serve the Node adapter locally with `npm run serve:ssr:client` (listens on port 4000 by default).
- Unit tests use Vitest through the Angular CLI: run `npm test` (aka `ng test`).

## Cross-Cutting Notes
- Ensure backend and frontend ports align with CORS settings (4200 for dev Angular, 4000 for SSR node server, 8000 default Django).
- When adding API calls on the Angular side, surface base URLs through environment files instead of hardcoding endpoints in components.
- Document any new management commands, npm scripts, or environment variables directly in this file to keep future agents in sync.
- Instead of using actual database IDs in URLS, prefer slugs or UUIDs for better security and usability.
- Communication between the server and Angular client will be based on JWT tokens.
- Researcher profiles expose public researcher listings and require institutional email verification using non-personal domains before appearing publicly. Use the `/api/researchers/*` endpoints for create/update/list flows and `/api/researchers/verify-institutional-email/` for token confirmation.
- User account flows:
	- Self-registration -> `/api/auth/register/` then `/api/auth/verify-email/` with token.
	- Admin invites -> `POST /api/admin/users/` sends invite token; complete via `/api/auth/invite/complete/`.
	- Password recovery -> `/api/auth/password/forgot/` + `/api/auth/password/reset/`.
	- Admin-triggered reset -> `/api/admin/users/{id}/trigger-reset/`.
	- Token refresh -> `/api/auth/token/refresh/`; session-friendly due to refresh rotation.