# Private Marketplace Templates

Repozytorium zawiera wyłącznie plugin Grafany `gregoor-private-marketplace-app`.

Odpowiedzialności są rozdzielone:

- `private-marketplace-templates` trzyma kod pluginu, backend Go, frontend React/TypeScript, przykładowe szablony i Dockerfile budujący obraz artefaktu pluginu.
- `../grafana-local` odpowiada za lokalny deploy Grafany na Minikube przez Helm oraz za podpięcie tego pluginu do instancji developerskiej.

## Zakres pluginu

Plugin działa jako prywatny marketplace szablonów dashboardów:

- pokazuje galerię szablonów,
- pozwala wejść w widok szczegółowy,
- importuje dashboard do Grafany z formularzem zmiennych,
- pozwala wrzucać nowe szablony z poziomu UI,
- wspiera lokalny storage i stub zewnętrznego backendu HTTP.

## Struktura repo

```text
src/        frontend pluginu Grafany
pkg/        backend Go oparty o grafana-plugin-sdk-go
templates/  przykładowe template bundles do testów
.config/    konfiguracja webpacka
Dockerfile  obraz artefaktu pluginu dla Grafany
Makefile    build/test/image dla samego pluginu
```

## Najważniejsze entry pointy

- Frontend: `src/module.ts`
- Routing UI: `src/App.tsx`
- Plugin metadata: `src/plugin.json`
- Backend entry: `pkg/main.go`
- HTTP resources: `pkg/plugin/resources.go`
- Storage: `pkg/plugin/storage/*`

## Build i testy

```bash
npm install
npm run build
npm run test
npm run typecheck
go test ./pkg/...
make build
make image
```

`make image` buduje obraz `gregoor/private-marketplace-plugin:1.0.0`, z którego korzysta repo `../grafana-local`.

## Uruchomienie z lokalną Grafaną

Lokalna Grafana na Minikube nie jest już utrzymywana w tym repo.

Użyj sąsiedniego repo:

```bash
cd ../grafana-local
bash scripts/deploy-private-marketplace.sh
```

To repo zakłada, że chart i deploy developerski żyją obok pluginu, a nie w środku niego.
