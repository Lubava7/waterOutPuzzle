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

Игра обычно по адресу **https://lubava7.github.io/waterOutPuzzle/** (точный URL см. **Settings → Pages** после успешного деплоя).

Если в консоли **404** на скрипты/CSS — убедись, что открываешь ссылку **со всей секцией с именем репозитория** (`…github.io/waterOutPuzzle/`), а не только `…github.io/`.

Локально проверить продакшен-сборку:

```bash
npm run build && npm run preview
```
