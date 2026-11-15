# Isometry RPG

Изометрическая RPG, которую мы делаем вайбкодингом вместе с Claude.

**Играть:** https://axlmas.github.io/isometry-rpg/

**Превью веток в работе:** https://axlmas.github.io/isometry-rpg/preview/

## Структура

| Путь | Что там |
|---|---|
| `CLAUDE.md` | Правила работы для Claude: стек, порядок работы, деплой |
| `docs/GDD.md` | Дизайн игры: идея, механики, roadmap |
| `docs/ARCHITECTURE.md` | Как устроен код и как его расширять |
| `docs/LOCALIZATION.md` | Тексты, языки, как добавить перевод |
| `src/sim/` | Правила игры (без графики) |
| `src/client/` | Отрисовка, управление, интерфейс, сохранение |
| `src/i18n/` | Тексты для игрока на всех языках |
| `tests/` | Автотесты |
| `public/sprites/` | Спрайт-листы персонажей |
| `tools/sprites/` | Инструмент, который рендерит спрайты из 3D-моделей |
| `docs/ASSETS.md` | Откуда взяты ассеты и под какой лицензией |
| `.github/workflows/ci.yml` | Проверки при каждом push |
| `.github/workflows/deploy.yml` | Автодеплой на GitHub Pages: `main` и превью всех веток |

## Как работаем

1. Ставлю задачу Claude (в Claude Code, репозиторий `isometry-rpg`). Одна задача — одна сессия.
2. Claude делает её в отдельной ветке и открывает pull request со ссылкой на превью.
3. Играю в превью. Нравится — сливаю PR, и через 1–2 минуты изменения попадают в основную версию.

## Запуск у себя

Нужен Node.js 22.

```bash
npm ci
```

```bash
npm run dev
```

Все проверки перед push:

```bash
npm run check
```
