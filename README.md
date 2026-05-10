# waterOutPuzzle

Water out puzzle game without annoying ads.

## Разработка

```bash
npm install
npm run dev
```

Сборка для продакшена: `npm run build`.

## GitHub Pages

После пуша в `main` [GitHub Actions](.github/workflows/deploy-github-pages.yml) собирает проект и публикует его.

1. На GitHub: **Settings → Pages**.
2. В блоке **Build and deployment** выбери **Source: GitHub Actions** (не «Deploy from a branch»).
3. Дождись зелёного workflow **Deploy to GitHub Pages** во вкладке **Actions**.

Игра будет доступна по адресу: **https://lubava7.github.io/waterOutPuzzle/**

Локально проверить продакшен-сборку:

```bash
npm run build && npm run preview
```
(в режиме preview Vite подставляет тот же `base`, что и при деплое.)
